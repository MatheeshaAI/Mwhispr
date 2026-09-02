import type { ToolDefinition, ToolResult } from "./ToolRegistry";
import type { McpConnectedTool } from "../../types/electron";

// Namespaced so a tool named e.g. "search" from two different MCP servers (or
// one that collides with a built-in like search_notes) never overwrites the
// other in the registry's flat name -> ToolDefinition map.
export function mcpToolName(tool: Pick<McpConnectedTool, "serverId" | "name">): string {
  return `mcp_${tool.serverId.replace(/[^a-zA-Z0-9_]/g, "_")}_${tool.name}`;
}

function extractDisplayText(result: unknown): string {
  const content = (result as { content?: Array<{ type: string; text?: string }> })?.content;
  if (Array.isArray(content)) {
    const text = content
      .filter((part) => part?.type === "text" && typeof part.text === "string")
      .map((part) => part.text)
      .join("\n");
    if (text) return text;
  }
  return "Done";
}

export function createMcpToolDefinition(tool: McpConnectedTool): ToolDefinition {
  return {
    name: mcpToolName(tool),
    description: `[${tool.serverName}] ${tool.description}`.trim(),
    parameters: tool.inputSchema,
    readOnly: false,

    async execute(args: Record<string, unknown>): Promise<ToolResult> {
      try {
        const response = await window.electronAPI?.mcpCallTool?.(tool.serverId, tool.name, args);
        if (!response?.success) {
          const displayText = response?.error || `${tool.name} failed`;
          return { success: false, data: displayText, displayText };
        }
        const isError = (response.result as { isError?: boolean })?.isError === true;
        const displayText = extractDisplayText(response.result);
        return { success: !isError, data: response.result ?? displayText, displayText };
      } catch (error) {
        const displayText = `${tool.name} failed: ${(error as Error).message}`;
        return { success: false, data: displayText, displayText };
      }
    },
  };
}
