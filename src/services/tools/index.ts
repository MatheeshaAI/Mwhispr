import { ToolRegistry } from "./ToolRegistry";
import { createSearchNotesTool } from "./searchNotesTool";
import { getNoteTool } from "./getNoteTool";
import { createNoteTool } from "./createNoteTool";
import { updateNoteTool } from "./updateNoteTool";
import { listFoldersTool } from "./listFoldersTool";
import { clipboardTool } from "./clipboardTool";
import { webSearchTool } from "./webSearchTool";
import { calendarTool } from "./calendarTool";
import { calendarAvailabilityTool } from "./calendarAvailabilityTool";
import { createMcpToolDefinition } from "./mcpTool";
import type { ContainerScope } from "../../types/chat";

export { ToolRegistry } from "./ToolRegistry";
export type { ToolDefinition, ToolResult } from "./ToolRegistry";

interface ToolRegistrySettings {
  isSignedIn: boolean;
  calendarConnected: boolean;
  cloudBackupEnabled: boolean;
  /** Pins search_notes to a container (overview chat); the LLM cannot widen it. */
  searchScope?: ContainerScope;
  webSearchEnabled: boolean;
}

export async function createToolRegistry(settings: ToolRegistrySettings): Promise<ToolRegistry> {
  const registry = new ToolRegistry();

  const useCloudSearch = settings.isSignedIn && settings.cloudBackupEnabled;
  registry.register(createSearchNotesTool({ useCloudSearch, fixedScope: settings.searchScope }));
  registry.register(getNoteTool);
  registry.register(createNoteTool);
  registry.register(updateNoteTool);
  registry.register(listFoldersTool);
  registry.register(clipboardTool);

  if (settings.isSignedIn && settings.webSearchEnabled) {
    registry.register(webSearchTool);
  }

  if (settings.calendarConnected) {
    registry.register(calendarTool);
    registry.register(calendarAvailabilityTool);
  }

  try {
    const mcpTools = await window.electronAPI?.mcpListConnectedTools?.();
    for (const tool of mcpTools || []) {
      registry.register(createMcpToolDefinition(tool));
    }
  } catch {
    // MCP servers are optional; a lookup failure never blocks the built-in tools.
  }

  return registry;
}
