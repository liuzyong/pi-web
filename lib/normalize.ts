import type { AgentMessage, AssistantMessage, ToolCallContent } from "./types";

/**
 * Internal cache: lowercase tool name -> mutation kind.
 * Kept inline (not imported from ./file-intent) to avoid a circular import:
 *   file-intent.ts -> types.ts
 *   normalize.ts   -> types.ts
 *   messageView.ts -> both
 * Both modules are leaf-ish utilities; this duplication is intentional and
 * the two maps must stay in sync. See lib/file-intent.ts `FILE_MUTATION_TOOLS`.
 */
type _MutationKind = "create" | "edit";
const _kindCache: ReadonlyMap<string, _MutationKind> = new Map<string, _MutationKind>([
  ["write", "create"],
  ["write_file", "create"],
  ["create_file", "create"],
  ["create", "create"],
  ["save", "create"],
  ["edit", "edit"],
  ["edit_file", "edit"],
  ["str_replace", "edit"],
  ["patch", "edit"],
  ["multiedit", "edit"],
  ["notebook_edit", "edit"],
  ["apply_patch", "edit"],
]);

function getMutationKindCached(toolName: string): _MutationKind | undefined {
  return _kindCache.get(toolName.toLowerCase());
}

function isObject(val: unknown): val is Record<string, unknown> {
  return typeof val === "object" && val !== null && !Array.isArray(val);
}

function normalizeToolCallBlock(block: unknown): ToolCallContent | null {
  if (!isObject(block) || block.type !== "toolCall") return null;
  const toolCallId = typeof block.toolCallId === "string"
    ? block.toolCallId
    : (typeof block.id === "string" ? block.id : "");
  const toolName = typeof block.toolName === "string"
    ? block.toolName
    : (typeof block.name === "string" ? block.name : "");
  const input: Record<string, unknown> = typeof block.input === "object" && block.input !== null && !Array.isArray(block.input)
    ? block.input as Record<string, unknown>
    : (typeof block.arguments === "object" && block.arguments !== null && !Array.isArray(block.arguments)
      ? block.arguments as Record<string, unknown>
      : {});

  // Stamp a non-enumerable __mutationKind on the input object so downstream
  // code (lib/file-intent.ts, components/MessageView.tsx) can decide which
  // badge to show without re-classifying the tool by name.
  const kind = getMutationKindCached(toolName);
  if (kind) {
    try {
      Object.defineProperty(input, "__mutationKind", {
        value: kind,
        enumerable: false,
        configurable: true,
        writable: false,
      });
    } catch {
      // Some input objects are frozen/sealed (e.g. user-supplied mocks). Silently
      // skip — the absence of __mutationKind is safe: file-intent falls back to
      // its own getMutationKindForTool() lookup.
    }
  }

  return { type: "toolCall", toolCallId, toolName, input };
}

export function normalizeToolCalls(msg: AgentMessage): AgentMessage {
  if (msg.role !== "assistant") return msg;
  const content = (msg as AssistantMessage).content;
  if (!Array.isArray(content)) return msg;
  const normalized = content.map((block) => {
    const result = normalizeToolCallBlock(block);
    return result ?? block;
  });
  return { ...msg, content: normalized } as AgentMessage;
}