const test = require("node:test");
const assert = require("node:assert/strict");

const load = () => import("../../src/services/ai/acpUpdateTranslator.ts");

test("agent_message_chunk with text content becomes a content chunk", async () => {
  const { translateAcpUpdate } = await load();
  const chunk = translateAcpUpdate({
    sessionUpdate: "agent_message_chunk",
    content: { type: "text", text: "hello" },
  });
  assert.deepEqual(chunk, { type: "content", text: "hello" });
});

test("agent_message_chunk with empty text is dropped", async () => {
  const { translateAcpUpdate } = await load();
  assert.equal(
    translateAcpUpdate({
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "" },
    }),
    null
  );
});

test("agent_message_chunk with a non-text block is dropped", async () => {
  const { translateAcpUpdate } = await load();
  assert.equal(
    translateAcpUpdate({ sessionUpdate: "agent_message_chunk", content: { type: "image" } }),
    null
  );
});

test("tool_call becomes a tool_calls chunk keyed by toolCallId", async () => {
  const { translateAcpUpdate } = await load();
  const chunk = translateAcpUpdate({
    sessionUpdate: "tool_call",
    toolCallId: "call-1",
    title: "Search the web",
    rawInput: { query: "openwhispr" },
  });
  assert.deepEqual(chunk, {
    type: "tool_calls",
    calls: [{ id: "call-1", name: "Search the web", arguments: '{"query":"openwhispr"}' }],
  });
});

test("tool_call falls back to kind, then a generic name, when no title is set", async () => {
  const { translateAcpUpdate } = await load();
  const withKind = translateAcpUpdate({
    sessionUpdate: "tool_call",
    toolCallId: "c1",
    kind: "fetch",
  });
  assert.equal(withKind.calls[0].name, "fetch");

  const withNeither = translateAcpUpdate({ sessionUpdate: "tool_call", toolCallId: "c2" });
  assert.equal(withNeither.calls[0].name, "tool");
});

test("tool_call_update while still in_progress or pending is dropped", async () => {
  const { translateAcpUpdate } = await load();
  for (const status of ["pending", "in_progress", null, undefined]) {
    assert.equal(
      translateAcpUpdate({ sessionUpdate: "tool_call_update", toolCallId: "c1", status }),
      null
    );
  }
});

test("tool_call_update completed extracts text content blocks as the display text", async () => {
  const { translateAcpUpdate } = await load();
  const chunk = translateAcpUpdate({
    sessionUpdate: "tool_call_update",
    toolCallId: "call-1",
    title: "Search the web",
    status: "completed",
    content: [
      { content: { type: "text", text: "first line" } },
      { content: { type: "text", text: "second line" } },
      { content: { type: "diff" } },
    ],
  });
  assert.deepEqual(chunk, {
    type: "tool_result",
    callId: "call-1",
    toolName: "Search the web",
    displayText: "first line\nsecond line",
  });
});

test("tool_call_update completed with no text content falls back to Done", async () => {
  const { translateAcpUpdate } = await load();
  const chunk = translateAcpUpdate({
    sessionUpdate: "tool_call_update",
    toolCallId: "call-1",
    status: "completed",
  });
  assert.equal(chunk.displayText, "Done");
});

test("tool_call_update failed with no text content falls back to Failed", async () => {
  const { translateAcpUpdate } = await load();
  const chunk = translateAcpUpdate({
    sessionUpdate: "tool_call_update",
    toolCallId: "call-1",
    status: "failed",
  });
  assert.equal(chunk.displayText, "Failed");
});

test("plan, thought, and user echo updates are dropped", async () => {
  const { translateAcpUpdate } = await load();
  for (const sessionUpdate of ["plan", "agent_thought_chunk", "user_message_chunk"]) {
    assert.equal(translateAcpUpdate({ sessionUpdate }), null);
  }
});
