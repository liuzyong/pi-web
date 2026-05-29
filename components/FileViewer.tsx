"use client";

import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vs } from "react-syntax-highlighter/dist/cjs/styles/prism";
import { vscDarkPlus } from "react-syntax-highlighter/dist/cjs/styles/prism";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useTheme } from "@/hooks/useTheme";
import { encodeFilePathForApi, getFileName, getRelativeFilePath } from "@/lib/file-paths";

interface Props {
  filePath: string;
  cwd?: string;
}

interface FileData {
  content: string;
  language: string;
  size: number;
}

const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico", "avif"]);
const AUDIO_EXTS = new Set(["mp3", "wav", "ogg", "oga", "opus", "m4a", "aac", "flac", "weba", "webm"]);
const DOCUMENT_EXTS = new Set(["pdf", "doc", "docx"]);

function isImagePath(filePath: string): boolean {
  const base = getFileName(filePath);
  const ext = base.toLowerCase().split(".").pop() ?? "";
  return IMAGE_EXTS.has(ext);
}

function isAudioPath(filePath: string): boolean {
  const base = getFileName(filePath);
  const ext = base.toLowerCase().split(".").pop() ?? "";
  return AUDIO_EXTS.has(ext);
}

function isDocumentPath(filePath: string): boolean {
  const base = getFileName(filePath);
  const ext = base.toLowerCase().split(".").pop() ?? "";
  return DOCUMENT_EXTS.has(ext);
}

type DiffLine =
  | { type: "unchanged"; text: string; lineNo: number }
  | { type: "removed"; text: string; lineNo: number }
  | { type: "added"; text: string; lineNo: number };

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Myers diff — returns line-level unified diff
function diffLines(oldLines: string[], newLines: string[]): DiffLine[] {
  const m = oldLines.length;
  const n = newLines.length;
  const max = m + n;
  const v: number[] = new Array(2 * max + 1).fill(0);
  const trace: number[][] = [];

  for (let d = 0; d <= max; d++) {
    trace.push([...v]);
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && v[k - 1 + max] < v[k + 1 + max])) {
        x = v[k + 1 + max];
      } else {
        x = v[k - 1 + max] + 1;
      }
      let y = x - k;
      while (x < m && y < n && oldLines[x] === newLines[y]) {
        x++;
        y++;
      }
      v[k + max] = x;
      if (x >= m && y >= n) {
        // backtrack
        const result: DiffLine[] = [];
        let cx = m, cy = n;
        for (let dd = d; dd > 0; dd--) {
          const pv = trace[dd - 1];
          const pk = cx - cy;
          let prevK: number;
          if (pk === -dd || (pk !== dd && pv[pk - 1 + max] < pv[pk + 1 + max])) {
            prevK = pk + 1;
          } else {
            prevK = pk - 1;
          }
          const prevX = pv[prevK + max];
          const prevY = prevX - prevK;
          while (cx > prevX && cy > prevY) {
            cx--;
            cy--;
            result.unshift({ type: "unchanged", text: oldLines[cx], lineNo: cx + 1 });
          }
          if (dd > 0) {
            if (cx > prevX) {
              cx--;
              result.unshift({ type: "removed", text: oldLines[cx], lineNo: cx + 1 });
            } else {
              cy--;
              result.unshift({ type: "added", text: newLines[cy], lineNo: cy + 1 });
            }
          }
        }
        while (cx > 0 && cy > 0) {
          cx--;
          cy--;
          result.unshift({ type: "unchanged", text: oldLines[cx], lineNo: cx + 1 });
        }
        return result;
      }
    }
  }
  // Fallback: treat all as replaced
  return [
    ...oldLines.map((t, i) => ({ type: "removed" as const, text: t, lineNo: i + 1 })),
    ...newLines.map((t, i) => ({ type: "added" as const, text: t, lineNo: i + 1 })),
  ];
}

function DiffView({ oldContent, newContent }: { oldContent: string; newContent: string; language: string }) {
  const oldLines = oldContent.split("\n");
  const newLines = newContent.split("\n");
  const diff = diffLines(oldLines, newLines);

  const hasChanges = diff.some((l) => l.type !== "unchanged");
  if (!hasChanges) {
    return (
      <div style={{ padding: "12px 16px", fontSize: 12, color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>
        No changes
      </div>
    );
  }

  // Render with context: show 3 lines around each change, collapse the rest
  const CONTEXT = 3;
  const changed = new Set(diff.flatMap((l, i) => (l.type !== "unchanged" ? [i] : [])));
  const visible = new Set<number>();
  for (const ci of changed) {
    for (let j = Math.max(0, ci - CONTEXT); j <= Math.min(diff.length - 1, ci + CONTEXT); j++) {
      visible.add(j);
    }
  }

  const segments: Array<{ hidden: true; count: number } | { hidden: false; lines: DiffLine[] }> = [];
  let i = 0;
  while (i < diff.length) {
    if (visible.has(i)) {
      const block: DiffLine[] = [];
      while (i < diff.length && visible.has(i)) {
        block.push(diff[i]);
        i++;
      }
      segments.push({ hidden: false, lines: block });
    } else {
      let count = 0;
      while (i < diff.length && !visible.has(i)) {
        count++;
        i++;
      }
      segments.push({ hidden: true, count });
    }
  }

  // Track running line number for added/unchanged lines
  const newLineNos: number[] = [];
  let nlo = 1;
  for (const line of diff) {
    if (line.type === "removed") {
      newLineNos.push(0);
    } else {
      newLineNos.push(nlo++);
    }
  }

  let diffIdx = 0;

  return (
    <div style={{ fontFamily: "var(--font-mono)", fontSize: 13, lineHeight: 1.6 }}>
      {segments.map((seg, si) => {
        if (seg.hidden) {
          const result = (
            <div
              key={si}
              style={{
                padding: "2px 16px",
                color: "var(--text-dim)",
                background: "var(--bg-panel)",
                fontSize: 11,
                borderTop: "1px solid var(--border)",
                borderBottom: "1px solid var(--border)",
              }}
            >
              ... {seg.count} unchanged lines ...
            </div>
          );
          diffIdx += seg.count;
          return result;
        }
        const lines = seg.lines.map((line, li) => {
          const idx = diffIdx + li;
          const newLno = newLineNos[idx];
          const bg =
            line.type === "added"
              ? "rgba(0,200,80,0.12)"
              : line.type === "removed"
              ? "rgba(240,60,60,0.14)"
              : "transparent";
          const prefix =
            line.type === "added" ? "+" : line.type === "removed" ? "-" : " ";
          const prefixColor =
            line.type === "added" ? "#4ade80" : line.type === "removed" ? "#f87171" : "var(--text-dim)";

          return (
            <div
              key={li}
              style={{
                display: "flex",
                background: bg,
                borderLeft: line.type === "added"
                  ? "3px solid #4ade80"
                  : line.type === "removed"
                  ? "3px solid #f87171"
                  : "3px solid transparent",
              }}
            >
              <span
                style={{
                  minWidth: 44,
                  padding: "0 8px 0 16px",
                  textAlign: "right",
                  color: "var(--text-dim)",
                  userSelect: "none",
                  fontSize: 11,
                  lineHeight: 1.6,
                  borderRight: "1px solid var(--border)",
                  background: "var(--bg-panel)",
                  flexShrink: 0,
                }}
              >
                {line.type === "removed" ? line.lineNo : newLno || ""}
              </span>
              <span
                style={{
                  minWidth: 16,
                  padding: "0 6px",
                  color: prefixColor,
                  userSelect: "none",
                  flexShrink: 0,
                  fontWeight: 600,
                }}
              >
                {prefix}
              </span>
              <span
                style={{
                  flex: 1,
                  padding: "0 8px 0 0",
                  whiteSpace: "pre",
                  color: "var(--text)",
                  overflowX: "auto",
                }}
              >
                {line.text || "\u00a0"}
              </span>
            </div>
          );
        });
        diffIdx += seg.lines.length;
        return <div key={si}>{lines}</div>;
      })}
    </div>
  );
}

function ImageViewer({ filePath, cwd }: { filePath: string; cwd?: string }) {
  const [watching, setWatching] = useState(false);
  const [bust, setBust] = useState(0);
  const [size, setSize] = useState<number | null>(null);
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);

  const ext = getFileName(filePath).toLowerCase().split(".").pop() ?? "";

  useEffect(() => {
    setBust(0);
    setSize(null);
    setNaturalSize(null);
    setError(null);
    setWatching(false);

    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }

    const encoded = encodeFilePathForApi(filePath);
    const es = new EventSource(`/api/files/${encoded}?type=watch`);
    esRef.current = es;

    es.addEventListener("connected", () => setWatching(true));
    es.addEventListener("change", (e) => {
      try {
        const d = JSON.parse((e as MessageEvent).data) as { size?: number };
        if (typeof d.size === "number") setSize(d.size);
      } catch { /* ignore */ }
      setBust((b) => b + 1);
    });
    es.addEventListener("error", () => setWatching(false));
    es.onerror = () => setWatching(false);

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [filePath]);

  const encoded = encodeFilePathForApi(filePath);
  const src = `/api/files/${encoded}?type=read${bust ? `&v=${bust}` : ""}`;

  const formatSizeStr = size != null ? formatSize(size) : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "4px 16px",
          borderBottom: "1px solid var(--border)",
          fontSize: 11,
          color: "var(--text-dim)",
          background: "var(--bg)",
          flexShrink: 0,
        }}
      >
        <span style={{ fontFamily: "var(--font-mono)" }} title={filePath}>
          {getRelativeFilePath(filePath, cwd)}
        </span>
        <span style={{ marginLeft: "auto" }}>{ext || "image"}</span>
        {naturalSize && <span>{naturalSize.w} × {naturalSize.h}</span>}
        {formatSizeStr && <span>{formatSizeStr}</span>}
        <span
          title={watching ? "Live sync active" : "Not watching"}
          style={{ display: "flex", alignItems: "center", gap: 4, color: watching ? "#4ade80" : "var(--text-dim)" }}
        >
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: watching ? "#4ade80" : "var(--border)",
              display: "inline-block",
              boxShadow: watching ? "0 0 4px #4ade80" : "none",
            }}
          />
          {watching ? "live" : "static"}
        </span>
      </div>
      <div
        style={{
          flex: 1,
          overflow: "auto",
          background: "var(--bg-panel)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 16,
          backgroundImage:
            "linear-gradient(45deg, var(--bg) 25%, transparent 25%), linear-gradient(-45deg, var(--bg) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, var(--bg) 75%), linear-gradient(-45deg, transparent 75%, var(--bg) 75%)",
          backgroundSize: "16px 16px",
          backgroundPosition: "0 0, 0 8px, 8px -8px, -8px 0px",
        }}
      >
        {error ? (
          <div style={{ color: "#f87171", fontSize: 13 }}>{error}</div>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt={filePath}
            onLoad={(e) => {
              const img = e.currentTarget;
              setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
            }}
            onError={() => setError("Failed to load image")}
            style={{
              maxWidth: "100%",
              maxHeight: "100%",
              objectFit: "contain",
              boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
            }}
          />
        )}
      </div>
    </div>
  );
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) return "";
  const totalSeconds = Math.round(seconds);
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

function AudioViewer({ filePath, cwd }: { filePath: string; cwd?: string }) {
  const [watching, setWatching] = useState(false);
  const [bust, setBust] = useState(0);
  const [size, setSize] = useState<number | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);

  const ext = getFileName(filePath).toLowerCase().split(".").pop() ?? "";

  useEffect(() => {
    setBust(0);
    setSize(null);
    setDuration(null);
    setError(null);
    setWatching(false);

    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }

    const encoded = encodeFilePathForApi(filePath);
    const es = new EventSource(`/api/files/${encoded}?type=watch`);
    esRef.current = es;

    es.addEventListener("connected", () => setWatching(true));
    es.addEventListener("change", (e) => {
      try {
        const d = JSON.parse((e as MessageEvent).data) as { size?: number };
        if (typeof d.size === "number") setSize(d.size);
      } catch { /* ignore */ }
      setDuration(null);
      setError(null);
      setBust((b) => b + 1);
    });
    es.addEventListener("error", () => setWatching(false));
    es.onerror = () => setWatching(false);

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [filePath]);

  const encoded = encodeFilePathForApi(filePath);
  const src = `/api/files/${encoded}?type=read${bust ? `&v=${bust}` : ""}`;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "4px 16px",
          borderBottom: "1px solid var(--border)",
          fontSize: 11,
          color: "var(--text-dim)",
          background: "var(--bg)",
          flexShrink: 0,
        }}
      >
        <span style={{ fontFamily: "var(--font-mono)" }} title={filePath}>
          {getRelativeFilePath(filePath, cwd)}
        </span>
        <span style={{ marginLeft: "auto" }}>{ext || "audio"}</span>
        {duration != null && <span>{formatDuration(duration)}</span>}
        {size != null && <span>{formatSize(size)}</span>}
        <span
          title={watching ? "Live sync active" : "Not watching"}
          style={{ display: "flex", alignItems: "center", gap: 4, color: watching ? "#4ade80" : "var(--text-dim)" }}
        >
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: watching ? "#4ade80" : "var(--border)",
              display: "inline-block",
              boxShadow: watching ? "0 0 4px #4ade80" : "none",
            }}
          />
          {watching ? "live" : "static"}
        </span>
      </div>
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
          background: "var(--bg-panel)",
        }}
      >
        <div style={{ width: "min(680px, 100%)" }}>
          {error && (
            <div style={{ color: "#f87171", fontSize: 13, marginBottom: 12, textAlign: "center" }}>
              {error}
            </div>
          )}
          <audio
            key={src}
            controls
            preload="metadata"
            src={src}
            onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
            onError={() => setError("Failed to load audio")}
            style={{ width: "100%" }}
          />
        </div>
      </div>
    </div>
  );
}

export function FileViewer({ filePath, cwd }: Props) {
  if (isImagePath(filePath)) {
    return <ImageViewer filePath={filePath} cwd={cwd} />;
  }
  if (isAudioPath(filePath)) {
    return <AudioViewer filePath={filePath} cwd={cwd} />;
  }
  return <TextFileViewer filePath={filePath} cwd={cwd} />;
}

function TextFileViewer({ filePath, cwd }: Props) {
  const { isDark } = useTheme();
  const [data, setData] = useState<FileData | null>(null);
  const [prevContent, setPrevContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [previewMode, setPreviewMode] = useState(false);
  const [viewMode, setViewMode] = useState<"source" | "diff">("source");
  const [wrapLines, setWrapLines] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const [docPreviewHtml, setDocPreviewHtml] = useState<string | null>(null);
  const [docEditHtml, setDocEditHtml] = useState<string | null>(null);
  const [docPreviewError, setDocPreviewError] = useState<string | null>(null);
  const [docPreviewLoading, setDocPreviewLoading] = useState(false);
  const docEditRef = useRef<HTMLDivElement | null>(null);
  const docEditHtmlRef = useRef<string | null>(null);
  const [docEditDirty, setDocEditDirty] = useState(false);
    const savedSelectionRef = useRef<Range | null>(null);

  // 保存当前光标选区（供下拉框等会失焦的操作恢复）
  const saveDocSelection = useCallback(() => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      savedSelectionRef.current = sel.getRangeAt(0).cloneRange();
    }
  }, []);

  // 恢复之前保存的光标选区
  const restoreDocSelection = useCallback(() => {
    const range = savedSelectionRef.current;
    if (!range) return;
    const sel = window.getSelection();
    if (sel) {
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }, []);

  const [watching, setWatching] = useState(false);
  const [changeCount, setChangeCount] = useState(0);
  const esRef = useRef<EventSource | null>(null);
  const isDocument = isDocumentPath(filePath);
  const isPdf = filePath.toLowerCase().endsWith(".pdf");
  const isWord = filePath.toLowerCase().endsWith(".docx");

  const fetchContent = useCallback((filePath: string, isRefresh = false) => {
    const encoded = encodeFilePathForApi(filePath);
    return fetch(`/api/files/${encoded}?type=read`)
      .then((r) => r.json())
      .then((d: FileData & { error?: string }) => {
        if (d.error) {
          setError(d.error);
          return null;
        }
        if (isRefresh) {
          setData((prev) => {
            if (prev) setPrevContent(prev.content);
            return d;
          });
          setChangeCount((c) => c + 1);
          if (!editMode) {
            setDraft(d.content);
          }
        } else {
          setData(d);
          setDraft(d.content);
        }
        return d;
      })
      .catch((e) => {
        setError(String(e));
        return null;
      });
  }, [editMode]);

  const fetchMeta = useCallback((filePath: string) => {
    const encoded = encodeFilePathForApi(filePath);
    return fetch(`/api/files/${encoded}?type=meta`)
      .then((r) => r.json())
      .then((d: { size: number; language: string; mime?: string; error?: string }) => {
        if (d.error) {
          setError(d.error);
          return null;
        }
        setData({ content: "", language: d.language, size: d.size });
        return d;
      })
      .catch((e) => {
        setError(String(e));
        return null;
      });
  }, []);

  const fetchDocPreview = useCallback((filePath: string) => {
    const encoded = encodeFilePathForApi(filePath);
    setDocPreviewLoading(true);
    setDocPreviewError(null);
    setDocPreviewHtml(null);
    return fetch(`/api/files/${encoded}?type=preview`)
      .then(async (res) => {
        if (!res.ok) {
          const json = await res.json().catch(() => null);
          throw new Error(json?.error || res.statusText);
        }
        return res.text();
      })
      .then((html) => {
        setDocPreviewHtml(html);
        setDocEditHtml((prev) => prev ?? html);
        if (docEditHtmlRef.current === null) {
          docEditHtmlRef.current = html;
        }
      })
      .catch((e) => {
        setDocPreviewError(String(e));
      })
      .finally(() => {
        setDocPreviewLoading(false);
      });
  }, []);

  // Initial load + SSE watch setup
  useEffect(() => {
    setLoading(true);
    setError(null);
    setData(null);
    setPrevContent(null);
    setPreviewMode(false);
    setViewMode("source");
    setWrapLines(false);
    setChangeCount(0);
    setWatching(false);
    setDocPreviewHtml(null);
    setDocPreviewError(null);
    setDocPreviewLoading(false);

    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }

    if (isDocument) {
      fetchMeta(filePath).finally(() => setLoading(false));
      if (isWord) {
        fetchDocPreview(filePath);
      }
    } else {
      fetchContent(filePath).then((d) => {
        if (d?.language === "markdown") setPreviewMode(true);
      }).finally(() => setLoading(false));
    }

    // Set up SSE watch
    const encoded = encodeFilePathForApi(filePath);
    const es = new EventSource(`/api/files/${encoded}?type=watch`);
    esRef.current = es;

    es.addEventListener("connected", () => {
      setWatching(true);
    });

    es.addEventListener("change", () => {
      if (isDocument) {
        fetchMeta(filePath).then(() => setChangeCount((c) => c + 1));
      } else {
        fetchContent(filePath, true);
      }
    });

    es.addEventListener("error", () => {
      setWatching(false);
    });

    es.onerror = () => {
      setWatching(false);
    };

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [filePath, fetchContent, fetchMeta, fetchDocPreview]);

  if (loading) {
    return (
      <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: 13 }}>
        Loading...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#f87171", fontSize: 13 }}>
        {error}
      </div>
    );
  }

  if (!data) return null;

  const isHtml = data.language === "html";
  const isMarkdown = data.language === "markdown";
  const lines = data.content.split("\n");
  const hasDiff = prevContent !== null && prevContent !== data.content;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Status bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "4px 16px",
          borderBottom: "1px solid var(--border)",
          fontSize: 11,
          color: "var(--text-dim)",
          background: "var(--bg)",
          flexShrink: 0,
        }}
      >
        <span style={{ fontFamily: "var(--font-mono)" }} title={filePath}>
          {getRelativeFilePath(filePath, cwd)}
        </span>
        <span style={{ marginLeft: "auto" }}>{data.language}</span>
        {viewMode === "source" && !isDocument && <span>{lines.length} lines</span>}
        <span>{formatSize(data.size)}</span>

        {/* Live watch indicator */}
        <span
          title={watching ? "Live sync active" : "Not watching"}
          style={{ display: "flex", alignItems: "center", gap: 4, color: watching ? "#4ade80" : "var(--text-dim)" }}
        >
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: watching ? "#4ade80" : "var(--border)",
              display: "inline-block",
              boxShadow: watching ? "0 0 4px #4ade80" : "none",
            }}
          />
          {watching ? "live" : "static"}
        </span>

        {/* Diff / Source toggle — shown only when there are changes */}
        {hasDiff && (
          <div style={{ display: "flex", borderRadius: 5, overflow: "hidden", border: "1px solid var(--border)" }}>
            <button
              onClick={() => setViewMode("source")}
              style={{
                padding: "2px 8px", fontSize: 11, border: "none", cursor: "pointer",
                background: viewMode === "source" ? "var(--bg-selected)" : "var(--bg-hover)",
                color: viewMode === "source" ? "var(--text)" : "var(--text-muted)",
                fontWeight: viewMode === "source" ? 600 : 400,
              }}
            >
              Source
            </button>
            <button
              onClick={() => setViewMode("diff")}
              style={{
                padding: "2px 8px", fontSize: 11, border: "none", borderLeft: "1px solid var(--border)", cursor: "pointer",
                background: viewMode === "diff" ? "var(--bg-selected)" : "var(--bg-hover)",
                color: viewMode === "diff" ? "var(--text)" : "var(--text-muted)",
                fontWeight: viewMode === "diff" ? 600 : 400,
              }}
            >
              Diff {changeCount > 0 && <span style={{ color: "#4ade80", marginLeft: 2 }}>+{changeCount}</span>}
            </button>
          </div>
        )}

        {/* Word wrap toggle */}
        {viewMode === "source" && !previewMode && (
          <button
            onClick={() => setWrapLines((v) => !v)}
            title={wrapLines ? "Disable word wrap" : "Enable word wrap"}
            style={{
              padding: "2px 8px", fontSize: 11, cursor: "pointer",
              background: wrapLines ? "var(--bg-selected)" : "var(--bg-hover)",
              color: wrapLines ? "var(--text)" : "var(--text-muted)",
              border: "1px solid var(--border)", borderRadius: 5,
              fontWeight: wrapLines ? 600 : 400,
            }}
          >
            wrap
          </button>
        )}

        {/* HTML source/preview toggle */}
        {isHtml && viewMode === "source" && (
          <div style={{ display: "flex", borderRadius: 5, overflow: "hidden", border: "1px solid var(--border)" }}>
            <button
              onClick={() => setPreviewMode(false)}
              style={{
                padding: "2px 8px", fontSize: 11, border: "none", cursor: "pointer",
                background: !previewMode ? "var(--bg-selected)" : "var(--bg-hover)",
                color: !previewMode ? "var(--text)" : "var(--text-muted)",
                fontWeight: !previewMode ? 600 : 400,
              }}
            >
              Code
            </button>
            <button
              onClick={() => setPreviewMode(true)}
              style={{
                padding: "2px 8px", fontSize: 11, border: "none", borderLeft: "1px solid var(--border)", cursor: "pointer",
                background: previewMode ? "var(--bg-selected)" : "var(--bg-hover)",
                color: previewMode ? "var(--text)" : "var(--text-muted)",
                fontWeight: previewMode ? 600 : 400,
              }}
            >
              Preview
            </button>
          </div>
        )}

        {/* Save / edit controls */}
        {(!isDocument || isWord) ? (
          editMode ? (
            <>
              <button
                onClick={async () => {
                  const content = isWord ? (docEditHtmlRef.current ?? docEditHtml) : draft;
                  if (!content) return;
                  setSaving(true);
                  setSaveError(null);
                  setSaveSuccess(null);
                  const encoded = encodeFilePathForApi(filePath);
                  try {
                    const res = await fetch(`/api/files/${encoded}`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ content }),
                    });
                    const result = await res.json();
                    if (!res.ok) {
                      throw new Error(result?.error || res.statusText);
                    }
                    setData((prev) => prev ? { ...prev, size: result.size ?? prev.size } : { content: "", language: data.language, size: result.size ?? data.size });
                    if (isWord) {
                      setDocPreviewHtml(content);
                      setDocEditHtml(content);
                      docEditHtmlRef.current = content;
                                            docEditHtmlRef.current = content;
                      setDocEditDirty(false);
                    } else {
                      setPrevContent(data.content);
                    }
                    setEditMode(false);
                    setSaveSuccess("Saved");
                    window.setTimeout(() => setSaveSuccess(null), 3000);
                  } catch (e) {
                    setSaveError(String(e));
                  } finally {
                    setSaving(false);
                  }
                }}
                disabled={saving || (isWord ? !docEditDirty : draft === null || draft === data.content)}
                title="Save file"
                style={{
                  padding: "2px 8px", fontSize: 11,
                  cursor: (saving || (isWord ? !docEditDirty : draft === null || draft === data.content)) ? "not-allowed" : "pointer",
                  background: (saving || (isWord ? !docEditDirty : draft === null || draft === data.content)) ? "var(--bg)" : "var(--bg-selected)",
                  color: (saving || (isWord ? !docEditDirty : draft === null || draft === data.content)) ? "var(--text-muted)" : "var(--text)",
                  border: "1px solid var(--border)", borderRadius: 5,
                  fontWeight: 600,
                  opacity: (saving || (isWord ? !docEditDirty : draft === null || draft === data.content)) ? 0.5 : 1,
                }}
              >
                {saving ? "Saving..." : "Save"}
              </button>
              <button
                onClick={() => {
                  setEditMode(false);
                  setSaveError(null);
                  if (isWord) {
                    setDocEditHtml(docPreviewHtml);
                    docEditHtmlRef.current = docPreviewHtml;
                                        setDocEditDirty(false);
                  } else {
                    setDraft(data.content);
                  }
                }}
                title="Cancel editing"
                style={{
                  padding: "2px 8px", fontSize: 11, cursor: "pointer",
                  background: "var(--bg-hover)",
                  color: "var(--text-muted)",
                  border: "1px solid var(--border)", borderRadius: 5,
                  fontWeight: 400,
                }}
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              onClick={() => {
                setEditMode(true);
                setSaveError(null);
                setSaveSuccess(null);
                if (isWord) {
                  setDocEditHtml(docPreviewHtml);
                  docEditHtmlRef.current = docPreviewHtml;
                  setDocEditDirty(false);
                } else {
                  setDraft(data.content);
                }
              }}
              title="Edit file content"
              style={{
                padding: "2px 8px", fontSize: 11, cursor: "pointer",
                background: "var(--bg-hover)",
                color: "var(--text-muted)",
                border: "1px solid var(--border)", borderRadius: 5,
                fontWeight: 400,
              }}
            >
              Edit
            </button>
          )
        ) : null}

        {saveSuccess && (
          <span style={{ color: "#4ade80", fontWeight: 600 }}>{saveSuccess}</span>
        )}
        {saveError && (
          <span style={{ color: "#f87171", fontWeight: 600 }}>{saveError}</span>
        )}

        {/* Markdown preview/raw toggle */}
        {isMarkdown && viewMode === "source" && (
          <div style={{ display: "flex", borderRadius: 5, overflow: "hidden", border: "1px solid var(--border)" }}>
            <button
              onClick={() => setPreviewMode(true)}
              style={{
                padding: "2px 8px", fontSize: 11, border: "none", cursor: "pointer",
                background: previewMode ? "var(--bg-selected)" : "var(--bg-hover)",
                color: previewMode ? "var(--text)" : "var(--text-muted)",
                fontWeight: previewMode ? 600 : 400,
              }}
            >
              Preview
            </button>
            <button
              onClick={() => setPreviewMode(false)}
              style={{
                padding: "2px 8px", fontSize: 11, border: "none", borderLeft: "1px solid var(--border)", cursor: "pointer",
                background: !previewMode ? "var(--bg-selected)" : "var(--bg-hover)",
                color: !previewMode ? "var(--text)" : "var(--text-muted)",
                fontWeight: !previewMode ? 600 : 400,
              }}
            >
              Raw
            </button>
          </div>
        )}
      </div>

      {/* Content area */}
      <div style={{ flex: 1, overflow: "auto", background: "var(--bg)" }}>
        {viewMode === "diff" && hasDiff ? (
          <DiffView oldContent={prevContent!} newContent={data.content} language={data.language} />
        ) : isHtml && previewMode ? (
          <iframe
            srcDoc={editMode ? draft ?? data.content : data.content}
            sandbox="allow-scripts"
            style={{ width: "100%", height: "100%", border: "none", background: "var(--bg)" }}
            title="HTML preview"
          />
        ) : isMarkdown && previewMode ? (
          <div
            className="markdown-body markdown-file-preview"
            style={{ padding: "24px 32px", maxWidth: 800 }}
          >
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{editMode ? draft ?? data.content : data.content}</ReactMarkdown>
          </div>
        ) : isDocument ? (
          isPdf ? (
            <div style={{ height: "100%", display: "flex", flexDirection: "column", background: "var(--bg)" }}>
              <div style={{ padding: 16, borderBottom: "1px solid var(--border)", background: "var(--bg)", color: "var(--text-dim)" }}>
                PDF preview
              </div>
              <iframe
                src={`/api/files/${encodeFilePathForApi(filePath)}?type=read${changeCount ? `&v=${changeCount}` : ""}`}
                style={{ width: "100%", height: "100%", border: "none", background: "var(--bg)" }}
                title={`Preview ${getFileName(filePath)}`}
              />
              <div style={{ padding: "10px 16px", borderTop: "1px solid var(--border)", fontSize: 12, color: "var(--text-dim)", background: "var(--bg-panel)" }}>
                <a href={`/api/files/${encodeFilePathForApi(filePath)}?type=read`} target="_blank" rel="noreferrer" style={{ color: "var(--text)", textDecoration: "underline" }}>
                  Open in new tab
                </a>
              </div>
            </div>
          ) : isWord ? (
            <div style={{ height: "100%", display: "flex", flexDirection: "column", background: "var(--bg)" }}>
              <div style={{ padding: 16, borderBottom: "1px solid var(--border)", background: "var(--bg)", color: "var(--text-dim)" }}>
                Word preview
              </div>
              {editMode ? (
                docEditHtml ? (
                  <>
                    {/* Rich text toolbar */}
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 1,
                        padding: "6px 10px",
                        borderBottom: "1px solid var(--border)",
                        background: "var(--bg)",
                        flexWrap: "wrap",
                      }}
                    >
                      {[
                        { cmd: "bold", icon: "B", title: "加粗", style: { fontWeight: 700 } },
                        { cmd: "italic", icon: "I", title: "斜体", style: { fontStyle: "italic" } },
                        { cmd: "underline", icon: "U", title: "下划线", style: { textDecoration: "underline" } },
                        { cmd: "strikeThrough", icon: "S", title: "删除线", style: { textDecoration: "line-through" } },
                        { sep: true },
                        { cmd: "insertUnorderedList", icon: "☰", title: "无序列表" },
                        { cmd: "insertOrderedList", icon: "№", title: "有序列表" },
                        { sep: true },
                        { cmd: "justifyLeft", icon: "≡←", title: "左对齐" },
                        { cmd: "justifyCenter", icon: "≡↔", title: "居中" },
                        { cmd: "justifyRight", icon: "≡→", title: "右对齐" },
                        { sep: true },
                        { cmd: "indent", icon: "→≡", title: "增加缩进" },
                        { cmd: "outdent", icon: "≡←", title: "减少缩进" },
                        { sep: true },
                      ].map((item, i) =>
                        item.sep ? (
                          <div key={`s${i}`} style={{ width: 1, height: 22, background: "var(--border)", margin: "0 4px" }} />
                        ) : (
                          <button
                            key={item.cmd}
                            title={item.title}
                            onMouseDown={(e) => {
                              e.preventDefault(); // 阻止失焦，保持光标位置
                              document.execCommand(item.cmd!, false);
                              if (docEditRef.current) {
                                docEditHtmlRef.current = docEditRef.current.innerHTML;
                                setDocEditDirty(true);
                              }
                            }}
                            style={{
                              padding: "3px 8px",
                              fontSize: 13,
                              cursor: "pointer",
                              border: "1px solid var(--border)",
                              borderRadius: 4,
                              background: "var(--bg-hover)",
                              color: "var(--text)",
                              minWidth: 28,
                              textAlign: "center",
                              lineHeight: 1.4,
                              fontFamily: "var(--font-sans)",
                              transition: "background 0.15s",
                              ...item.style,
                            }}
                          >
                            {item.icon}
                          </button>
                        )
                      )}
                      {/* Heading selector */}
                      <select
                        title="标题级别"
                        onChange={(e) => {
                          const val = e.target.value;
                          if (!val) return;
                          // 恢复之前保存的光标位置
                          restoreDocSelection();
                          if (val === "p") {
                            document.execCommand("formatBlock", false, "p");
                          } else {
                            document.execCommand("formatBlock", false, val);
                          }
                          if (docEditRef.current) {
                            docEditHtmlRef.current = docEditRef.current.innerHTML;
                            setDocEditDirty(true);
                          }
                          e.target.value = ""; // 重置以便重复选择
                        }}
                        style={{
                          padding: "3px 6px",
                          fontSize: 12,
                          border: "1px solid var(--border)",
                          borderRadius: 4,
                          background: "var(--bg-hover)",
                          color: "var(--text)",
                          cursor: "pointer",
                          fontFamily: "var(--font-sans)",
                          minWidth: 48,
                        }}
                        defaultValue=""
                      >
                        <option value="" disabled>标题</option>
                        <option value="h1">标题1</option>
                        <option value="h2">标题2</option>
                        <option value="h3">标题3</option>
                        <option value="h4">标题4</option>
                        <option value="p">正文</option>
                      </select>
                      {/* Font size selector */}
                      <select
                        title="字号"
                        onChange={(e) => {
                          const val = e.target.value;
                          if (!val) return;
                          restoreDocSelection();
                          document.execCommand("fontSize", false, val);
                          if (docEditRef.current) {
                            docEditHtmlRef.current = docEditRef.current.innerHTML;
                            setDocEditDirty(true);
                          }
                          e.target.value = ""; // 重置以便重复选择
                        }}
                        style={{
                          padding: "3px 6px",
                          fontSize: 12,
                          border: "1px solid var(--border)",
                          borderRadius: 4,
                          background: "var(--bg-hover)",
                          color: "var(--text)",
                          cursor: "pointer",
                          fontFamily: "var(--font-sans)",
                          minWidth: 48,
                        }}
                        defaultValue=""
                      >
                        <option value="" disabled>字号</option>
                        <option value="1">10px</option>
                        <option value="2">13px</option>
                        <option value="3">16px</option>
                        <option value="4">18px</option>
                        <option value="5">24px</option>
                        <option value="6">32px</option>
                        <option value="7">48px</option>
                      </select>
                      {/* Text color */}
                      <label title="文字颜色" style={{ position: "relative", cursor: "pointer", display: "inline-flex", alignItems: "center" }}>
                        <span style={{
                          padding: "3px 8px",
                          fontSize: 13,
                          border: "1px solid var(--border)",
                          borderRadius: 4,
                          background: "var(--bg-hover)",
                          color: "var(--text)",
                          fontFamily: "var(--font-sans)",
                          lineHeight: 1.4,
                        }}>A<span
                          id="docColorBar"
                          style={{
                            display: "block",
                            height: 3,
                            borderRadius: 1,
                            margin: "-1px 2px 0",
                            background: "#ff0000",
                          }}
                        /></span>
                        <input
                          type="color"
                          id="docColorPicker"
                          style={{
                            position: "absolute",
                            width: 0,
                            height: 0,
                            opacity: 0,
                            pointerEvents: "none",
                          }}
                          onChange={(e) => {
                            restoreDocSelection();
                            document.execCommand("foreColor", false, e.target.value);
                            // 更新颜色指示条
                            const bar = document.getElementById("docColorBar");
                            if (bar) bar.style.background = e.target.value;
                            if (docEditRef.current) {
                              docEditHtmlRef.current = docEditRef.current.innerHTML;
                              setDocEditDirty(true);
                            }
                          }}
                        />
                      </label>
                      {/* Clear formatting */}
                      <button
                        title="清除格式"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          document.execCommand("removeFormat", false);
                          if (docEditRef.current) {
                            docEditHtmlRef.current = docEditRef.current.innerHTML;
                            setDocEditDirty(true);
                          }
                        }}
                        style={{
                          padding: "3px 8px",
                          fontSize: 13,
                          cursor: "pointer",
                          border: "1px solid var(--border)",
                          borderRadius: 4,
                          background: "var(--bg-hover)",
                          color: "var(--text)",
                          fontFamily: "var(--font-sans)",
                          lineHeight: 1.4,
                        }}
                      >
                        清除
                      </button>
                    </div>
                    {/* Editable area */}
                    <div
                      ref={(el) => { docEditRef.current = el; }}
                      contentEditable
                      suppressContentEditableWarning
                      dangerouslySetInnerHTML={{ __html: docEditHtml ?? "" }}
                      onInput={(e) => {
                        docEditHtmlRef.current = (e.target as HTMLDivElement).innerHTML;
                        setDocEditDirty(true);
                      }}
                      onKeyUp={saveDocSelection}
                      onMouseUp={saveDocSelection}
                      style={{
                        flex: 1,
                        width: "100%",
                        overflow: "auto",
                        padding: 16,
                        background: "var(--bg-panel)",
                        color: "var(--text)",
                        fontFamily: "var(--font-sans)",
                        fontSize: 14,
                        lineHeight: 1.6,
                        outline: "none",
                      }}
                    />
                  </>
                ) : docPreviewLoading ? (
                  <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)" }}>
                    Loading Word preview...
                  </div>
                ) : (
                  <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 24, background: "var(--bg)" }}>
                    <div style={{ maxWidth: 520, textAlign: "center", color: "var(--text-dim)" }}>
                      <p style={{ marginBottom: 8, fontSize: 14, color: "var(--text)" }}>
                        Word 文档编辑时需要加载预览内容。
                      </p>
                      {docPreviewError && <p style={{ marginBottom: 16, color: "#f87171" }}>{docPreviewError}</p>}
                    </div>
                  </div>
                )
              ) : docPreviewLoading ? (
                <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)" }}>
                  Loading Word preview...
                </div>
              ) : docPreviewHtml ? (
                <iframe
                  srcDoc={docPreviewHtml}
                  sandbox="allow-same-origin"
                  style={{ width: "100%", height: "100%", border: "none", background: "var(--bg)" }}
                  title={`Preview ${getFileName(filePath)}`}
                />
              ) : (
                <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 24, background: "var(--bg)" }}>
                  <div style={{ maxWidth: 520, textAlign: "center", color: "var(--text-dim)" }}>
                    <p style={{ marginBottom: 8, fontSize: 14, color: "var(--text)" }}>
                      Word 文档预览当前不可用。
                    </p>
                    {docPreviewError && <p style={{ marginBottom: 16, color: "#f87171" }}>{docPreviewError}</p>}
                    <a
                      href={`/api/files/${encodeFilePathForApi(filePath)}?type=read`}
                      download={getFileName(filePath)}
                      style={{
                        display: "inline-block",
                        padding: "8px 12px",
                        borderRadius: 5,
                        background: "var(--bg-selected)",
                        color: "var(--text)",
                        textDecoration: "none",
                        fontWeight: 600,
                      }}
                    >
                      下载文件
                    </a>
                  </div>
                </div>
              )}
              <div style={{ padding: "10px 16px", borderTop: "1px solid var(--border)", fontSize: 12, color: "var(--text-dim)", background: "var(--bg-panel)" }}>
                <a href={`/api/files/${encodeFilePathForApi(filePath)}?type=read`} target="_blank" rel="noreferrer" style={{ color: "var(--text)", textDecoration: "underline" }}>
                  Open in new tab
                </a>
              </div>
            </div>
          ) : (
            <div style={{ height: "100%", display: "flex", flexDirection: "column", background: "var(--bg)" }}>
              <div style={{ padding: 16, borderBottom: "1px solid var(--border)", background: "var(--bg)", color: "var(--text-dim)" }}>
                Document preview
              </div>
              <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 24, background: "var(--bg)" }}>
                <div style={{ maxWidth: 520, textAlign: "center", color: "var(--text-dim)" }}>
                  <p style={{ marginBottom: 8, fontSize: 14, color: "var(--text)" }}>
                    此文档类型可能无法在浏览器中预览。
                  </p>
                  <p style={{ marginBottom: 16 }}>
                    请下载后在本机应用中打开。
                  </p>
                  <a
                    href={`/api/files/${encodeFilePathForApi(filePath)}?type=read`}
                    download={getFileName(filePath)}
                    style={{
                      display: "inline-block",
                      padding: "8px 12px",
                      borderRadius: 5,
                      background: "var(--bg-selected)",
                      color: "var(--text)",
                      textDecoration: "none",
                      fontWeight: 600,
                    }}
                  >
                    下载文件
                  </a>
                </div>
              </div>
              <div style={{ padding: "10px 16px", borderTop: "1px solid var(--border)", fontSize: 12, color: "var(--text-dim)", background: "var(--bg-panel)" }}>
                <a href={`/api/files/${encodeFilePathForApi(filePath)}?type=read`} target="_blank" rel="noreferrer" style={{ color: "var(--text)", textDecoration: "underline" }}>
                  Open in new tab
                </a>
              </div>
            </div>
          )
        ) : editMode ? (
          <textarea
            value={draft ?? data.content}
            onChange={(e) => setDraft(e.target.value)}
            style={{
              width: "100%",
              height: "100%",
              resize: "none",
              border: "none",
              background: "var(--bg-panel)",
              color: "var(--text)",
              fontFamily: "var(--font-mono)",
              fontSize: 13,
              lineHeight: 1.6,
              padding: 16,
              outline: "none",
              whiteSpace: "pre",
            }}
          />
        ) : (
          <SyntaxHighlighter
            language={data.language === "text" ? "plaintext" : data.language}
            style={isDark ? vscDarkPlus : vs}
            showLineNumbers
            lineNumberStyle={{
              color: "var(--text-dim)",
              fontStyle: "normal",
              minWidth: "3em",
              paddingRight: "1em",
            }}
            customStyle={{
              margin: 0,
              padding: "12px 0",
              background: "var(--bg)",
              fontSize: 13,
              lineHeight: 1.6,
              fontFamily: "var(--font-mono)",
              minHeight: "100%",
            }}
            codeTagProps={{ style: { fontFamily: "var(--font-mono)" } }}
            wrapLongLines={wrapLines}
          >
            {data.content}
          </SyntaxHighlighter>
        )}
      </div>
    </div>
  );
}
