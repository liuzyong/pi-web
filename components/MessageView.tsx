"use client";

import { useState, useRef, useEffect, useMemo, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vs } from "react-syntax-highlighter/dist/cjs/styles/prism";
import { vscDarkPlus } from "react-syntax-highlighter/dist/cjs/styles/prism";
import { useTheme } from "@/hooks/useTheme";
import { getFileIcon } from "./FileIcons";
import type {
  AgentMessage,
  UserMessage,
  AssistantMessage,
  ToolResultMessage,
  AssistantContentBlock,
  TextContent,
  ImageContent,
  FileContent,
  ToolCallContent,
  ThinkingContent,
} from "@/lib/types";
import {
  extractIntentionsFromMessage,
  getVisibleIntentions,
  getDetectionConfig,
  type FileIntention,
  type FileMutationKind,
} from "@/lib/file-intent";

interface Props {
  message: AgentMessage;
  isStreaming?: boolean;
  toolResults?: Map<string, ToolResultMessage>;
  modelNames?: Record<string, string>;
  entryId?: string;
  onFork?: (entryId: string) => void;
  forking?: boolean;
  onNavigate?: (entryId: string) => void;
  prevAssistantEntryId?: string;
  onEditContent?: (content: string) => void;
  showTimestamp?: boolean;
  prevTimestamp?: number;
  onOpenFile?: (filePath: string, fileName: string) => void;
  cwd?: string;
}

function formatTime(ts?: number): string | null {
  if (!ts) return null;
  const d = new Date(ts);
  const now = new Date();
  const isToday = d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (isToday) return time;
  const date = d.toLocaleDateString([], { month: "short", day: "numeric", year: d.getFullYear() !== now.getFullYear() ? "numeric" : undefined });
  return `${date} ${time}`;
}

function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text);
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    return Promise.resolve();
  } catch {
    return Promise.reject();
  }
}

export function MessageView({ message, isStreaming, toolResults, modelNames, entryId, onFork, forking, onNavigate, prevAssistantEntryId, onEditContent, showTimestamp, prevTimestamp, onOpenFile, cwd }: Props) {
  if (message.role === "user") {
    return <UserMessageView message={message as UserMessage} entryId={entryId} onFork={onFork} forking={forking} onNavigate={onNavigate} prevAssistantEntryId={prevAssistantEntryId} onEditContent={onEditContent} />;
  }
  if (message.role === "assistant") {
    return <AssistantMessageView message={message as AssistantMessage} isStreaming={isStreaming} toolResults={toolResults} modelNames={modelNames} showTimestamp={showTimestamp} prevTimestamp={prevTimestamp} onOpenFile={onOpenFile} cwd={cwd} />;
  }
  if (message.role === "toolResult") {
    // Rendered inline under its toolCall — skip standalone rendering if paired
    return null;
  }
  return null;
}

function UserMessageView({ message, entryId, onFork, forking, onNavigate, prevAssistantEntryId, onEditContent }: {
  message: UserMessage;
  entryId?: string;
  onFork?: (entryId: string) => void;
  forking?: boolean;
  onNavigate?: (entryId: string) => void;
  prevAssistantEntryId?: string;
  onEditContent?: (content: string) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [copied, setCopied] = useState(false);

  const content =
    typeof message.content === "string"
      ? message.content
      : message.content
          .filter((b): b is TextContent => b.type === "text")
          .map((b) => b.text)
          .join("\n");

  const imageBlocks: ImageContent[] =
    typeof message.content === "string"
      ? []
      : message.content.filter((b): b is ImageContent => b.type === "image");

  const fileBlocks: FileContent[] =
    typeof message.content === "string"
      ? []
      : message.content.filter((b): b is FileContent => b.type === "file");

  const time = formatTime(message.timestamp);
  const canFork = !!entryId && !!onFork;
  const canNavigate = !!prevAssistantEntryId && !!onNavigate;

  const copyContent = () => {
    copyText(content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div
      style={{ marginBottom: 16, display: "flex", flexDirection: "column", alignItems: "flex-end" }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div style={{ display: "flex", alignItems: "flex-end", gap: 6, maxWidth: "85%" }}>
        <div
          style={{
            flex: 1,
            minWidth: 0,
            background: "var(--user-bg-solid)",
            border: "1px solid var(--accent-soft)",
            borderRadius: 14,
            padding: "8px 12px",
            fontSize: 14,
            lineHeight: 1.6,
            color: "var(--text)",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {imageBlocks.length > 0 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: content ? 8 : 0 }}>
              {imageBlocks.map((img, i) => {
                // lib/types.ts ImageContent uses {source:{type,data,media_type,url}}
                // pi-ai on-disk format uses flat {data, mimeType} — handle both
                const flat = img as unknown as { data?: string; mimeType?: string };
                const src = img.source
                  ? img.source.type === "base64"
                    ? `data:${img.source.media_type};base64,${img.source.data}`
                    : img.source.url ?? ""
                  : flat.data
                    ? `data:${flat.mimeType};base64,${flat.data}`
                    : "";
                return (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={i}
                    src={src}
                    alt=""
                    style={{ maxWidth: 240, maxHeight: 240, borderRadius: 6, objectFit: "contain", display: "block", border: "1px solid rgba(59,130,246,0.15)" }}
                  />
                );
              })}
            </div>
          )}
          {fileBlocks.length > 0 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: content ? 8 : 0 }}>
              {fileBlocks.map((file, i) => (
                <a
                  key={i}
                  href={file.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  download={file.name}
                  title={`${file.name} (${file.mimeType})`}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    minWidth: 180,
                    maxWidth: 280,
                    padding: "8px 10px",
                    background: "var(--card-bg, rgba(255,255,255,0.04))",
                    border: "1px solid var(--accent-soft, rgba(59,130,246,0.2))",
                    borderRadius: 8,
                    textDecoration: "none",
                    color: "var(--text)",
                    fontSize: 13,
                    lineHeight: 1.3,
                    transition: "background 120ms",
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLElement).style.background = "var(--accent-soft, rgba(59,130,246,0.12))";
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLElement).style.background = "var(--card-bg, rgba(255,255,255,0.04))";
                  }}
                >
                  <span style={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
                    {getFileIcon(file.name, 24)}
                  </span>
                  <span style={{ display: "flex", flexDirection: "column", minWidth: 0, flex: 1 }}>
                    <span
                      style={{
                        fontWeight: 500,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {file.name}
                    </span>
                    <span style={{ fontSize: 11, opacity: 0.65 }}>{formatFileSize(file.size)}</span>
                  </span>
                </a>
              ))}
            </div>
          )}
          {content}
        </div>

      </div>

      {/* Bottom row: action buttons + timestamp */}
      {(time || canFork || canNavigate || true) && (
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "flex-end",
          gap: 6, marginTop: 3,
        }}>
          <div style={{
            display: "flex", gap: 3,
            opacity: hovered ? 1 : 0,
            pointerEvents: hovered ? "auto" : "none",
            transition: "opacity 0.12s",
          }}>
            <button
              onClick={copyContent}
              title="Copy message"
              style={{
                display: "flex", alignItems: "center", gap: 4,
                padding: "3px 8px", height: 22,
                background: "none", border: "none",
                borderRadius: 5,
                color: copied ? "var(--accent)" : "var(--text-dim)",
                cursor: "pointer",
                fontSize: 11, fontWeight: 400,
                whiteSpace: "nowrap",
                transition: "color 0.12s",
              }}
              onMouseEnter={(e) => { if (!copied) e.currentTarget.style.color = "var(--accent)"; }}
              onMouseLeave={(e) => { if (!copied) e.currentTarget.style.color = "var(--text-dim)"; }}
            >
              {copied ? (
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              ) : (
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
              )}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          {(canFork || canNavigate) && (
            <div style={{
              display: "flex", gap: 3,
              opacity: (hovered || forking) ? 1 : 0,
              pointerEvents: (hovered || forking) ? "auto" : "none",
              transition: "opacity 0.12s",
            }}>
              {canNavigate && (
                <button
                  onClick={() => { onNavigate!(prevAssistantEntryId!); onEditContent?.(content); }}
                  title="Edit from here — branches within this session"
                  style={{
                    display: "flex", alignItems: "center", gap: 4,
                    padding: "3px 8px", height: 22,
                    background: "none", border: "none",
                    borderRadius: 5,
                    color: "var(--text-dim)",
                    cursor: "pointer",
                    fontSize: 11, fontWeight: 400,
                    whiteSpace: "nowrap",
                    transition: "color 0.12s",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = "var(--accent)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-dim)"; }}
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="15 10 20 15 15 20" />
                    <path d="M4 4v7a4 4 0 0 0 4 4h12" />
                  </svg>
                  Edit from here
                </button>
              )}
              {canFork && (
                <button
                  onClick={() => { onFork!(entryId!); }}
                  disabled={forking}
                  title={forking ? "Creating new session…" : "New session — creates an independent copy from here"}
                  style={{
                    display: "flex", alignItems: "center", gap: 4,
                    padding: "3px 8px", height: 22,
                    background: "none", border: "none",
                    borderRadius: 5,
                    color: forking ? "var(--accent)" : "var(--text-dim)",
                    cursor: forking ? "not-allowed" : "pointer",
                    fontSize: 11, fontWeight: 400,
                    whiteSpace: "nowrap",
                    transition: "color 0.12s",
                  }}
                  onMouseEnter={(e) => { if (!forking) e.currentTarget.style.color = "var(--accent)"; }}
                  onMouseLeave={(e) => { if (!forking) e.currentTarget.style.color = "var(--text-dim)"; }}
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="6" y1="3" x2="6" y2="15" />
                    <circle cx="18" cy="6" r="3" />
                    <circle cx="6" cy="18" r="3" />
                    <path d="M18 9a9 9 0 0 1-9 9" />
                  </svg>
                  {forking ? "Creating…" : "New session"}
                </button>
              )}
            </div>
          )}
          {time && <span style={{ fontSize: 10, color: "var(--text-dim)" }}>{time}</span>}
        </div>
      )}
    </div>
  );
}

function AssistantMessageView({
  message,
  isStreaming,
  toolResults,
  modelNames,
  showTimestamp,
  prevTimestamp,
  onOpenFile,
  cwd,
}: {
  message: AssistantMessage;
  isStreaming?: boolean;
  toolResults?: Map<string, ToolResultMessage>;
  modelNames?: Record<string, string>;
  showTimestamp?: boolean;
  prevTimestamp?: number;
  onOpenFile?: (filePath: string, fileName: string) => void;
  cwd?: string;
}) {
  const time = showTimestamp ? formatTime(message.timestamp) : null;
  const blocks = message.content ?? [];
  const [hovered, setHovered] = useState(false);
  const [copied, setCopied] = useState(false);
  const streamStartRef = useRef<number | null>(null);
  const [tps, setTps] = useState<number | null>(null);
  const blocksRef = useRef(blocks);
  blocksRef.current = blocks;

  // Streaming-based timing for thinking blocks
  const blockStartTimesRef = useRef<Map<number, number>>(new Map());
  const [streamingDurations, setStreamingDurations] = useState<Map<number, number>>(new Map());

  // Thinking duration derived from file timestamps: time from prev message end to this message end
  // This is the total generation time (thinking + any text before first tool call)
  const thinkingDurationFromFile = useMemo<number | undefined>(() => {
    if (!message.timestamp || !prevTimestamp) return undefined;
    const secs = Math.round((message.timestamp - prevTimestamp) / 1000);
    return secs > 0 ? secs : undefined;
  }, [message.timestamp, prevTimestamp]);

  // Tool call durations derived from session file timestamps (accurate for completed messages)
  // assistant message timestamp = when generation ended = when tools started running
  // toolResult timestamp = when tool execution finished
  const toolCallDurations = useMemo<Map<string, number>>(() => {
    const map = new Map<string, number>();
    if (!toolResults || !message.timestamp) return map;
    for (const [callId, result] of toolResults) {
      if (result.timestamp && message.timestamp) {
        const secs = Math.round((result.timestamp - message.timestamp) / 1000);
        if (secs > 0) map.set(callId, secs);
      }
    }
    return map;
  }, [toolResults, message.timestamp]);

  const textContent = blocks
    .filter((b): b is TextContent => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  // Collect file intentions (mutations) from text blocks and tool call blocks.
  // Detection is intent-based: any file the AI caused to change, regardless of
  // which directory it lives in. Backed by lib/file-intent.ts.
  const fileIntentions = useMemo<FileIntention[]>(() => {
    const config = getDetectionConfig();
    const raw = extractIntentionsFromMessage(blocks, toolResults, config);
    const visible = getVisibleIntentions(raw, config);
    // Dedupe by filename (basename) — same file may appear via tool input,
    // bash output, or result text, and as both absolute and relative paths.
    // Prefer the longest (most specific) path; on basename tie, prefer
    // `create` over `edit` so a re-create replaces an earlier edit.
    const byBasename = new Map<string, FileIntention>();
    const kindRank: Record<FileMutationKind, number> = { create: 2, edit: 1 };
    for (const intent of visible) {
      const resolved = resolveFilePath(intent.path, cwd).replace(/\\/g, "/");
      const basename = resolved.split("/").pop()?.toLowerCase() ?? resolved.toLowerCase();
      const existing = byBasename.get(basename);
      if (!existing) {
        byBasename.set(basename, { ...intent, path: resolved });
        continue;
      }
      const samePath = existing.path === resolved;
      const longerPath = resolved.length > existing.path.length;
      const betterKind = kindRank[intent.kind] > kindRank[existing.kind];
      if (samePath && betterKind) {
        byBasename.set(basename, { ...intent, path: resolved });
      } else if (longerPath && !samePath) {
        byBasename.set(basename, { ...intent, path: resolved });
      }
    }
    return Array.from(byBasename.values());
  }, [blocks, toolResults, cwd]);

  const copyContent = () => {
    copyText(textContent).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  useEffect(() => {
    if (!isStreaming) {
      // Finalise any un-finished thinking block durations on stream end
      const now = Date.now();
      setStreamingDurations((prev: Map<number, number>) => {
        const next = new Map(prev);
        for (const [idx, start] of blockStartTimesRef.current) {
          if (!next.has(idx)) next.set(idx, Math.round((now - start) / 1000));
        }
        return next;
      });
      streamStartRef.current = null;
      setTps(null);
      return;
    }
    const tick = () => {
      const bs = blocksRef.current;
      const now = Date.now();

      // Record start time for each block the first time we see it
      bs.forEach((_, i) => {
        if (!blockStartTimesRef.current.has(i)) blockStartTimesRef.current.set(i, now);
      });

      // When a non-last block has a successor already started, finalise its duration
      setStreamingDurations((prev: Map<number, number>) => {
        let changed = false;
        const next = new Map(prev);
        for (let i = 0; i < bs.length - 1; i++) {
          if (!next.has(i) && blockStartTimesRef.current.has(i)) {
            const start = blockStartTimesRef.current.get(i)!;
            const nextStart = blockStartTimesRef.current.get(i + 1) ?? now;
            next.set(i, Math.round((nextStart - start) / 1000));
            changed = true;
          }
        }
        return changed ? next : prev;
      });

      let chars = 0;
      for (const b of bs) {
        if (b.type === "text") chars += (b as TextContent).text?.length ?? 0;
        else if (b.type === "thinking") chars += (b as ThinkingContent).thinking?.length ?? 0;
        else if (b.type === "toolCall") chars += JSON.stringify((b as ToolCallContent).input ?? {}).length;
      }
      if (chars === 0) return;
      if (streamStartRef.current === null) streamStartRef.current = now;
      const elapsed = (now - streamStartRef.current) / 1000;
      if (elapsed > 0.5) setTps(chars / 4 / elapsed);
    };
    const id = setInterval(tick, 300);
    return () => clearInterval(id);
  }, [isStreaming]);

  return (
    <div
      style={{ marginBottom: 16 }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Model label */}
      <div
        style={{
          fontSize: 11,
          color: "var(--text-dim)",
          marginBottom: 4,
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        {message.provider && (
          <span>{modelNames?.[`${message.provider}:${message.model}`] ?? modelNames?.[message.model] ?? message.model}</span>
        )}
        {isStreaming && (() => {
          let chars = 0;
          for (const b of blocks) {
            if (b.type === "text") chars += (b as TextContent).text?.length ?? 0;
            else if (b.type === "thinking") chars += (b as ThinkingContent).thinking?.length ?? 0;
            else if (b.type === "toolCall") chars += JSON.stringify((b as ToolCallContent).input ?? {}).length;
          }
          const est = Math.round(chars / 4);
          return (
            <>

              {est > 0 && (
                <span style={{ display: "flex", alignItems: "center", gap: 4, color: "var(--text)" }} title="预估 token 数（流式接收中）">
                  <span style={{ display: "flex", alignItems: "center", gap: 2, fontSize: 11, fontWeight: 400 }}>
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="5" y1="1.5" x2="5" y2="8.5" /><polyline points="2 6 5 8.5 8 6" />
                    </svg>
                    {est}
                  </span>
                  {tps !== null && (() => {
                    const bg = tps >= 50 ? "#53b3cb" : tps >= 30 ? "#9bc53d" : tps >= 15 ? "#f9c22e" : "#e01a4f";
                    return (
                      <span style={{ marginLeft: 6, padding: "1px 6px", borderRadius: 4, background: bg, color: "#fff", fontSize: 11, fontWeight: 400 }}>
                        {tps.toFixed(1)} t/s
                      </span>
                    );
                  })()}
                </span>
              )}
            </>
          );
        })()}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {blocks.map((block, i) => (
          <BlockView key={i} block={block} toolResults={toolResults} isStreaming={isStreaming} streamingDuration={streamingDurations.get(i) ?? (block.type === "thinking" ? thinkingDurationFromFile : undefined)} toolCallDurations={toolCallDurations} onOpenFile={onOpenFile} cwd={cwd} />
        ))}
      </div>

      {/* ── File cards ── */}
      {/* Show file cards for every AI-mutated file detected from the message.
          `fileIntentions` already filters non-mutation tools (read/list/grep etc.),
          so a non-empty list is sufficient — no extra text/tool gating needed. */}
      {fileIntentions.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 4 }}>
          {fileIntentions.map((intent, i) => (
            <FileCard
              key={`${intent.path}-${i}`}
              filePath={intent.path}
              kind={intent.kind}
              onOpenFile={onOpenFile}
              cwd={cwd}
            />
          ))}
        </div>
      )}

      <div style={{
        display: "flex", alignItems: "center", gap: 8, marginTop: 4,
      }}>
        {message.usage && !isStreaming && (
          <div style={{ fontSize: 11, color: "var(--text-dim)" }}>
            {formatUsage(message.usage)}
          </div>
        )}
        {textContent && !isStreaming && (
          <button
            onClick={copyContent}
            title="Copy message"
            style={{
              display: "flex", alignItems: "center", gap: 4,
              padding: "3px 8px", height: 22,
              background: "none", border: "none",
              borderRadius: 5,
              color: copied ? "var(--accent)" : "var(--text-dim)",
              cursor: "pointer",
              fontSize: 11, fontWeight: 400,
              whiteSpace: "nowrap",
              opacity: hovered ? 1 : 0,
              pointerEvents: hovered ? "auto" : "none",
              transition: "opacity 0.12s, color 0.12s",
            }}
            onMouseEnter={(e) => { if (!copied) e.currentTarget.style.color = "var(--accent)"; }}
            onMouseLeave={(e) => { if (!copied) e.currentTarget.style.color = "var(--text-dim)"; }}
          >
            {copied ? (
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            ) : (
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
            )}
            {copied ? "Copied" : "Copy"}
          </button>
        )}
        {time && !isStreaming && (
          <span style={{ fontSize: 10, color: "var(--text-dim)", marginLeft: "auto" }}>{time}</span>
        )}
      </div>
    </div>
  );
}

function BlockView({ block, toolResults, isStreaming, streamingDuration, toolCallDurations, onOpenFile, cwd }: { block: AssistantContentBlock; toolResults?: Map<string, ToolResultMessage>; isStreaming?: boolean; streamingDuration?: number; toolCallDurations?: Map<string, number>; onOpenFile?: (filePath: string, fileName: string) => void; cwd?: string }) {
  if (block.type === "text") {
    return <TextBlock block={block as TextContent} isStreaming={isStreaming} />;
  }
  if (block.type === "thinking") {
    return <ThinkingBlock block={block as ThinkingContent} duration={streamingDuration} />;
  }
  if (block.type === "toolCall") {
    const tc = block as ToolCallContent;
    const result = toolResults?.get(tc.toolCallId);
    const duration = toolCallDurations?.get(tc.toolCallId);
    return <ToolCallBlock block={tc} result={result} isRunning={isStreaming && !result} duration={duration} onOpenFile={onOpenFile} cwd={cwd} />;
  }
  return null;
}

function TextBlock({ block, isStreaming }: { block: TextContent; isStreaming?: boolean }) {
  return (
    <div className="markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code({ className, children, ...props }) {
            const lang = className?.replace("language-", "").toLowerCase() ?? "";
            const raw = String(children);
            const isBlock = className?.includes("language-") || raw.includes("\n");
            if (isBlock) {
              if (lang === "mermaid") {
                return <MermaidBlock code={raw.replace(/\n$/, "")} isStreaming={isStreaming} />;
              }
              return <CodeBlock code={raw.replace(/\n$/, "")} lang={lang} />;
            }
            return (
              <code
                style={{
                  background: "var(--bg-selected)",
                  padding: "1px 4px",
                  borderRadius: 3,
                  fontFamily: "var(--font-mono)",
                  fontSize: "0.9em",
                }}
                {...props}
              >
                {children}
              </code>
            );
          },
          pre({ children }) {
            // Unwrap <pre> wrapper — CodeBlock handles its own container
            return <>{children}</>;
          },
        }}
      >
        {block.text}
      </ReactMarkdown>
    </div>
  );
}

function MermaidBlock({ code, isStreaming }: { code: string; isStreaming?: boolean }) {
  const { isDark } = useTheme();
  const [showPreview, setShowPreview] = useState(false);
  const [svg, setSvg] = useState<string | null>(null);
  const [renderedKey, setRenderedKey] = useState("");
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const currentKey = `${isDark ? "dark" : "light"}\n${code}`;

  useEffect(() => {
    if (!showPreview || isStreaming) return;

    let cancelled = false;
    setFailedKey(null);

    const render = async () => {
      const { default: mermaid } = await import("mermaid");
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        suppressErrorRendering: true,
        theme: isDark ? "dark" : "default",
      });

      const parsed = await mermaid.parse(code, { suppressErrors: true });
      if (!parsed) throw new Error("Invalid Mermaid diagram");

      const id =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? `mermaid-${crypto.randomUUID()}`
          : `mermaid-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const result = await mermaid.render(id, code);
      if (!cancelled) {
        setSvg(result.svg);
        setRenderedKey(currentKey);
      }
    };

    render().catch(() => {
      if (!cancelled) setFailedKey(currentKey);
    });

    return () => {
      cancelled = true;
    };
  }, [code, currentKey, isDark, isStreaming, showPreview]);

  const previewButton = (
    <button
      onClick={() => setShowPreview((v) => !v)}
      disabled={isStreaming}
      title={isStreaming ? "Preview available after streaming" : (showPreview ? "Show Mermaid source" : "Preview Mermaid diagram")}
      style={{
        background: showPreview ? "var(--bg-selected)" : "none",
        border: "1px solid var(--border)",
        color: isStreaming ? "var(--text-dim)" : "var(--text-muted)",
        cursor: isStreaming ? "not-allowed" : "pointer",
        fontSize: 11,
        borderRadius: 4,
        padding: "1px 6px",
      }}
    >
      {showPreview ? "Source" : "Preview"}
    </button>
  );

  if (!showPreview || isStreaming) {
    return <CodeBlock code={code} lang="mermaid" headerAction={previewButton} />;
  }

  const body =
    failedKey === currentKey ? (
      <div className="mermaid-block mermaid-block-error">Invalid Mermaid diagram</div>
    ) : !svg || renderedKey !== currentKey ? (
      <div className="mermaid-block mermaid-block-loading" aria-label="Rendering Mermaid diagram" />
    ) : (
      <div
        className="mermaid-block"
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    );

  return (
    <div
      style={{
        position: "relative",
        marginTop: 4,
        marginBottom: 4,
        borderRadius: 6,
        overflow: "hidden",
        border: "1px solid var(--border)",
      }}
    >
      <div
        style={{
          padding: "3px 10px",
          background: "var(--bg-panel)",
          borderBottom: "1px solid var(--border)",
          fontSize: 11,
          color: "var(--text-dim)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span>mermaid</span>
        {previewButton}
      </div>
      {body}
    </div>
  );
}

function ThinkingBlock({ block, duration }: { block: ThinkingContent; duration?: number }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div
      style={{
        border: "1px solid var(--border-subtle)",
        borderRadius: 8,
        overflow: "hidden",
        fontSize: 13,
        background: "var(--accent-soft)",
      }}
    >
      <button
        onClick={() => setExpanded((v) => !v)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          width: "100%",
          padding: "6px 10px",
          background: "none",
          border: "none",
          color: "var(--accent)",
          cursor: "pointer",
          fontSize: 12,
          fontWeight: 500,
          textAlign: "left",
        }}
      >
        <span>Thinking</span>
        {duration !== undefined && (
          <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--text-dim)", fontVariantNumeric: "tabular-nums" }}>{duration}s</span>
        )}
      </button>
      {expanded && (
        <div
          style={{
            padding: "8px 10px",
            color: "var(--text-muted)",
            fontSize: 12,
            lineHeight: 1.6,
            whiteSpace: "pre-wrap",
            background: "var(--bg-panel)",
            borderTop: "1px solid var(--border)",
          }}
        >
          {block.thinking}
        </div>
      )}
    </div>
  );
}


// ── Document type detection helpers ────────────────────────────────────────

// File type label mapping — covers all major categories
const FILE_TYPE_LABELS: Record<string, string> = {
  // Documents
  pdf: "PDF 文档",
  doc: "Word 文档", docx: "Word 文档",
  ppt: "PPT 演示文稿", pptx: "PPT 演示文稿",
  xls: "Excel 表格", xlsx: "Excel 表格",
  // Code
  ts: "TypeScript", tsx: "TypeScript React",
  js: "JavaScript", jsx: "JavaScript React",
  mjs: "JavaScript", cjs: "JavaScript",
  py: "Python", rb: "Ruby",
  go: "Go", rs: "Rust",
  java: "Java", kt: "Kotlin", swift: "Swift",
  c: "C", cpp: "C++", h: "C Header", hpp: "C++ Header",
  cs: "C#", sql: "SQL",
  graphql: "GraphQL", gql: "GraphQL",
  // Web / config
  html: "HTML", htm: "HTML",
  css: "CSS", scss: "SCSS", less: "LESS",
  json: "JSON", jsonl: "JSON Lines",
  yaml: "YAML", yml: "YAML", toml: "TOML",
  xml: "XML", sh: "Shell", bash: "Shell",
  dockerfile: "Dockerfile",
  // Content
  md: "Markdown", mdx: "MDX",
  txt: "Text", csv: "CSV",
  env: "Environment",
  // Images
  png: "图片", jpg: "图片", jpeg: "图片",
  gif: "图片", webp: "图片", svg: "图片",
  bmp: "图片", ico: "图片", avif: "图片",
  // Audio
  mp3: "音频", wav: "音频", ogg: "音频",
  m4a: "音频", flac: "音频", weba: "音频",
  // Video
  mp4: "视频", webm: "视频", avi: "视频", mov: "视频",
};

// ── FileCard ──────────────────────────────────────────────────────────

function resolveFilePath(filePath: string, cwd?: string): string {
  // Already an absolute path (Windows: C:\... or POSIX: /...)
  if (/^[a-zA-Z]:[\\/]/.test(filePath) || filePath.startsWith("/")) return filePath;
  // Relative path — resolve against cwd
  if (cwd) {
    const normalizedCwd = cwd.replace(/\\/g, "/").replace(/\/+$/, "");
    const normalizedFile = filePath.replace(/\\/g, "/");
    return normalizedCwd + "/" + normalizedFile;
  }
  return filePath;
}

function FileCard({ filePath, kind = "create", onOpenFile, cwd }: { filePath: string; kind?: FileMutationKind; onOpenFile?: (filePath: string, fileName: string) => void; cwd?: string }) {
  const [hovered, setHovered] = useState(false);
  const resolvedPath = resolveFilePath(filePath, cwd);
  const fileName = resolvedPath.split(/[\\/]/).pop() ?? resolvedPath;
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  const typeLabel = FILE_TYPE_LABELS[ext] ?? "文件";
  const icon = getFileIcon(fileName, 18);

  const handleClick = () => {
    onOpenFile?.(resolvedPath, fileName);
  };

  return (
    <div
      onClick={handleClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 12px",
        borderRadius: 8,
        border: `1px solid ${hovered ? "var(--accent)" : "var(--border)"}`,
        background: hovered ? "var(--bg-selected)" : "var(--bg-subtle)",
        cursor: onOpenFile ? "pointer" : "default",
        transition: "border-color 0.15s, background 0.15s",
        marginTop: 4,
      }}
    >
      <span style={{ flexShrink: 0, display: "flex", alignItems: "center" }}>{icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 500, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {fileName}
        </div>
        <div style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 1 }}>
          {typeLabel} · {kind === "create" ? "✓ 已生成" : "✎ 已编辑"}
        </div>
      </div>
      {onOpenFile && (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={hovered ? "var(--accent)" : "var(--text-dim)"} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
          <polyline points="9 18 15 12 9 6" />
        </svg>
      )}
    </div>
  );
}

// ── ToolCallBlock ──────────────────────────────────────────────────────────

function ToolCallBlock({ block, result, isRunning, duration, onOpenFile, cwd }: { block: ToolCallContent; result?: ToolResultMessage; isRunning?: boolean; duration?: number; onOpenFile?: (filePath: string, fileName: string) => void; cwd?: string }) {
  const [expanded, setExpanded] = useState(false);
  const inputStr = JSON.stringify(block.input, null, 2);

  // Result display
  const resultText = result
    ? result.content.filter((b): b is { type: "text"; text: string } => b.type === "text").map((b) => b.text).join("\n")
    : null;
  const resultIsEmpty = resultText === null ? false : (resultText.trim() === "(no output)" || resultText.trim() === "");
  const isError = result?.isError ?? false;

  return (
    <div
      style={{
        borderRadius: 8,
        overflow: "hidden",
        fontSize: 12,
        border: isError ? "1px solid rgba(248,113,113,0.45)" : "1px solid var(--border-subtle)",
        background: isError ? "rgba(248,113,113,0.05)" : "var(--accent-soft)",
      }}
    >
      {/* ── Tool call header ── */}
      <button
        onClick={() => setExpanded((v) => !v)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 7,
          width: "100%",
          padding: "6px 10px",
          background: "none",
          border: "none",
          color: "var(--text-muted)",
          cursor: "pointer",
          fontSize: 12,
          textAlign: "left",
          minWidth: 0,
        }}
      >
        <span style={{ color: isError ? "#f87171" : "#16a34a", fontFamily: "var(--font-mono)", fontWeight: 600, fontSize: 11, flexShrink: 0 }}>
          {block.toolName}
        </span>
        <span style={{ color: "var(--text-dim)", fontFamily: "var(--font-mono)", fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}>
          {getToolPreview(block)}
        </span>
        {duration !== undefined && (
          <span style={{ fontSize: 11, color: "var(--text-dim)", flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>{duration}s</span>
        )}
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="var(--text-dim)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, transform: expanded ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}>
          <polyline points="2 3.5 5 6.5 8 3.5" />
        </svg>
      </button>

      {/* ── Expanded: input args ── */}
      {expanded && (
        <pre
          style={{
            margin: 0,
            padding: "8px 10px",
            color: "var(--text-muted)",
            fontSize: 12,
            lineHeight: 1.5,
            overflow: "auto",
            background: "var(--bg-subtle)",
            borderTop: isError ? "1px solid rgba(248,113,113,0.25)" : "1px solid rgba(34,197,94,0.2)",
            whiteSpace: "pre-wrap",
            wordBreak: "break-all",
          }}
        >
          {inputStr}
        </pre>
      )}

      {/* ── Paired result — only shown when expanded ── */}
      {expanded && result && (
        <PairedResult
          text={resultText ?? ""}
          isEmpty={resultIsEmpty}
          isError={isError}
        />
      )}
    </div>
  );
}

function PairedResult({ text, isEmpty, isError }: {
  text: string;
  isEmpty: boolean;
  isError: boolean;
}) {
  return (
    <div
      style={{
        borderTop: `1px solid ${isError ? "rgba(248,113,113,0.3)" : "rgba(34,197,94,0.15)"}`,
        background: isError ? "rgba(248,113,113,0.04)" : "var(--bg-subtle)",
      }}
    >
      <pre
        style={{
          margin: 0,
          padding: "8px 10px",
          color: isError ? "#f87171" : (isEmpty ? "var(--text-dim)" : "var(--text-muted)"),
          fontSize: 12,
          lineHeight: 1.5,
          overflow: "auto",
          maxHeight: 400,
          background: "var(--bg)",
          whiteSpace: "pre-wrap",
          wordBreak: "break-all",
          fontStyle: isEmpty ? "italic" : "normal",
          opacity: isEmpty ? 0.6 : 1,
        }}
      >
        {isEmpty ? "(no output)" : text}
      </pre>
    </div>
  );
}


function getToolPreview(block: ToolCallContent): string {
  const input = block.input;
  if (!input || typeof input !== "object") return "";
  const keys = Object.keys(input);
  if (keys.length === 0) return "";

  // Common tool input patterns
  if ("command" in input) return String(input.command).slice(0, 120);
  if ("path" in input) return String(input.path).slice(0, 120);
  if ("file_path" in input) return String(input.file_path).slice(0, 120);
  if ("pattern" in input) return String(input.pattern).slice(0, 120);
  if ("query" in input) return String(input.query).slice(0, 120);

  const first = input[keys[0]];
  return String(first).slice(0, 120);
}

function formatUsage(usage: {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: { total: number };
}): string {
  const parts = [];
  if (usage.input) parts.push(`${usage.input.toLocaleString()} in`);
  if (usage.output) parts.push(`${usage.output.toLocaleString()} out`);
  if (usage.cacheRead) parts.push(`${usage.cacheRead.toLocaleString()} cache`);
  if (usage.cost?.total) parts.push(`$${usage.cost.total.toFixed(4)}`);
  return parts.join(" · ");
}



function CodeBlock({ code, lang, headerAction }: { code: string; lang: string; headerAction?: ReactNode }) {
  const { isDark } = useTheme();
  const [copied, setCopied] = useState(false);

  const copy = () => {
    copyText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div
      style={{
        position: "relative",
        marginTop: 4,
        marginBottom: 4,
        borderRadius: 8,
        overflow: "hidden",
        border: "1px solid var(--border-subtle)",
        boxShadow: "var(--shadow-sm)",
      }}
    >
      <div
        style={{
          padding: "3px 10px",
          background: "var(--bg-panel)",
          borderBottom: "1px solid var(--border-subtle)",
          fontSize: 11,
          color: "var(--text-dim)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span>{lang}</span>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {headerAction}
          <button
            onClick={copy}
            style={{
              background: "none",
              border: "none",
              color: "var(--text-muted)",
              cursor: "pointer",
              fontSize: 11,
            }}
          >
            {copied ? "copied" : "copy"}
          </button>
        </div>
      </div>
      <SyntaxHighlighter
        language={lang || "text"}
        style={isDark ? vscDarkPlus : vs}
        showLineNumbers
        lineNumberStyle={{ color: "var(--text-dim)", fontStyle: "normal" }}
        customStyle={{
          margin: 0,
          padding: "10px 12px",
          fontSize: 12.5,
          lineHeight: 1.6,
          borderRadius: 0,
          background: "var(--bg)",
        }}
        codeTagProps={{ style: { fontFamily: "var(--font-mono)" } }}
      >
        {code}
      </SyntaxHighlighter>
    </div>
  );
}
