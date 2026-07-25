import { test, expect } from "bun:test";
import { Router } from "./router";
import { SessionsStore } from "./state";
import { SocketServer } from "./socket";
import { join } from "node:path";
import { rmSync } from "node:fs";

const stateDir = join(import.meta.dir, ".tmp-router");
const sockPath = "/tmp/tg-hub-router-test.sock";
rmSync(stateDir, { recursive: true, force: true });

function fakeBot() {
  const calls: any[] = [];
  return {
    calls,
    async createTopic(name: string) { calls.push({ m: "createTopic", name }); return 10 + calls.length; },
    async sendText(topicId: number, text: string, o?: any) { calls.push({ m: "sendText", topicId, text, o }); return 200 + calls.length; },
    async sendPhoto(topicId: number, p: string, c?: string) { calls.push({ m: "sendPhoto", topicId, p, c }); return 300 + calls.length; },
    async react(mid: number, e: string) { calls.push({ m: "react", mid, e }); },
    async downloadFile(fid: string, d: string) { calls.push({ m: "downloadFile", fid, d }); return "/inbox/x.png"; },
    isAllowed: (u: number) => u === 111,
    groupId: "-1001",
  } as any;
}

test("register creates a topic and replies registered", async () => {
  const store = new SessionsStore(stateDir);
  const server = new SocketServer(sockPath);
  const sent: any[] = [];
  const bot = fakeBot();
  // stub server.send to capture outbound
  (server as any).send = (id: string, f: any) => sent.push({ id, f });
  const router = new Router(bot as any, store, server, stateDir);
  await router.handleFrame("c1", { type: "register", sessionId: "s1", name: "foo", cwd: "/x" });
  expect(bot.calls[0].m).toBe("createTopic");
  expect(sent[0].f).toEqual({ type: "registered", topicId: 11, chatId: "-1001" });
  expect(store.byTopic(11)?.sessionId).toBe("s1");
  server.stop();
});

test("second register does not kill the first session", async () => {
  const store = new SessionsStore(stateDir);
  const server = new SocketServer(sockPath);
  (server as any).send = () => {};
  const bot = fakeBot();
  const router = new Router(bot as any, store, server, stateDir);
  await router.handleFrame("c1", { type: "register", sessionId: "s1", name: "a", cwd: "/x" });
  await router.handleFrame("c2", { type: "register", sessionId: "s2", name: "b", cwd: "/y" });
  // both sessions remain online — the bug we're fixing would have killed s1
  expect(store.get("s1")?.status).toBe("online");
  expect(store.get("s2")?.status).toBe("online");
  server.stop();
});

test("inbound update routes to the session owning the topic and emits a message frame", async () => {
  const store = new SessionsStore(stateDir);
  const server = new SocketServer(sockPath);
  const sent: any[] = [];
  (server as any).send = (id: string, f: any) => sent.push({ id, f });
  const bot = fakeBot();
  const router = new Router(bot as any, store, server, stateDir);
  await router.handleFrame("c1", { type: "register", sessionId: "s1", name: "a", cwd: "/x" });
  const topicId = store.get("s1")!.topicId;
  sent.length = 0;
  await router.processUpdate({
    message: { message_thread_id: topicId, message_id: 99, from: { id: 111, username: "ren" }, date: 1780000000, text: "hello", chat: { id: "-1001" } },
  } as any);
  expect(sent[0].f.type).toBe("message");
  expect(sent[0].f.text).toBe("hello");
  expect(sent[0].f.chatId).toBe("-1001");
  server.stop();
});

test("inbound from non-allowlisted sender is dropped", async () => {
  const store = new SessionsStore(stateDir);
  const server = new SocketServer(sockPath);
  const sent: any[] = [];
  (server as any).send = (id: string, f: any) => sent.push({ id, f });
  const bot = fakeBot();
  const router = new Router(bot as any, store, server, stateDir);
  await router.handleFrame("c1", { type: "register", sessionId: "s1", name: "a", cwd: "/x" });
  const topicId = store.get("s1")!.topicId;
  sent.length = 0;
  await router.processUpdate({
    message: { message_thread_id: topicId, message_id: 99, from: { id: 999 }, date: 0, text: "hack", chat: { id: "-1001" } },
  } as any);
  expect(sent.length).toBe(0);
  server.stop();
});

test("reply frame sends text to the session's topic", async () => {
  const store = new SessionsStore(stateDir);
  const server = new SocketServer(sockPath);
  (server as any).send = () => {};
  const bot = fakeBot();
  const router = new Router(bot as any, store, server, stateDir);
  await router.handleFrame("c1", { type: "register", sessionId: "s1", name: "a", cwd: "/x" });
  const topicId = store.get("s1")!.topicId;
  bot.calls.length = 0;
  await router.handleFrame("c1", { type: "reply", chatId: "-1001", text: "hi there" });
  expect(bot.calls[0].m).toBe("sendText");
  expect(bot.calls[0].topicId).toBe(topicId);
  expect(bot.calls[0].text).toBe("hi there");
  server.stop();
});