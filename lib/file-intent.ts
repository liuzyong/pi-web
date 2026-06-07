// lib/file-intent.ts
//
// Detect "file mutation intent" from a message's tool calls + bash output.
// This replaces the old `isOutputFilePath()` directory-whitelist heuristic in
// components/MessageView.tsx so we surface ALL files the AI caused to change in
// a turn (not just those under outputs/).
//
// Sources, in priority order (P1 > P2 > P3 > P4):
//   P1 — tool-call input (write/edit/cp/mv/etc., path declared up-front)
//   P2 — bash command redirects / cp / mv / curl -o / wget -O
//   P3 — tool-result text (paths the AI echoes back in its own output)
//   P4 — directory heuristic (only when nothing else matched; e.g. an
//        unknown mutation tool wrote into dist/build/out/artifacts)
//
// Read-only events (read / cat / head / grep / rg) are intentionally NOT
// emitted — the UI hides the FileCard when the only path came from a read.

import type { ToolCallContent, ToolResultMessage, AssistantContentBlock } from "./types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FileMutationKind = "create" | "edit";

export type FileIntentionSource =
  | "tool-input"
  | "bash"
  | "result-text"
  | "dir-heuristic";

export interface FileIntention {
  /** The file path the AI likely wrote or modified. */
  path: string;
  /** Whether the file was newly created or merely edited. */
  kind: FileMutationKind;
  /** Where the detection came from. */
  source: FileIntentionSource;
  /** 0..1, used to break ties during merge. */
  confidence: number;
}

export interface DetectionConfig {
  /** Lowercased directory names that count as "AI output" via P4. */
  heuristicDirs: string[];
  /** When false, edit-kind intentions still get a card but the badge says "已生成". */
  showEditBadge: boolean;
}

export interface FileIntentionBlockInput {
  toolName?: string;
  input?: unknown;
  /** Tool result content (optional; P3 only). */
  result?: { content?: Array<{ type: string; text?: string }> } | null;
}

// ---------------------------------------------------------------------------
// Tool classification
// ---------------------------------------------------------------------------

/** Lowercase tool name -> mutation kind. */
const FILE_MUTATION_TOOLS: ReadonlyMap<string, FileMutationKind> = new Map([
  // create / overwrite
  ["write", "create"],
  ["write_file", "create"],
  ["create_file", "create"],
  ["create", "create"],
  ["save", "create"],
  // edit / patch
  ["edit", "edit"],
  ["edit_file", "edit"],
  ["str_replace", "edit"],
  ["patch", "edit"],
  ["multiedit", "edit"],
  ["notebook_edit", "edit"],
  ["apply_patch", "edit"],
]);

/** Tools we always treat as read-only (never emit an intention). */
const FILE_READ_TOOLS: ReadonlySet<string> = new Set([
  "read",
  "read_file",
  "view",
  "cat",
  "head",
  "tail",
  "list",
  "ls",
  "glob",
  "grep",
  "rg",
]);

/**
 * Public: classify a tool by its (lowercased) name. Returns undefined for
 * read-only or unknown tools. Note: bash is a special case — it always
 * produces bash-sourced intentions (P2) regardless of name.
 */
export function getMutationKindForTool(toolName: string | undefined): FileMutationKind | undefined {
  if (!toolName) return undefined;
  const key = toolName.toLowerCase();
  if (FILE_READ_TOOLS.has(key)) return undefined;
  return FILE_MUTATION_TOOLS.get(key);
}

// ---------------------------------------------------------------------------
// Regexes
// ---------------------------------------------------------------------------

/**
 * Bash redirects and curl/wget -O. Captures the path (group 1).
 * Matched alternation: `> file`, `>> file`, `tee file`, `tee -a file`,
 * `cat > file`, `curl -o file`, `curl -O file`, `wget -O file`, `wget -o file`.
 */
export const BASH_REDIRECT_REGEX =
  /(?:>>?|tee(?:\s+-a)?\s+|cat\s+>\s*|curl\s+-[oO]\s+|wget\s+-(?:O|o)\s+)([^\s'"`|&;]+)/g;

/**
 * `cp SRC DST`, `mv SRC DST`, `install SRC DST`. Captures the destination
 * path (group 1).
 */
export const BASH_CP_MV_REGEX =
  /\b(?:cp|mv|install)\s+[^\s'"`|&;]+?\s+([^\s'"`|&;]+)/g;

/**
 * Loose "looks like a file path" extractor. Requires a file extension
 * (1-8 alphanumeric chars) and either a slash or a Windows drive letter.
 * Group 1 = the path.
 */
export const PATH_WITH_EXT_REGEX =
  /(?:[a-zA-Z]:[\\/])?(?:[\w.\-@+ ]+[\\/])*[\w.\-@+]+\.[a-zA-Z0-9]{1,8}/g;

/** Paths we never want to surface as a card (system / cache / temp). */
export const DENYLIST_REGEX =
  /(?:node_modules|\.git(?:hub)?|AppData[\\/]Local[\\/]Temp|\\Temp\\|\/tmp\/|__pycache__|\.next[\\/]|dist[\\/]cache)/i;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** True if `s` looks like a concrete file path (not a URL, not noise). */
export function hasLikelyFilePath(s: string): boolean {
  if (!s) return false;
  if (s.length > 1024) return false;
  if (s.includes("://")) return false;
  if (DENYLIST_REGEX.test(s)) return false;
  // Must contain a slash, a backslash, or a Windows drive letter.
  if (!(s.includes("/") || s.includes("\\") || /^[a-zA-Z]:/.test(s))) {
    return false;
  }
  // Must end with a file extension.
  const m = /(?:\.[a-zA-Z0-9]{1,8})$/.exec(s);
  if (!m) return false;
  // No all-numeric extension (e.g. `.123`).
  if (/^\.\d+$/.test(m[0])) return false;
  return true;
}

/** Canonical form for dedup: trim quotes/spaces, strip trailing slash, normalize. */
export function normaliseForDedup(p: string): string {
  let s = p.trim().replace(/^['"]+|['"]+$/g, "");
  s = s.replace(/[\\/]+$/, ""); // strip trailing slash
  s = s.replace(/\\/g, "/");
  // collapse ./ and //
  s = s.replace(/\/{2,}/g, "/");
  s = s.replace(/\/\.\//g, "/");
  return s.toLowerCase();
}

function pathSegments(p: string): string[] {
  const n = normaliseForDedup(p);
  return n.split("/").filter(Boolean);
}

function isUnderHeuristicDir(p: string, heuristicDirs: string[]): boolean {
  if (heuristicDirs.length === 0) return false;
  const segs = pathSegments(p);
  if (segs.length === 0) return false;
  // Match any segment of the path against the heuristic list.
  return segs.some((seg) => heuristicDirs.includes(seg));
}

// ---------------------------------------------------------------------------
// Config (env-driven; lazy + cached)
// ---------------------------------------------------------------------------

const DEFAULT_HEURISTIC_DIRS = ["outputs", "output", "dist", "build", "out", "artifacts"];
let _cachedConfig: DetectionConfig | null = null;

export function getDetectionConfig(): DetectionConfig {
  if (_cachedConfig) return _cachedConfig;
  let heuristicDirs = DEFAULT_HEURISTIC_DIRS;
  const env = typeof process !== "undefined" ? process.env?.PI_OUTPUT_DIRS : undefined;
  if (env && env.trim().length > 0) {
    const parts = env
      .split(",")
      .map((s) => s.trim().toLowerCase().replace(/[\\/]+$/, ""))
      .filter(Boolean);
    if (parts.length > 0) heuristicDirs = parts;
  }
  _cachedConfig = { heuristicDirs, showEditBadge: true };
  return _cachedConfig;
}

/** For tests: clear the cached config so the next call re-reads env. */
export function _resetDetectionConfigForTests(): void {
  _cachedConfig = null;
}

// ---------------------------------------------------------------------------
// P1 — tool-call input
// ---------------------------------------------------------------------------

/**
 * Pull every path-shaped field out of a tool call's input. For the common
 * write/edit tools this is the most reliable signal (P1, confidence 1.0).
 */
function extractPathsFromToolInput(input: unknown): string[] {
  if (!input || typeof input !== "object") return [];
  const obj = input as Record<string, unknown>;
  const out: string[] = [];
  const tryPush = (v: unknown) => {
    if (typeof v === "string" && hasLikelyFilePath(v)) out.push(v);
  };
  tryPush(obj.path);
  tryPush(obj.file_path);
  tryPush(obj.filepath);
  tryPush(obj.filePath);
  tryPush(obj.notebook_path);
  tryPush(obj.notebookPath);
  tryPush(obj.target_path);
  tryPush(obj.target);
  tryPush(obj.dest);
  tryPush(obj.destination);
  // Some tools pass an array of files.
  if (Array.isArray(obj.files)) {
    for (const f of obj.files) {
      if (typeof f === "string") tryPush(f);
      else if (f && typeof f === "object") {
        const o = f as Record<string, unknown>;
        tryPush(o.path);
        tryPush(o.file_path);
        tryPush(o.filepath);
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// P2 — bash command
// ---------------------------------------------------------------------------

/** Extract destination paths from a bash command string. */
export function extractIntentionsFromBash(
  command: string,
  config?: DetectionConfig,
): FileIntention[] {
  if (!command || typeof command !== "string") return [];
  const out: FileIntention[] = [];
  const seen = new Set<string>();
  const push = (p: string) => {
    if (!hasLikelyFilePath(p)) return;
    const k = normaliseForDedup(p);
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ path: p, kind: "create", source: "bash", confidence: 0.85 });
  };
  let m: RegExpExecArray | null;
  BASH_REDIRECT_REGEX.lastIndex = 0;
  while ((m = BASH_REDIRECT_REGEX.exec(command)) !== null) push(m[1]);
  BASH_CP_MV_REGEX.lastIndex = 0;
  while ((m = BASH_CP_MV_REGEX.exec(command)) !== null) push(m[1]);
  if (out.length === 0) return out;
  // If no heuristic dir applies, leave the result as-is (still a valid P2 hit).
  void config;
  return out;
}

// ---------------------------------------------------------------------------
// P3 — tool-result text
// ---------------------------------------------------------------------------

/** Pull any "file path" tokens out of a tool result's text content. */
export function extractIntentionsFromResultText(
  text: string,
  config?: DetectionConfig,
): FileIntention[] {
  if (!text || typeof text !== "string") return [];
  const out: FileIntention[] = [];
  const seen = new Set<string>();
  PATH_WITH_EXT_REGEX.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PATH_WITH_EXT_REGEX.exec(text)) !== null) {
    const p = m[0];
    if (!hasLikelyFilePath(p)) continue;
    const k = normaliseForDedup(p);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ path: p, kind: "edit", source: "result-text", confidence: 0.7 });
  }
  if (out.length === 0) return out;
  void config;
  return out;
}

// ---------------------------------------------------------------------------
// Per-block extraction (P1, P2, P3)
// ---------------------------------------------------------------------------

/**
 * Inspect a single tool-call block and emit zero or more FileIntentions.
 * Honors the `__mutationKind` stamp that lib/normalize.ts puts on `input`.
 */
export function extractIntentionsFromBlock(
  block: FileIntentionBlockInput,
  config?: DetectionConfig,
): FileIntention[] {
  const out: FileIntention[] = [];
  const toolName = (block.toolName ?? "").toLowerCase();

  // P1: explicit tool input.
  const mutationKind = getMutationKindForTool(toolName);
  const inputPaths = extractPathsFromToolInput(block.input);
  if (inputPaths.length > 0) {
    const kind: FileMutationKind =
      (block.input as { __mutationKind?: FileMutationKind } | null)?.__mutationKind ??
      mutationKind ??
      "create";
    for (const p of inputPaths) {
      out.push({ path: p, kind, source: "tool-input", confidence: 1.0 });
    }
  }

  // P2: bash command. We allow this regardless of toolName being "bash"
  // (some harnesses use "Bash" / "shell" / "exec").
  const input = block.input as { command?: unknown } | null;
  if (typeof input?.command === "string") {
    out.push(...extractIntentionsFromBash(input.command, config));
  }

  // P3: result text. Walk every text block in the result.
  if (block.result && Array.isArray(block.result.content)) {
    for (const part of block.result.content) {
      if (part && part.type === "text" && typeof part.text === "string") {
        out.push(...extractIntentionsFromResultText(part.text, config));
      }
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Multi-block + merge
// ---------------------------------------------------------------------------

/**
 * Walk a list of tool-call blocks and emit one merged list of FileIntentions.
 * Order matters: high-priority sources should be merged last so they win.
 */
export function extractIntentions(
  blocks: Array<FileIntentionBlockInput | null | undefined>,
  config?: DetectionConfig,
): FileIntention[] {
  const cfg = config ?? getDetectionConfig();
  const raw: FileIntention[] = [];
  for (const b of blocks) {
    if (!b) continue;
    raw.push(...extractIntentionsFromBlock(b, cfg));
  }
  return mergeIntentions(raw);
}

const SOURCE_RANK: Record<FileIntentionSource, number> = {
  "tool-input": 4,
  "bash": 3,
  "result-text": 2,
  "dir-heuristic": 1,
};

/**
 * Deduplicate by normalized path. On collision, keep the higher-priority
 * source (tool-input > bash > result-text > dir-heuristic). On source tie,
 * prefer `create` over `edit`. On further tie, keep the higher confidence.
 */
export function mergeIntentions(list: FileIntention[]): FileIntention[] {
  if (list.length <= 1) return list.slice();
  const byKey = new Map<string, FileIntention>();
  for (const item of list) {
    const key = normaliseForDedup(item.path);
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, item);
      continue;
    }
    const prevRank = SOURCE_RANK[prev.source];
    const itemRank = SOURCE_RANK[item.source];
    if (
      itemRank > prevRank ||
      (itemRank === prevRank && item.kind === "create" && prev.kind === "edit") ||
      (itemRank === prevRank && item.kind === prev.kind && item.confidence > prev.confidence)
    ) {
      byKey.set(key, item);
    }
  }
  return Array.from(byKey.values());
}

/**
 * Filter out intentions that the UI should not show a FileCard for:
 *   - read-only events (already filtered earlier, but defense in depth)
 *   - paths that match no source AND are not under a heuristic dir
 */
export function getVisibleIntentions(
  list: FileIntention[],
  config?: DetectionConfig,
): FileIntention[] {
  const cfg = config ?? getDetectionConfig();
  return list.filter((it) => {
    if (it.source === "dir-heuristic") return isUnderHeuristicDir(it.path, cfg.heuristicDirs);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Convenience: extract from a raw ToolCallContent[] (MessageView's input)
// ---------------------------------------------------------------------------

/**
 * One-shot helper for components/MessageView.tsx. Walks the tool-call
 * blocks in a single message, joins each block with its matching tool
 * result (by toolCallId) when available, and returns merged intentions.
 */
export function extractIntentionsFromMessage(
  blocks: AssistantContentBlock[] | undefined,
  resultsById: Map<string, ToolResultMessage> | undefined,
  config?: DetectionConfig,
): FileIntention[] {
  if (!blocks || blocks.length === 0) return [];
  // Filter to only toolCall blocks
  const toolBlocks = blocks.filter((b): b is ToolCallContent => b.type === "toolCall");
  const mapped = toolBlocks.map((b) => {
    const toolCallId = b.toolCallId;
    const result = toolCallId ? resultsById?.get(toolCallId) : undefined;
    const r = result as { content?: Array<{ type: string; text?: string }> } | undefined;
    return {
      toolName: b.toolName,
      input: b.input,
      result: r ? { content: r.content } : null,
    };
  });
  return extractIntentions(mapped, config);
}
