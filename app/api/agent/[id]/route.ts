import { NextResponse } from "next/server";
import { resolveSessionPath } from "@/lib/session-reader";
import { startRpcSession, getRpcSession } from "@/lib/rpc-manager";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import {
  saveAttachments,
  type AttachedFileInput,
} from "@/lib/attachment-store";

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

// POST /api/agent/[id] - Send a command to an existing session.
// Accepts an optional `files` payload (same shape as /api/agent/new):
// files are persisted to disk *before* dispatching the command, and the
// response includes `attachedFilePaths` so the caller can render or link
// them without re-deriving paths.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const body = (await req.json()) as {
      type: string;
      message?: string;
      files?: AttachedFileInput[];
      images?: { data: string; mimeType: string }[];
      [key: string]: unknown;
    };
    const { files, images, ...command } = body;

    // Defensive type-guard: drop anything that doesn't look like a file blob
    // rather than abort the whole send. Real validation lives client-side.
    const safeFiles: AttachedFileInput[] = Array.isArray(files)
      ? files.filter(isAttachedFileInput)
      : [];

    // Convert uploaded images to the same AttachedFileInput format so they
    // are saved to disk and their paths are prepended to the message —
    // exactly like regular file attachments. This lets the LLM use the Read
    // tool to load them, which works even for models that don't support
    // native vision input.
    const imageFiles: AttachedFileInput[] = (Array.isArray(images) ? images : [])
      .filter((img): img is { data: string; mimeType: string } =>
        img && typeof img.data === "string" && typeof img.mimeType === "string"
      )
      .map((img, i) => {
        const ext = img.mimeType.split("/")[1] || "png";
        return {
          name: `image-${i}.${ext}`,
          mimeType: img.mimeType,
          size: Math.ceil((img.data.length / 4) * 3),
          data: img.data,
        };
      });

    // Merge with regular file attachments
    const allFiles = [...safeFiles, ...imageFiles];

    // Persist attached files and images to disk *before* dispatching the
    // command so the agent can immediately Read them. Applies to both
    // fast-path (already running) and slow-path (cold start) below.
    const saved = await saveAttachments(id, allFiles);

    // If any files or images were saved, prepend their absolute paths to
    // the user message so the LLM knows where to Read them. The convention
    // matches the /api/agent/new route: "Attached files (use Read tool):\n
    //   - <absPath>".
    if (saved.length > 0 && typeof command.message === "string") {
      const fileList = saved
        .map((s) => `  - ${s.path}`)
        .join("\n");
      command.message = `Attached files (use Read tool):\n${fileList}\n\n${command.message}`;
    }

    // Fast path: already-running session
    const existing = getRpcSession(id);
    if (existing?.isAlive()) {
      const result = await existing.send(command);
      return NextResponse.json({
        success: true,
        data: result,
        attachedFilePaths: saved,
      });
    }

    const filePath = await resolveSessionPath(id);
    if (!filePath) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const cwd = SessionManager.open(filePath).getHeader()?.cwd ?? process.cwd();

    const { session } = await startRpcSession(id, filePath, cwd);
    const result = await session.send(command);

    return NextResponse.json({
      success: true,
      data: result,
      attachedFilePaths: saved,
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// GET /api/agent/[id] - Get current agent state
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const session = getRpcSession(id);
    if (!session || !session.isAlive()) {
      return NextResponse.json({ running: false });
    }

    const state = await session.send({ type: "get_state" });
    return NextResponse.json({ running: true, state });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
