import { NextResponse } from "next/server";
import { existsSync } from "fs";
import { startRpcSession } from "@/lib/rpc-manager";
import {
  saveAttachments,
  type AttachedFileInput,
} from "@/lib/attachment-store";

interface NewSessionBody {
  cwd?: string;
  type?: string;
  message?: string;
  files?: AttachedFileInput[];
  [key: string]: unknown;
}

function isAttachedFileInput(x: unknown): x is AttachedFileInput {
  if (!x || typeof x !== "object") return false;
  const f = x as Record<string, unknown>;
  return (
    typeof f.name === "string" &&
    typeof f.mimeType === "string" &&
    typeof f.size === "number" &&
    typeof f.data === "string"
  );
}

// POST /api/agent/new  body: { cwd: string; type: string; message: string; files?: AttachedFileInput[]; ... }
// Spawns a brand-new pi session and immediately sends the first command.
// Returns { sessionId, data, attachedFilePaths } where sessionId is pi's real
// session id, and `attachedFilePaths` are the on-disk locations of any files
// the caller asked to attach (so the UI can display absolute paths / public
// URLs without re-deriving them).
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as NewSessionBody;
    const { cwd, files, ...command } = body;

    if (!cwd || typeof cwd !== "string") {
      return NextResponse.json({ error: "cwd is required" }, { status: 400 });
    }
    if (!existsSync(cwd)) {
      return NextResponse.json({ error: `Directory does not exist: ${cwd}` }, { status: 400 });
    }

    // Defensive type-guard: drop anything that doesn't look like a file blob
    // rather than abort the whole send. Real validation lives client-side.
    const safeFiles: AttachedFileInput[] = Array.isArray(files)
      ? files.filter(isAttachedFileInput)
      : [];

    // Use a one-time key so startRpcSession's lock doesn't conflict with real session ids
    const { provider, modelId, toolNames, thinkingLevel, ...promptCommand } = command as { provider?: string; modelId?: string; toolNames?: string[]; thinkingLevel?: string; [key: string]: unknown };

    const tempKey = `__new__${Date.now()}`;
    const { session, realSessionId } = await startRpcSession(tempKey, "", cwd, toolNames);

    // Keep the files-route allowed-roots cache (see app/api/files/[...path]/route.ts)
    // in sync so the new cwd is immediately readable via /api/files. Without this,
    // a file request under a brand-new cwd would 403 for up to the cache TTL.
    globalThis.__piAllowedRootsCache?.roots.add(cwd);

    // Persist attached files to disk *before* dispatching the prompt so the
    // agent can immediately Read them. Per-file failures are logged inside
    // `saveAttachments` and excluded from the result rather than aborting.
    const saved = await saveAttachments(realSessionId, safeFiles);

    // If any files were saved, prepend their absolute paths to the user
    // message so the LLM knows where to Read them. The convention matches
    // plan B: "Attached files (use Read tool):\n  - <absPath>".
    if (saved.length > 0 && typeof promptCommand.message === "string") {
      const fileList = saved
        .map((s) => `  - ${s.path}`)
        .join("\n");
      promptCommand.message = `Attached files (use Read tool):\n${fileList}\n\n${promptCommand.message}`;
    }

    // Apply pre-selected model before sending the prompt
    if (provider && modelId) {
      await session.send({ type: "set_model", provider, modelId });
    }

    // Apply pre-selected thinking level before sending the prompt
    if (thinkingLevel) {
      await session.send({ type: "set_thinking_level", level: thinkingLevel });
    }

    const result = await session.send(promptCommand);

    return NextResponse.json({
      success: true,
      sessionId: realSessionId,
      data: result,
      attachedFilePaths: saved,
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
