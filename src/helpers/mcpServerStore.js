const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { app } = require("electron");

const FILE_NAME = "mcp-servers.json";

function storePath() {
  return path.join(app.getPath("userData"), FILE_NAME);
}

function readAll() {
  try {
    const raw = fs.readFileSync(storePath(), "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAll(servers) {
  fs.mkdirSync(path.dirname(storePath()), { recursive: true });
  fs.writeFileSync(storePath(), JSON.stringify(servers, null, 2), "utf-8");
}

function sanitize(config) {
  const transport =
    config.transport === "http" || config.transport === "sse" ? config.transport : "stdio";
  const base = {
    id: typeof config.id === "string" && config.id ? config.id : crypto.randomUUID(),
    name: typeof config.name === "string" ? config.name.trim() : "",
    transport,
    enabled: config.enabled !== false,
    createdAt: typeof config.createdAt === "number" ? config.createdAt : Date.now(),
  };

  if (transport === "stdio") {
    return {
      ...base,
      command: typeof config.command === "string" ? config.command.trim() : "",
      args: Array.isArray(config.args) ? config.args.filter((a) => typeof a === "string") : [],
      env:
        config.env && typeof config.env === "object"
          ? Object.fromEntries(Object.entries(config.env).filter(([, v]) => typeof v === "string"))
          : {},
    };
  }

  return {
    ...base,
    url: typeof config.url === "string" ? config.url.trim() : "",
    headers:
      config.headers && typeof config.headers === "object"
        ? Object.fromEntries(
            Object.entries(config.headers).filter(([, v]) => typeof v === "string")
          )
        : {},
  };
}

function list() {
  return readAll();
}

function get(id) {
  return readAll().find((s) => s.id === id) || null;
}

function add(config) {
  const server = sanitize(config);
  const servers = readAll();
  servers.push(server);
  writeAll(servers);
  return server;
}

function update(id, patch) {
  const servers = readAll();
  const index = servers.findIndex((s) => s.id === id);
  if (index === -1) return null;
  const updated = sanitize({ ...servers[index], ...patch, id });
  servers[index] = updated;
  writeAll(servers);
  return updated;
}

function remove(id) {
  const servers = readAll();
  const next = servers.filter((s) => s.id !== id);
  if (next.length === servers.length) return false;
  writeAll(next);
  return true;
}

module.exports = { list, get, add, update, remove, storePath, sanitize };
