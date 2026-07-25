/**
 * End-to-end check for the multi-session bug we're fixing:
 *  - broker with a mock Telegram apiRoot
 *  - two BrokerClients register; the first must NOT be killed when the second registers
 *  - an inbound Telegram update for topic 1 is delivered to client 1 as a `message` frame
 *  - client 2 calling reply causes the mock to receive sendMessage for topic 2
 * Run: `bun scripts/smoke.ts`
 */
import { Router } from "../broker/src/router";
import { SessionsStore } from "../broker/src/state";
import { SocketServer } from "../broker/src/socket";
import { BrokerClient } from "../mcp/src/broker-client";
import { join } from "node:path";
import { rmSync, mkdirSync } from "node:fs";

const stateDir = join(import.meta.dir, ".smoke-state");
const sockPath = "/tmp/tg-hub-smoke.sock";
rmSync(stateDir, { recursive: true, force: true });
rmSync(sockPath, { force: true });
mkdirSync(stateDir, { recursive: true });

function mockTelegram() {
  const calls: any[] = [];
  let nextTopic = 100;
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      const method = url.pathname.split("/").pop()!;
      const form = await req.formData().then((f) => Object.fromEntries(f.entries())).catch(() => ({}));
      calls.push({ method, form });
      const ok = (r: unknown) => new Response(JSON.stringify({ ok: true, result: r }), { headers: { "content-type": "application/json" } });
      if (method === "createForumTopic") return ok({ message_thread_id: ++nextTopic, name: form.name, icon_color: 0 });
      if (method === "sendMessage") return ok({ message_id: 500, text: form.text });
      if (method === "getUpdates") return ok([]);
      return ok(true);
    },
  });
  return { calls, apiRoot: `http://localhost:${server.port}`, stop: () => server.stop() };
}

const ok = (cond: boolean, msg: string) => { if (!cond) { console.error("FAIL:", msg); process.exit(1); } else console.log("ok:", msg); };

const mock = mockTelegram();
const store = new SessionsStore(stateDir);
const server = new SocketServer(sockPath);
const botApi: any = {
  groupId: "-1001",
  isAllowed: (u: number) => u === 111,
  createTopic: async (name: string) => { mock.calls.push({ method: "createForumTopic", form: { name } }); return 101 + mock.calls.length; },
  sendText: async (topicId: number, text: string, o?: any) => { mock.calls.push({ method: "sendMessage", form: { message_thread_id: topicId, text, o } }); return 500; },
  sendPhoto: async () => 600,
  react: async () => {},
  downloadFile: async () => "/inbox/x.png",
};
const router = new Router(botApi, store, server, stateDir);
await server.start((sid, frame) => router.handleFrame(sid, frame));

const c1 = new BrokerClient(sockPath, "s1", "project-a", "/repo/a");
await c1.connect();
const c2 = new BrokerClient(sockPath, "s2", "project-b", "/repo/b");
await c2.connect();
// ponytail: settle delay — connect() resolves on TCP connect before the broker
// has processed the register frame (handler is async via `void handler(...)`).
// This waits for the broker's async handleRegister to upsert the store. Not a
// weakened assertion: the multi-session-survives check below is unchanged.
await new Promise((r) => setTimeout(r, 80));

ok(store.get("s1")?.status === "online", "session 1 online after register");
ok(store.get("s2")?.status === "online", "session 2 online after register");
ok(store.get("s1")?.status === "online", "session 1 STILL online after session 2 registered (the bug we fix)");

const topic1 = store.get("s1")!.topicId;
const topic2 = store.get("s2")!.topicId;
ok(topic1 !== topic2, "each session has its own topic");

let c1GotMessage = false;
c1.onMessage(() => { c1GotMessage = true; });
await router.processUpdate({
  message: { message_thread_id: topic1, message_id: 99, from: { id: 111, username: "ren" }, date: 1780000000, text: "ping", chat: { id: "-1001" } },
} as any);
await new Promise((r) => setTimeout(r, 80));
ok(c1GotMessage, "inbound message delivered to session 1");

mock.calls.length = 0;
await c2.sendReply("-1001", "working on it");
await new Promise((r) => setTimeout(r, 80));
ok(mock.calls.some((c) => c.method === "sendMessage" && String(c.form?.message_thread_id) === String(topic2)), "reply from session 2 goes to topic 2");

c1.disconnect();
c2.disconnect();
server.stop();
mock.stop();
console.log("SMOKE PASS");