const { spawn } = require("child_process");
const crypto = require("crypto");
const os = require("os");
const { Readable, Writable } = require("stream");
const debugLogger = require("./debugLogger");

const PROTOCOL_VERSION_FALLBACK = 1;
const PERMISSION_TIMEOUT_MS = 2 * 60 * 1000;

function toAcpMcpServers(servers) {
  return (servers || []).map((s) => {
    if (s.transport === "stdio") {
      return {
        type: "stdio",
        name: s.name || s.id,
        command: s.command,
        args: s.args || [],
        env: Object.entries(s.env || {}).map(([name, value]) => ({ name, value })),
      };
    }
    return {
      type: s.transport === "sse" ? "sse" : "http",
      name: s.name || s.id,
      url: s.url,
      headers: Object.entries(s.headers || {}).map(([name, value]) => ({ name, value })),
    };
  });
}

function isAuthRequiredError(error) {
  if (!error) return false;
  if (error.code === -32000) return true;
  const message = String(error.message || "");
  return /auth/i.test(message) && /required|expired|not.?logged.?in/i.test(message);
}

/**
 * Bridges OpenWhispr's chat assistant to Claude Code over the Agent Client
 * Protocol (ACP) — the same mechanism Zed uses. Spawns the bundled
 * `claude-code-acp` adapter as a subprocess and drives it over stdio JSON-RPC.
 * Claude Code resolves its own credentials (a locally authenticated `claude`
 * CLI session, or ANTHROPIC_API_KEY if set); no API key is handled here, so
 * usage is billed against the user's own Claude subscription.
 */
class AcpClaudeCodeManager {
  constructor({ getMcpServers } = {}) {
    this._getMcpServers = typeof getMcpServers === "function" ? getMcpServers : () => [];
    this._connection = null;
    this._childProcess = null;
    this._sessionId = null;
    this._initPromise = null;
    this._active = null;
    this._pendingPermissions = new Map();
  }

  _resolveEntryPath() {
    return require.resolve("@zed-industries/claude-code-acp/dist/index.js");
  }

  /** Structural check only (the adapter ships with OpenWhispr); login state is discovered lazily on first prompt. */
  isInstalled() {
    try {
      this._resolveEntryPath();
      return true;
    } catch {
      return false;
    }
  }

  async _ensureConnection() {
    if (this._connection) return this._connection;
    if (this._initPromise) return this._initPromise;

    this._initPromise = (async () => {
      const acp = await import("@zed-industries/agent-client-protocol");
      const entryPath = this._resolveEntryPath();

      const child = spawn(process.execPath, [entryPath], {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
        stdio: ["pipe", "pipe", "pipe"],
      });
      child.stderr?.on("data", (chunk) => {
        debugLogger.log(`[claude-code-acp] ${chunk.toString().trim()}`);
      });
      child.once("exit", (code, signal) => {
        debugLogger.log(`claude-code-acp exited (code=${code} signal=${signal})`);
        this._connection = null;
        this._childProcess = null;
        this._sessionId = null;
        this._initPromise = null;
        this._failActive(new Error("Claude Code process exited unexpectedly"));
      });
      this._childProcess = child;

      const input = Writable.toWeb(child.stdin);
      const output = Readable.toWeb(child.stdout);
      const stream = acp.ndJsonStream(input, output);

      const manager = this;
      const client = {
        async requestPermission(params) {
          return manager._handlePermissionRequest(params);
        },
        async sessionUpdate(params) {
          manager._active?.onChunk?.(params.update);
        },
      };

      const connection = new acp.ClientSideConnection(() => client, stream);
      await connection.initialize({
        protocolVersion: acp.PROTOCOL_VERSION ?? PROTOCOL_VERSION_FALLBACK,
        clientCapabilities: {},
      });

      this._connection = connection;
      return connection;
    })().catch((error) => {
      this._initPromise = null;
      this._connection = null;
      throw error;
    });

    return this._initPromise;
  }

  _handlePermissionRequest(params) {
    return new Promise((resolve) => {
      const requestId = crypto.randomUUID();
      const onPermissionRequest = this._active?.onPermissionRequest;
      if (!onPermissionRequest) {
        resolve({ outcome: { outcome: "cancelled" } });
        return;
      }
      // Not every chat surface renders an approve/deny control (the compact
      // voice-assistant panel doesn't yet) — time out rather than hang the
      // session forever if nothing ever calls respondToPermission.
      const timeout = setTimeout(() => {
        if (!this._pendingPermissions.delete(requestId)) return;
        resolve({ outcome: { outcome: "cancelled" } });
      }, PERMISSION_TIMEOUT_MS);
      this._pendingPermissions.set(requestId, (outcome) => {
        clearTimeout(timeout);
        resolve(outcome);
      });
      onPermissionRequest({
        requestId,
        sessionId: params.sessionId,
        toolCallId: params.toolCall.toolCallId,
        title: params.toolCall.title || params.toolCall.kind || "tool",
        options: (params.options || []).map((o) => ({
          optionId: o.optionId,
          name: o.name,
          kind: o.kind,
        })),
      });
    });
  }

  respondToPermission(requestId, optionId) {
    const resolve = this._pendingPermissions.get(requestId);
    if (!resolve) return false;
    this._pendingPermissions.delete(requestId);
    resolve(
      optionId
        ? { outcome: { outcome: "selected", optionId } }
        : { outcome: { outcome: "cancelled" } }
    );
    return true;
  }

  _failActive(error) {
    const active = this._active;
    this._active = null;
    active?.onError?.(error);
    for (const resolve of this._pendingPermissions.values()) {
      resolve({ outcome: { outcome: "cancelled" } });
    }
    this._pendingPermissions.clear();
  }

  async _ensureSession() {
    const connection = await this._ensureConnection();
    if (this._sessionId) return { connection, sessionId: this._sessionId };

    try {
      const { sessionId } = await connection.newSession({
        cwd: os.homedir(),
        mcpServers: toAcpMcpServers(this._getMcpServers()),
      });
      this._sessionId = sessionId;
      return { connection, sessionId };
    } catch (error) {
      if (isAuthRequiredError(error)) {
        throw new Error(
          "Claude Code isn't signed in. Run `claude login` in a terminal, then try again."
        );
      }
      throw error;
    }
  }

  /**
   * Runs one prompt turn. `onChunk` receives raw ACP `SessionNotification.update`
   * values as they stream in; `onPermissionRequest` is asked to resolve a tool
   * permission (via `respondToPermission`) before the turn can continue.
   */
  async sendPrompt(text, { onChunk, onPermissionRequest } = {}) {
    if (this._active) throw new Error("A Claude Code prompt is already in progress");
    const { connection, sessionId } = await this._ensureSession();
    this._active = { onChunk, onPermissionRequest };
    try {
      const result = await connection.prompt({
        sessionId,
        prompt: [{ type: "text", text }],
      });
      return result;
    } finally {
      this._active = null;
    }
  }

  async cancel() {
    if (!this._connection || !this._sessionId) return;
    try {
      await this._connection.cancel({ sessionId: this._sessionId });
    } catch {
      // Best-effort; the in-flight prompt() resolves with stopReason "cancelled".
    }
  }

  async stop() {
    await this.cancel();
    this._failActive(new Error("Claude Code session stopped"));
    const child = this._childProcess;
    this._childProcess = null;
    this._connection = null;
    this._sessionId = null;
    this._initPromise = null;
    if (child && !child.killed) {
      child.kill();
    }
  }
}

module.exports = AcpClaudeCodeManager;
