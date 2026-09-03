const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");

const storeModulePath = require.resolve("../../src/helpers/mcpServerStore");
const originalLoad = Module._load;

// Loads a fresh mcpServerStore backed by a throwaway userData directory, so
// each test starts from an empty mcp-servers.json with no real filesystem
// state leaking between runs.
function loadStore() {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "openwhispr-mcp-store-test-"));
  delete require.cache[storeModulePath];

  Module._load = function loadWithMocks(request, parent, isMain) {
    if (request === "electron") {
      return { app: { getPath: () => userDataDir } };
    }
    return originalLoad(request, parent, isMain);
  };

  try {
    const store = require(storeModulePath);
    return { store, userDataDir };
  } finally {
    Module._load = originalLoad;
  }
}

test("list() on a fresh store returns an empty array", () => {
  const { store } = loadStore();
  assert.deepEqual(store.list(), []);
});

test("add() assigns an id, defaults enabled to true, and persists to disk", () => {
  const { store, userDataDir } = loadStore();
  const server = store.add({
    name: "My Server",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@my-org/mcp-server"],
    env: { API_KEY: "secret" },
  });

  assert.ok(server.id);
  assert.equal(server.name, "My Server");
  assert.equal(server.enabled, true);
  assert.equal(server.command, "npx");
  assert.deepEqual(server.args, ["-y", "@my-org/mcp-server"]);
  assert.deepEqual(server.env, { API_KEY: "secret" });
  assert.equal(store.list().length, 1);

  const onDisk = JSON.parse(fs.readFileSync(path.join(userDataDir, "mcp-servers.json"), "utf-8"));
  assert.equal(onDisk.length, 1);
  assert.equal(onDisk[0].id, server.id);
});

test("add() with transport http keeps only url/headers, never stdio fields", () => {
  const { store } = loadStore();
  const server = store.add({
    name: "Remote",
    transport: "http",
    url: "https://example.com/mcp",
    headers: { Authorization: "Bearer token" },
    command: "should-be-ignored",
  });

  assert.equal(server.transport, "http");
  assert.equal(server.url, "https://example.com/mcp");
  assert.deepEqual(server.headers, { Authorization: "Bearer token" });
  assert.equal(server.command, undefined);
  assert.equal(server.args, undefined);
});

test("an unrecognized transport falls back to stdio", () => {
  const { store } = loadStore();
  const server = store.add({ name: "X", transport: "carrier-pigeon", command: "run" });
  assert.equal(server.transport, "stdio");
});

test("update() merges a patch and re-sanitizes, preserving the id", () => {
  const { store } = loadStore();
  const server = store.add({ name: "Original", transport: "stdio", command: "run" });
  const updated = store.update(server.id, { name: "Renamed", enabled: false });

  assert.equal(updated.id, server.id);
  assert.equal(updated.name, "Renamed");
  assert.equal(updated.enabled, false);
  assert.equal(updated.command, "run");
});

test("update() on an unknown id returns null and changes nothing", () => {
  const { store } = loadStore();
  store.add({ name: "Keep me", transport: "stdio", command: "run" });
  assert.equal(store.update("does-not-exist", { name: "x" }), null);
  assert.equal(store.list().length, 1);
});

test("remove() deletes the matching server and reports success", () => {
  const { store } = loadStore();
  const server = store.add({ name: "Temp", transport: "stdio", command: "run" });
  assert.equal(store.remove(server.id), true);
  assert.deepEqual(store.list(), []);
});

test("remove() on an unknown id returns false", () => {
  const { store } = loadStore();
  assert.equal(store.remove("does-not-exist"), false);
});

test("get() returns null for an unknown id", () => {
  const { store } = loadStore();
  assert.equal(store.get("does-not-exist"), null);
});

test("env and headers entries with non-string values are dropped", () => {
  const { store } = loadStore();
  const server = store.add({
    name: "X",
    transport: "stdio",
    command: "run",
    env: { GOOD: "1", BAD: 2, ALSO_BAD: null },
  });
  assert.deepEqual(server.env, { GOOD: "1" });
});
