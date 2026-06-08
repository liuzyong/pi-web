// lib/attachment-store.ts
//
// Persist user-attached files to disk so the agent (LLM) can read them via
// the Read tool. Files are stored under:
//
//   <getAgentDir()>/sessions/<sessionId>/files/<sha8>-<sanitized-name>
//
// Rationale:
// - `getAgentDir()` (and therefore `sessions/`) is the same root that the
//   upstream `SessionManager` writes .jsonl session logs to. Storing
//   attachments there keeps "everything for this session in one tree" and
//   works without needing the request's `cwd` field on the existing-session
//   route (where body.cwd is absent).
// - The `<sha8>-` prefix prevents same-name collisions across messages
//   and gives us a stable, content-addressed basename for the GET route.
// - `sanitizeName` strips path separators and control chars so the basename
//   can never escape `files/` via `..` / `/` / NUL tricks.

import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { resolveSessionPath } from "./session-reader";

// ============================================================================
// Types
// ============================================================================

export interface AttachedFileInput {
  name: string;
  mimeType: string;
  size: number;
  /** Base64-encoded file contents, no `data:` prefix. */
  data: string;
}

export interface SavedAttachment {
  /** Original user-supplied filename (echoed for UI). */
  name: string;
  /** Absolute path on disk (used in agent message text). */
  path: string;
  /** Public URL the browser can GET to download/preview. */
  url: string;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Reduce an arbitrary user-supplied filename to a safe basename.
 * Strips directory components, control characters, and Windows-illegal
 * characters; truncates to 200 chars; falls back to "file" if empty.
 */
function sanitizeName(raw: string): string {
  const base = path.basename(raw);
  const cleaned = base.replace(/[<>:"|?*\x00-\x1f]/g, "_").slice(0, 200);
  return cleaned || "file";
}

/**
 * Compute the absolute path of the `files/` directory for a given session.
 * Throws if the session is unknown (caller should ensure `cacheSessionPath`
 * has run, which `startRpcSession` does).
 */
export async function getAttachmentsDir(sessionId: string): Promise<string> {
  const sessionFile = await resolveSessionPath(sessionId);
  if (!sessionFile) {
    throw new Error(`Unknown session: ${sessionId}`);
  }
  return path.join(path.dirname(sessionFile), "files");
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Write a single attachment to disk and return its on-disk path + public URL.
 * Directory is created lazily; existing files with the same hash+name are
 * overwritten (idempotent re-send of the same file).
 */
export async function saveAttachment(
  sessionId: string,
  input: AttachedFileInput,
): Promise<SavedAttachment> {
  const dir = await getAttachmentsDir(sessionId);
  await fs.mkdir(dir, { recursive: true });

  const safe = sanitizeName(input.name);
  const hash = crypto
    .createHash("sha256")
    .update(input.data)
    .digest("hex")
    .slice(0, 8);
  const basename = `${hash}-${safe}`;
  const abs = path.join(dir, basename);

  // Buffer.from with explicit "base64" tolerates whitespace from the wire
  // and avoids ambiguity if the input ever lands with a data: prefix.
  const buf = Buffer.from(input.data, "base64");
  await fs.writeFile(abs, buf);

  return {
    name: input.name,
    path: abs,
    url: `/api/agent/sessions/${encodeURIComponent(sessionId)}/files/${encodeURIComponent(basename)}`,
  };
}

/**
 * Persist a batch of attachments. Per-file failures are logged and skipped
 * rather than aborting the whole send, so one bad file does not block
 * the rest. Returns the successfully saved entries.
 */
export async function saveAttachments(
  sessionId: string,
  inputs: AttachedFileInput[],
): Promise<SavedAttachment[]> {
  const out: SavedAttachment[] = [];
  for (const input of inputs) {
    try {
      out.push(await saveAttachment(sessionId, input));
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(
        `[attachment-store] failed to save "${input.name}" for session ${sessionId}:`,
        err,
      );
    }
  }
  return out;
}

/**
 * Resolve a public-facing basename to an absolute path, with strict
 * path-traversal protection. Returns `null` if:
 *   - the session is unknown
 *   - the basename contains path separators or `..` (we compare to
 *     `path.basename` output)
 *   - the resolved path escapes the session's `files/` directory
 */
export async function resolveAttachmentPath(
  sessionId: string,
  requestedBasename: string,
): Promise<string | null> {
  const dir = await getAttachmentsDir(sessionId);
  const safe = path.basename(requestedBasename);
  if (safe !== requestedBasename || !safe) return null;

  const full = path.join(dir, safe);
  const rel = path.relative(dir, full);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return full;
}
