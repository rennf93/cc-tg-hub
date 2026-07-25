import { test, expect } from "bun:test";
import { BotApi } from "./telegram";

// Minimal in-process Bot API mock on a random port.
function mockApi() {
  const calls: any[] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      const method = url.pathname.split("/").pop()!;
      const body = req.method === "POST" ? await req.formData().then((f) => Object.fromEntries(f.entries())) : {};
      calls.push({ method, body });
      const ok = (result: unknown) => new Response(JSON.stringify({ ok: true, result }), { headers: { "content-type": "application/json" } });
      switch (method) {
        case "getUpdates": return ok([]);
        case "createForumTopic": return ok({ message_thread_id: 77, name: "x", icon_color: 0 });
        case "sendMessage": return ok({ message_id: 100, text: body.text });
        case "setMessageReaction": return ok(true);
        default: return ok(true);
      }
    },
  });
  return { calls, apiRoot: `http://localhost:${server.port}`, stop: () => server.stop() };
}

test("createTopic calls createForumTopic and returns thread id", async () => {
  const m = mockApi();
  const api = new BotApi("t:token", "-1001", m.apiRoot);
  const id = await api.createTopic("foo");
  expect(id).toBe(77);
  expect(m.calls[0].method).toBe("createForumTopic");
  m.stop();
});

test("sendText passes message_thread_id and text", async () => {
  const m = mockApi();
  const api = new BotApi("t:token", "-1001", m.apiRoot);
  await api.sendText(77, "hi");
  expect(m.calls[0].body.message_thread_id).toBe("77");
  expect(m.calls[0].body.text).toBe("hi");
  m.stop();
});

test("isAllowed reflects allowlist", () => {
  const api = new BotApi("t:token", "-1001", undefined, [111, 222]);
  expect(api.isAllowed(111)).toBe(true);
  expect(api.isAllowed(333)).toBe(false);
});

test("groupId is publicly readable", () => {
  const api = new BotApi("t:token", "-1001", undefined, [1]);
  expect(api.groupId).toBe("-1001");
});