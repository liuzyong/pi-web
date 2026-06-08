// Client-side helper for POST /api/agent/[id].
//
// Every /api/agent/[id] route returns one of:
//   { success: true, data: <result> }
//   { error: string }              (non-2xx)
//
// Call sites previously repeated the same 5-line fetch block 13× in
// hooks/useAgentSession.ts. This helper collapses that down to one line.

import type { AttachedFileInput, SavedAttachment } from "./attachment-store";

export async function sendAgentCommand<T = unknown>(
  sessionId: string,
  command: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(`/api/agent/${encodeURIComponent(sessionId)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(command),
  });
  const body = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    data?: T;
    error?: string;
  };
  if (!res.ok || body.error) {
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return body.data as T;
}

// Variant of `sendAgentCommand` for commands that carry non-image file
// attachments. The wire shape is identical to `sendAgentCommand` (JSON body,
// POST /api/agent/[id]); the only addition is an `attachedFilePaths` field
// in the response so the caller can swap the message's preview file-blocks
// from in-memory dataURLs to server-backed URLs without re-deriving paths.
//
// The wire field name on the request side is `files` (not `attachedFiles`) —
// that name is also used by /api/agent/new and by useAgentSession.ts's
// `piFiles` payload, so we stay aligned across the protocol.
export interface AgentCommandWithAttachments {
  type: string;
  message?: string;
  files?: AttachedFileInput[];
  [key: string]: unknown;
}

export interface AgentCommandResultWithAttachments<T = unknown> {
  result: T;
  attachedFilePaths: SavedAttachment[];
}

export async function sendAgentCommandWithAttachments<T = unknown>(
  sessionId: string,
  command: AgentCommandWithAttachments,
): Promise<AgentCommandResultWithAttachments<T>> {
  const res = await fetch(`/api/agent/${encodeURIComponent(sessionId)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(command),
  });
  const body = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    data?: T;
    attachedFilePaths?: SavedAttachment[];
    error?: string;
  };
  if (!res.ok || body.error) {
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return {
    result: body.data as T,
    attachedFilePaths: Array.isArray(body.attachedFilePaths)
      ? body.attachedFilePaths
      : [],
  };
}
