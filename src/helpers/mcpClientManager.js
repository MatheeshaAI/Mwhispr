const { EventEmitter } = require("events");
const debugLogger = require("./debugLogger");
const mcpServerStore = require("./mcpServerStore");

const APP_INFO = { name: "openwhispr", version: "1.0.0" };
const CONNECT_TIMEOUT_MS = 15_000;

function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Main-process MCP client: connects to user-configured MCP servers (stdio or
 * HTTP/SSE), lists their tools, and proxies tool calls. Renderer never spawns
 * processes or opens sockets directly — everything here is reached over IPC.
 */
class McpClientManager extends EventEmitter {
  constructor() {
    super();
    /** @type {Map<string, { client: import("@modelcontextprotocol/sdk/client/index.js").Client, transport: unknown }>} */
    this._connections = new Map();
    /** @type {Map<string, { status: "connecting"|"connected"|"error"|"disconnected", error?: string, tools: Array<{name:string, description:string, inputSchema: Record<string, unknown>}> }>} */
    this._state = new Map();
  }

  async _createTransport(server) {
    if (server.transport === "stdio") {
      const { StdioClientTransport } = require("@modelcontextprotocol/sdk/client/stdio.js");
      if (!server.command) throw new Error("MCP server has no command configured");
      return new StdioClientTransport({
        command: server.command,
        args: server.args || [],
        env: { ...process.env, ...(server.env || {}) },
        stderr: "pipe",
      });
    }
    if (server.transport === "sse") {
      const { SSEClientTransport } = require("@modelcontextprotocol/sdk/client/sse.js");
      if (!server.url) throw new Error("MCP server has no URL configured");
      return new SSEClientTransport(new URL(server.url), {
        requestInit: { headers: server.headers || {} },
      });
    }
    const {
      StreamableHTTPClientTransport,
    } = require("@modelcontextprotocol/sdk/client/streamableHttp.js");
    if (!server.url) throw new Error("MCP server has no URL configured");
    return new StreamableHTTPClientTransport(new URL(server.url), {
      requestInit: { headers: server.headers || {} },
    });
  }

  async connectServer(id) {
    const server = mcpServerStore.get(id);
    if (!server) throw new Error(`Unknown MCP server: ${id}`);
    await this.disconnectServer(id);

    this._state.set(id, { status: "connecting", tools: [] });
    this._emitChanged();

    try {
      const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
      const transport = await this._createTransport(server);
      const client = new Client(APP_INFO, { capabilities: {} });
      await withTimeout(
        client.connect(transport),
        CONNECT_TIMEOUT_MS,
        `Timed out connecting to "${server.name || server.id}"`
      );
      const { tools } = await client.listTools();
      this._connections.set(id, { client, transport });
      this._state.set(id, {
        status: "connected",
        tools: (tools || []).map((t) => ({
          name: t.name,
          description: t.description || "",
          inputSchema: t.inputSchema || { type: "object", properties: {} },
        })),
      });
      debugLogger.log(`MCP server connected: ${server.name || id} (${tools?.length || 0} tools)`);
    } catch (error) {
      this._state.set(id, { status: "error", error: error.message, tools: [] });
      debugLogger.error(`MCP server connect failed: ${server.name || id}`, error);
    }
    this._emitChanged();
    return this._state.get(id);
  }

  async disconnectServer(id) {
    const conn = this._connections.get(id);
    this._connections.delete(id);
    if (!conn) return;
    try {
      await conn.client.close();
    } catch {
      // Best-effort; the process/socket is torn down regardless.
    }
  }

  async connectEnabled() {
    const servers = mcpServerStore.list().filter((s) => s.enabled);
    await Promise.all(servers.map((s) => this.connectServer(s.id)));
  }

  async addServer(config) {
    const server = mcpServerStore.add(config);
    if (server.enabled) await this.connectServer(server.id);
    return this.describe(server.id);
  }

  async updateServer(id, patch) {
    const server = mcpServerStore.update(id, patch);
    if (!server) return null;
    if (server.enabled) {
      await this.connectServer(server.id);
    } else {
      await this.disconnectServer(server.id);
      this._state.delete(server.id);
      this._emitChanged();
    }
    return this.describe(server.id);
  }

  async removeServer(id) {
    await this.disconnectServer(id);
    this._state.delete(id);
    mcpServerStore.remove(id);
    this._emitChanged();
    return true;
  }

  describe(id) {
    const server = mcpServerStore.get(id);
    if (!server) return null;
    const state = this._state.get(id) || { status: "disconnected", tools: [] };
    return { ...server, status: state.status, error: state.error, tools: state.tools };
  }

  list() {
    return mcpServerStore.list().map((s) => this.describe(s.id));
  }

  /** Flattened, namespaced tool list for connected servers — used by the renderer's ToolRegistry. */
  listConnectedTools() {
    const out = [];
    for (const server of mcpServerStore.list()) {
      if (!server.enabled) continue;
      const state = this._state.get(server.id);
      if (!state || state.status !== "connected") continue;
      for (const tool of state.tools) {
        out.push({
          serverId: server.id,
          serverName: server.name || server.id,
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        });
      }
    }
    return out;
  }

  async callTool(serverId, toolName, args) {
    const conn = this._connections.get(serverId);
    if (!conn) throw new Error("MCP server is not connected");
    const result = await conn.client.callTool({ name: toolName, arguments: args || {} });
    return result;
  }

  _emitChanged() {
    this.emit("changed", this.list());
  }

  async stop() {
    const ids = Array.from(this._connections.keys());
    await Promise.all(ids.map((id) => this.disconnectServer(id)));
    this._state.clear();
  }
}

module.exports = McpClientManager;
