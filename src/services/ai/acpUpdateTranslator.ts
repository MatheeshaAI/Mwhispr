import type { AcpSessionUpdate } from "../../types/electron";
import type { AgentStreamChunk } from "../ReasoningService";

interface AcpContentBlock {
  type: string;
  text?: string;
}

interface AcpToolCallContentEntry {
  content?: AcpContentBlock;
}

function extractTextBlocks(entries: unknown): string {
  if (!Array.isArray(entries)) return "";
  return entries
    .map((entry) => (entry as AcpToolCallContentEntry)?.content)
    .filter((block): block is AcpContentBlock => block?.type === "text")
    .map((block) => block.text || "")
    .filter(Boolean)
    .join("\n");
}

/**
 * Maps one ACP `SessionNotification.update` variant onto the same
 * `AgentStreamChunk` shape the BYOK/cloud/AI-SDK streaming paths already
 * yield, so useChatStreaming's chunk handling needs no ACP-specific branch.
 * Variants without a useful chat representation (plan, thought, user echo)
 * translate to null and are dropped.
 */
export function translateAcpUpdate(update: AcpSessionUpdate): AgentStreamChunk | null {
  switch (update.sessionUpdate) {
    case "agent_message_chunk": {
      const content = (update as { content?: AcpContentBlock }).content;
      if (content?.type === "text" && typeof content.text === "string" && content.text) {
        return { type: "content", text: content.text };
      }
      return null;
    }
    case "tool_call": {
      const u = update as unknown as {
        toolCallId: string;
        title?: string;
        kind?: string;
        rawInput?: Record<string, unknown>;
      };
      return {
        type: "tool_calls",
        calls: [
          {
            id: u.toolCallId,
            name: u.title || u.kind || "tool",
            arguments: JSON.stringify(u.rawInput || {}),
          },
        ],
      };
    }
    case "tool_call_update": {
      const u = update as unknown as {
        toolCallId: string;
        title?: string | null;
        status?: string | null;
        content?: unknown;
      };
      if (u.status !== "completed" && u.status !== "failed") return null;
      const text = extractTextBlocks(u.content);
      return {
        type: "tool_result",
        callId: u.toolCallId,
        toolName: u.title || "tool",
        displayText: text || (u.status === "failed" ? "Failed" : "Done"),
      };
    }
    default:
      return null;
  }
}
