import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { listAllSessions } from "@/lib/session-reader";

const IGNORED_NAMES = new Set([
  "node_modules", ".git", ".next", "dist", "build", "__pycache__",
  ".turbo", ".cache", "coverage", ".pytest_cache", ".mypy_cache",
  "target", "vendor", ".DS_Store", ".git",
]);

const IGNORED_SUFFIXES = [".pyc"];

const TEXT_PREVIEW_MAX_BYTES = 256 * 1024;
const IMAGE_PREVIEW_MAX_BYTES = 10 * 1024 * 1024;
const DOCX_PREVIEW_MAX_BYTES = 10 * 1024 * 1024;

const IMAGE_EXT_TO_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  bmp: "image/bmp",
  ico: "image/x-icon",
  avif: "image/avif",
};

const AUDIO_EXT_TO_MIME: Record<string, string> = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  opus: "audio/ogg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  flac: "audio/flac",
  weba: "audio/webm",
  webm: "audio/webm",
};

const DOCUMENT_EXT_TO_MIME: Record<string, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

function getExt(filePath: string): string {
  const ext = path.basename(filePath).toLowerCase().split(".").pop() ?? "";
  return ext;
}

function getImageMime(filePath: string): string | null {
  return IMAGE_EXT_TO_MIME[getExt(filePath)] ?? null;
}

function getAudioMime(filePath: string): string | null {
  return AUDIO_EXT_TO_MIME[getExt(filePath)] ?? null;
}

function getDocumentMime(filePath: string): string | null {
  return DOCUMENT_EXT_TO_MIME[getExt(filePath)] ?? null;
}

const EXT_TO_LANGUAGE: Record<string, string> = {
  ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
  mjs: "javascript", cjs: "javascript", py: "python", rb: "ruby",
  go: "go", rs: "rust", java: "java", kt: "kotlin", swift: "swift",
  c: "c", cpp: "cpp", h: "c", hpp: "cpp", cs: "csharp",
  html: "html", htm: "html", css: "css", scss: "css", less: "css",
  json: "json", jsonl: "json", yaml: "yaml", yml: "yaml",
  toml: "toml", xml: "xml", md: "markdown", mdx: "markdown",
  sh: "bash", bash: "bash", zsh: "bash", fish: "bash",
  sql: "sql", graphql: "graphql", gql: "graphql",
  dockerfile: "dockerfile", tf: "hcl", hcl: "hcl",
  env: "bash", gitignore: "bash", txt: "text",
  pdf: "pdf", doc: "word", docx: "word",
};

function getLanguage(filePath: string): string {
  const base = path.basename(filePath).toLowerCase();
  // Special full-name matches
  if (base === "dockerfile" || base.startsWith("dockerfile.")) return "dockerfile";
  if (base === ".env" || base.startsWith(".env.")) return "bash";
  if (base === "makefile" || base === "gnumakefile") return "makefile";
  const ext = base.split(".").pop() ?? "";
  return EXT_TO_LANGUAGE[ext] ?? "text";
}

function documentPreviewKind(filePath: string): "pdf" | "docx" | null {
  const ext = getExt(filePath);
  if (ext === "pdf") return "pdf";
  if (ext === "docx") return "docx";
  return null;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function wrapDocxPreviewHtml(bodyHtml: string, fileName: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      :root { color-scheme: light; }
      html, body { margin: 0; min-height: 100%; background: #eef1f5; color: #171717; }
      body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; padding: 28px; }
      main { box-sizing: border-box; max-width: 840px; min-height: calc(100vh - 56px); margin: 0 auto; padding: 56px 64px; background: #fff; box-shadow: 0 8px 28px rgba(15, 23, 42, 0.14); }
      .file-title { margin: 0 0 28px; padding-bottom: 10px; border-bottom: 1px solid #e5e7eb; color: #6b7280; font: 12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; word-break: break-word; }
      h1, h2, h3, h4, h5, h6 { line-height: 1.3; margin: 1.1em 0 0.45em; color: #111827; }
      p { margin: 0.65em 0; line-height: 1.7; }
      table { border-collapse: collapse; max-width: 100%; margin: 1em 0; }
      th, td { border: 1px solid #d1d5db; padding: 6px 9px; vertical-align: top; }
      img { max-width: 100%; height: auto; }
      pre { white-space: pre-wrap; overflow-wrap: anywhere; }
      a { color: #2563eb; }
      @media (max-width: 720px) {
        body { padding: 0; background: #fff; }
        main { min-height: 100vh; padding: 28px 22px; box-shadow: none; }
      }
    </style>
  </head>
  <body>
    <main>
      <div class="file-title">${escapeHtml(fileName)}</div>
      ${bodyHtml}
    </main>
  </body>
</html>`;
}

// Short-TTL cache for the allowed-roots set. Without this, every file list/read
// request re-scans every pi session on disk just to check access. 5s is short
// enough that newly-created cwds appear promptly; stored on globalThis so it
// survives Next.js hot-reload.
declare global {
  var __piAllowedRootsCache: { roots: Set<string>; expiresAt: number } | undefined;
}

const ALLOWED_ROOTS_TTL_MS = 5_000;
const WINDOWS_ABSOLUTE_RE = /^[a-zA-Z]:[\\/]/;

function normalizeSlashes(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

function isWindowsAbsolutePath(filePath: string): boolean {
  return WINDOWS_ABSOLUTE_RE.test(filePath) || filePath.startsWith("\\\\") || filePath.startsWith("//");
}

function filePathFromSegments(segments: string[]): string {
  const joined = segments.join("/");
  const slashJoined = normalizeSlashes(joined);
  if (isWindowsAbsolutePath(slashJoined)) return slashJoined;
  return "/" + joined.replace(/^\/+/, "");
}

async function getAllowedRoots(): Promise<Set<string>> {
  const now = Date.now();
  const cached = globalThis.__piAllowedRootsCache;
  if (cached && cached.expiresAt > now) return cached.roots;

  const sessions = await listAllSessions();
  const roots = new Set<string>();
  for (const s of sessions) {
    if (s.cwd) {
      roots.add(s.cwd);
      // Also allow the parent directory so sibling directories (like outputs/) are accessible
      // when the cwd is a subdirectory (e.g. cwd = project/src but docs in project/outputs)
      const parent = path.dirname(s.cwd);
      if (parent && parent !== s.cwd) roots.add(parent);
    }
  }
  // Also allow ~/pi-cwd-* directories created by the default-cwd endpoint
  const home = (await import("os")).homedir();
  const { readdirSync } = await import("fs");
  try {
    for (const name of readdirSync(home)) {
      if (/^pi-cwd-\d{8}$/.test(name)) {
        roots.add(path.join(home, name));
      }
    }
  } catch {
    // ignore if home is unreadable
  }

  globalThis.__piAllowedRootsCache = { roots, expiresAt: now + ALLOWED_ROOTS_TTL_MS };
  return roots;
}

function isPathAllowed(target: string, allowedRoots: Set<string>): boolean {
  for (const root of allowedRoots) {
    const useWindowsRules = isWindowsAbsolutePath(target) || isWindowsAbsolutePath(root);
    const resolver = useWindowsRules ? path.win32 : path;
    const sep = useWindowsRules ? "\\" : path.sep;
    const normalized = resolver.resolve(target);
    const normalizedRoot = resolver.resolve(root);
    const comparable = useWindowsRules ? normalized.toLowerCase() : normalized;
    const comparableRoot = useWindowsRules ? normalizedRoot.toLowerCase() : normalizedRoot;
    const rootWithSep = comparableRoot.endsWith(sep) ? comparableRoot : comparableRoot + sep;
    if (comparable === comparableRoot || comparable.startsWith(rootWithSep)) {
      return true;
    }
  }
  return false;
}

function createFileBodyStream(filePath: string, range?: { start: number; end: number }): ReadableStream<Uint8Array> {
  const fileStream = fs.createReadStream(filePath, range);
  let closed = false;

  return new ReadableStream<Uint8Array>({
    start(controller) {
      fileStream.on("data", (chunk: Buffer) => {
        if (closed) return;
        try {
          controller.enqueue(new Uint8Array(chunk));
        } catch {
          closed = true;
          fileStream.destroy();
        }
      });
      fileStream.once("end", () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          // The browser may cancel media probes before the file stream ends.
        }
      });
      fileStream.once("error", (error) => {
        if (closed) return;
        closed = true;
        try {
          controller.error(error);
        } catch {
          // The response was already abandoned by the client.
        }
      });
    },
    cancel() {
      closed = true;
      fileStream.destroy();
    },
  });
}

function streamFile(filePath: string, stat: fs.Stats, contentType: string, rangeHeader: string | null): Response {
  const headers = {
    "Content-Type": contentType,
    "Cache-Control": "no-cache",
    "Accept-Ranges": "bytes",
  };

  if (!rangeHeader) {
    return new Response(createFileBodyStream(filePath), {
      headers: {
        ...headers,
        "Content-Length": String(stat.size),
      },
    });
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
  if (!match) {
    return new Response(null, {
      status: 416,
      headers: {
        ...headers,
        "Content-Range": `bytes */${stat.size}`,
      },
    });
  }

  let start = match[1] ? Number(match[1]) : 0;
  let end = match[2] ? Number(match[2]) : stat.size - 1;
  if (!match[1] && match[2]) {
    const suffixLength = Number(match[2]);
    start = Math.max(stat.size - suffixLength, 0);
    end = stat.size - 1;
  }

  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || start >= stat.size) {
    return new Response(null, {
      status: 416,
      headers: {
        ...headers,
        "Content-Range": `bytes */${stat.size}`,
      },
    });
  }

  end = Math.min(end, stat.size - 1);
  const chunkSize = end - start + 1;
  return new Response(createFileBodyStream(filePath, { start, end }), {
    status: 206,
    headers: {
      ...headers,
      "Content-Length": String(chunkSize),
      "Content-Range": `bytes ${start}-${end}/${stat.size}`,
    },
  });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  try {
    const { path: segments } = await params;
    const filePath = filePathFromSegments(segments);
    const type = request.nextUrl.searchParams.get("type") ?? "list";

    const allowedRoots = await getAllowedRoots();
    if (!isPathAllowed(filePath, allowedRoots)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    let stat: fs.Stats | undefined;
    let resolvedFilePath = filePath;
    try {
      stat = fs.statSync(filePath);
    } catch {
      // File not found at exact path — try fuzzy match in the same directory
      // This handles cases where AI-generated text has a slightly different filename
      // than the actual saved file (e.g. "现境保护" vs "环境保护")
      const dir = path.dirname(filePath);
      const base = path.basename(filePath);
      try {
        const entries = fs.readdirSync(dir);
        // Find the closest match: same extension + highest character overlap ratio
        const ext = base.split(".").pop()?.toLowerCase() ?? "";
        const candidates = entries.filter(e => e.split(".").pop()?.toLowerCase() === ext);
        if (candidates.length > 0) {
          // Score by character overlap: count how many characters in the requested
          // basename appear in the candidate, weighted by position
          const scored = candidates.map(c => {
            // Simple overlap: count characters that exist in both strings
            const baseChars = [...base];
            const candChars = [...c];
            let overlap = 0;
            const used = new Set<number>();
            for (const ch of baseChars) {
              const idx = candChars.findIndex((cc, i) => cc === ch && !used.has(i));
              if (idx !== -1) {
                overlap++;
                used.add(idx);
              }
            }
            const ratio = overlap / Math.max(baseChars.length, candChars.length);
            return { name: c, score: ratio };
          });
          scored.sort((a, b) => b.score - a.score);
          const best = scored[0];
          // Accept if at least 70% of characters overlap
          if (best.score >= 0.7) {
            const fuzzyPath = path.join(dir, best.name);
            if (isPathAllowed(fuzzyPath, allowedRoots)) {
              resolvedFilePath = fuzzyPath;
              stat = fs.statSync(fuzzyPath);
            }
          }
        }
      } catch {
        // Directory doesn't exist either — return 404
      }
      if (!stat) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
    }

    if (type === "read") {
      if (!stat.isFile()) {
        return NextResponse.json({ error: "Not a file" }, { status: 400 });
      }
      const imageMime = getImageMime(resolvedFilePath);
      if (imageMime) {
        if (stat.size > IMAGE_PREVIEW_MAX_BYTES) {
          return NextResponse.json({ error: "Image too large (>10MB)" }, { status: 413 });
        }
        return streamFile(resolvedFilePath, stat, imageMime, request.headers.get("range"));
      }
      const audioMime = getAudioMime(resolvedFilePath);
      if (audioMime) {
        return streamFile(resolvedFilePath, stat, audioMime, request.headers.get("range"));
      }
      const documentMime = getDocumentMime(resolvedFilePath);
      if (documentMime) {
        return streamFile(resolvedFilePath, stat, documentMime, request.headers.get("range"));
      }
      if (stat.size > TEXT_PREVIEW_MAX_BYTES) {
        return NextResponse.json({ error: "File too large for preview (>256KB)" }, { status: 413 });
      }
      const content = fs.readFileSync(resolvedFilePath, "utf-8");
      const language = getLanguage(resolvedFilePath);
      return NextResponse.json({ content, language, size: stat.size });
    }

    if (type === "preview") {
      if (!stat.isFile()) {
        return NextResponse.json({ error: "Not a file" }, { status: 400 });
      }
      const documentMime = getDocumentMime(resolvedFilePath);
      if (!documentMime) {
        return NextResponse.json({ error: "Preview not available" }, { status: 400 });
      }
      if (resolvedFilePath.toLowerCase().endsWith(".docx")) {
        if (stat.size > DOCX_PREVIEW_MAX_BYTES) {
          return new NextResponse("File too large", { status: 413 });
        }
        try {
          const mammoth = await import("mammoth");
          const result = await mammoth.convertToHtml(
            { path: resolvedFilePath },
            {
              externalFileAccess: false,
              convertImage: mammoth.images.dataUri,
            }
          );
          const html = wrapDocxPreviewHtml(result.value, path.basename(resolvedFilePath));
          return new Response(html, {
            headers: {
              "Content-Type": "text/html; charset=utf-8",
              "Cache-Control": "no-cache",
              "Content-Security-Policy": "default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'",
              "Referrer-Policy": "no-referrer",
              "X-Content-Type-Options": "nosniff",
            },
          });
        } catch (error) {
          return NextResponse.json({ error: String(error) }, { status: 500 });
        }
      }
      return NextResponse.json({ error: "Preview not available for this document type" }, { status: 400 });
    }

    if (type === "meta") {
      if (!stat.isFile()) {
        return NextResponse.json({ error: "Not a file" }, { status: 400 });
      }
      const documentMime = getDocumentMime(resolvedFilePath);
      const imageMime = getImageMime(resolvedFilePath);
      const audioMime = getAudioMime(resolvedFilePath);
      return NextResponse.json({
        size: stat.size,
        language: getLanguage(resolvedFilePath),
        mime: imageMime || audioMime || documentMime || "application/octet-stream",
        previewKind: documentPreviewKind(resolvedFilePath),
      });
    }

    if (type === "watch") {
      if (!stat.isFile()) {
        return NextResponse.json({ error: "Not a file" }, { status: 400 });
      }
      let watcher: fs.FSWatcher | null = null;
      const stream = new ReadableStream({
        start(controller) {
          const send = (eventName: string, data: Record<string, unknown>) => {
            const payload = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
            try {
              controller.enqueue(new TextEncoder().encode(payload));
            } catch {
              // client disconnected
            }
          };
          // Send initial ping so client knows connection is live
          send("connected", { filePath: resolvedFilePath });
          try {
            watcher = fs.watch(resolvedFilePath, () => {
              try {
                const s = fs.statSync(resolvedFilePath);
                send("change", { mtime: s.mtime.toISOString(), size: s.size });
              } catch {
                send("change", { mtime: new Date().toISOString(), size: 0 });
              }
            });
            watcher.on("error", () => {
              try { controller.close(); } catch { /* ignore */ }
            });
          } catch {
            send("error", { message: "Failed to watch file" });
            controller.close();
          }
        },
        cancel() {
          try { watcher?.close(); } catch { /* ignore */ }
        },
      });
      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        },
      });
    }

    // type === "list"
    if (!stat.isDirectory()) {
      return NextResponse.json({ error: "Not a directory" }, { status: 400 });
    }

    const names = fs.readdirSync(resolvedFilePath);
    const entries = names
      .filter((name) => !IGNORED_NAMES.has(name) && !IGNORED_SUFFIXES.some((s) => name.endsWith(s)))
      .map((name) => {
        const full = path.join(resolvedFilePath, name);
        try {
          const s = fs.statSync(full);
          return {
            name,
            isDir: s.isDirectory(),
            size: s.isFile() ? s.size : 0,
            modified: s.mtime.toISOString(),
          };
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a, b) => {
        // Dirs first, then files, both alphabetically
        if (a!.isDir !== b!.isDir) return a!.isDir ? -1 : 1;
        return a!.name.localeCompare(b!.name);
      });

    return NextResponse.json({ entries, path: filePath });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  try {
    const { path: segments } = await params;
    const filePath = filePathFromSegments(segments);
    const allowedRoots = await getAllowedRoots();
    if (!isPathAllowed(filePath, allowedRoots)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    let stat: fs.Stats;
    try {
      stat = fs.statSync(filePath);
    } catch {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    if (!stat.isFile()) {
      return NextResponse.json({ error: "Not a file" }, { status: 400 });
    }

    const body = await request.json();
    if (!body || typeof body.content !== "string") {
      return NextResponse.json({ error: "Missing file content" }, { status: 400 });
    }

    const imageMime = getImageMime(filePath);
    const audioMime = getAudioMime(filePath);
    const documentMime = getDocumentMime(filePath);
    const ext = getExt(filePath);

    if (imageMime || audioMime) {
      return NextResponse.json({ error: "Cannot save binary files" }, { status: 400 });
    }

    if (ext === "docx") {
      try {
        const { default: htmlToDocx } = await import("html-to-docx");
        const docxBuffer = await htmlToDocx(body.content);
        fs.writeFileSync(filePath, Buffer.from(docxBuffer));
      } catch (error) {
        return NextResponse.json({ error: String(error) }, { status: 500 });
      }
    } else if (documentMime) {
      return NextResponse.json({ error: "Cannot save this document type" }, { status: 400 });
    } else {
      fs.writeFileSync(filePath, body.content, "utf-8");
    }

    const newStat = fs.statSync(filePath);
    return NextResponse.json({
      content: body.content,
      language: getLanguage(filePath),
      size: newStat.size,
      path: filePath,
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
