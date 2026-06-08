// app/api/agent/sessions/[id]/files/[...name]/route.ts
//
// Stream a user-attached file back to the browser for inline preview /
// download. The file is read from disk at
//   <getAgentDir()>/sessions/<sessionId>/files/<sha8>-<sanitized-name>
// (see lib/attachment-store.ts).
//
// Path-traversal protection is delegated to `resolveAttachmentPath`, which
// rejects basenames containing `/` or `..` segments and also re-checks that
// the resolved absolute path stays inside the session's `files/` directory.

import { createReadStream, statSync } from "node:fs";
import { resolveAttachmentPath } from "@/lib/attachment-store";

// Next.js App Router: pin to Node runtime so `fs.createReadStream` works
// directly. Edge runtime would require a `ReadableStream` wrapper.
export const runtime = "nodejs";
// Streamed response; never cache.
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; name: string[] }> },
) {
  const { id, name } = await params;
  if (!id || !name || name.length === 0) {
    return new Response("Bad Request", { status: 400 });
  }

  // [...name] catch-all may produce ["foo.pdf"] or ["sub", "foo.pdf"].
  // Joining then re-running through `path.basename` inside the helper
  // flattens any nested path the user attempted; the helper returns null
  // for any traversal attempt.
  const basename = name.join("/");

  const abs = await resolveAttachmentPath(id, basename);
  if (!abs) {
    return new Response("Not Found", { status: 404 });
  }

  let stat;
  try {
    stat = statSync(abs);
  } catch {
    return new Response("Not Found", { status: 404 });
  }
  if (!stat.isFile()) {
    return new Response("Not Found", { status: 404 });
  }

  // For a generic stream we pick application/octet-stream; the browser
  // will still render PDFs / images inline when the response uses
  // `Content-Disposition: inline` and the user navigates to the URL.
  const stream = createReadStream(abs);

  // The basename we send back in the header strips the `<sha8>-` prefix
  // so the user's Save-As dialog shows their original filename (echoed in
  // SavedAttachment.name on the write path). Fall back to the raw basename
  // if the prefix isn't present (defensive — should not happen for files
  // written via saveAttachment).
  const dashIdx = basename.indexOf("-");
  const displayName =
    dashIdx > 0 && dashIdx < basename.length - 1
      ? basename.slice(dashIdx + 1)
      : basename;

  return new Response(stream as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(stat.size),
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(displayName)}`,
      "Cache-Control": "private, max-age=3600",
    },
  });
}
