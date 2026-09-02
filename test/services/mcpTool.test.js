const test = require("node:test");
const assert = require("node:assert/strict");

const load = () => import("../../src/services/tools/mcpTool.ts");

test("mcpToolName namespaces by server id so identical tool names never collide", async () => {
  const { mcpToolName } = await load();
  const a = mcpToolName({ serverId: "server-1", name: "search" });
  const b = mcpToolName({ serverId: "server-2", name: "search" });
  assert.notEqual(a, b);
  assert.equal(a, "mcp_server_1_search");
  assert.equal(b, "mcp_server_2_search");
});

test("mcpToolName sanitizes characters the tool-name schema wouldn't accept", async () => {
  const { mcpToolName } = await load();
  assert.equal(
    mcpToolName({ serverId: "my server.local", name: "do_thing" }),
    "mcp_my_server_local_do_thing"
  );
});
