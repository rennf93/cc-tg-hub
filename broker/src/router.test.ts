import { test, expect, mock } from "bun:test";
import { Router } from "./router";
import type { BotApi } from "./telegram";
import type { Frame } from "@cc-tg-hub/frames";

type SendLog = { id: string; frame: Frame };
function fakeServer(opts: { live?: Set<string> } = {}) {
  const sent: SendLog[] = [];
  return {
    sent,
    send: (id: string, frame: Frame) => sent.push({ id, frame }),
    has: (id: string) => (opts.live ? opts.live.has(id) : true),   // default: every socketId is live
  } as any;
}
function fakeBot(overrides: Partial<BotApi> = {}): BotApi {
  return {
    groupId: "-100123",
    isAllowed: () => true,
    createTopic: async () => 99,
    sendText: async () => 1,
    sendPhoto: async () => 1,
    answerCallback: async () => undefined,
    editText: async () => undefined,
    react: async () => undefined,
    downloadFile: async () => "/tmp/x",
    editForumTopicTitle: mock(async () => undefined),
    ...overrides,
  } as unknown as BotApi;
}

import { SessionsStore } from "./state";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
function freshStore() { return new SessionsStore(mkdtempSync(join(tmpdir(), "cc-tg-hub-r-"))); }

test("processUpdate drops a paused session before any side effect", async () => {
  const bot = fakeBot({ downloadFile: mock(async () => "/tmp/should-not") });
  const store = freshStore();
  const server = fakeServer();
  const r = new Router(bot, store, server as any, "/tmp/cc-tg-hub-r-inbox");
  store.upsert({ sessionId: "s1", name: "n", cwd: "/c", topicId: 10, status: "online", lastSeen: 0, socketId: "c1", paused: true });
  await r.processUpdate({ message: { message_thread_id: 10, message_id: 1, from: { id: 7 }, date: 1, text: "hi", chat: { id: "-100123" } } } as any);
  expect((bot.downloadFile as any).mock.calls.length).toBe(0);   // no photo download attempted
  expect(server.sent.length).toBe(0);                            // no frame sent
});

test("processUpdate bumps lastSeen and sends a message frame", async () => {
  const bot = fakeBot();
  const store = freshStore();
  const server = fakeServer();
  const r = new Router(bot, store, server as any, "/tmp/cc-tg-hub-r-inbox");
  store.upsert({ sessionId: "s1", name: "n", cwd: "/c", topicId: 10, status: "online", lastSeen: 0, socketId: "c1", paused: false });
  await r.processUpdate({ message: { message_thread_id: 10, message_id: 1, from: { id: 7, username: "u" }, date: 1, text: "hi", chat: { id: "-100123" } } } as any);
  expect(server.sent.length).toBe(1);
  expect(server.sent[0].frame).toHaveProperty("type", "message");
  expect(store.get("s1")?.lastSeen).toBeGreaterThan(0);
});

test("processUpdate stringifies Telegram's numeric chat.id", async () => {
  // Regression: Telegram sends chat.id as a NUMBER. Forwarding it raw put a number
  // in MessageFrame.chatId -> claude's channel schema (every meta value must be a
  // string) threw in its notification handler and dropped the MCP connection, so
  // every inbound message was lost. Tests used to pass a string id and missed it.
  const bot = fakeBot();
  const store = freshStore();
  const server = fakeServer();
  const r = new Router(bot, store, server as any, "/tmp/cc-tg-hub-r-inbox");
  store.upsert({ sessionId: "s1", name: "n", cwd: "/c", topicId: 10, status: "online", lastSeen: 0, socketId: "c1", paused: false });
  await r.processUpdate({ message: { message_thread_id: 10, message_id: 1, from: { id: 7, username: "u" }, date: 1, text: "hi", chat: { id: -1004389179455 } } } as any);
  const frame = server.sent[0].frame as any;
  expect(frame.chatId).toBe("-1004389179455");
  for (const [k, v] of Object.entries(frame)) {
    if (k === "topicId" || v === undefined) continue;
    expect(typeof v).toBe("string");   // everything claude sees as meta must be a string
  }
});

test("handleReply bumps lastSeen", async () => {
  const bot = fakeBot({ sendText: mock(async () => 5) });
  const store = freshStore();
  const server = fakeServer();
  const r = new Router(bot, store, server as any, "/tmp/cc-tg-hub-r-inbox");
  // Register first so socketToSession["c1"] -> "s1" is seeded by the real path.
  await r.handleFrame("c1", { type: "register", sessionId: "s1", name: "n", cwd: "/c" });
  const before = store.get("s1")!.lastSeen;
  await new Promise((res) => setTimeout(res, 5)); // ensure Date.now() advances
  await r.handleFrame("c1", { type: "reply", chatId: "-100123", text: "yo" });
  expect(store.get("s1")!.lastSeen).toBeGreaterThan(before);
});

async function askPermission(r: Router, bot: BotApi) {
  await r.handleFrame("c1", { type: "register", sessionId: "s1", name: "n", cwd: "/c" });
  await r.handleFrame("c1", { type: "permission_ask", requestId: "req-abc", toolName: "Bash", description: "npm publish", inputPreview: "npm publish --access public" });
  return (bot.sendText as any).mock.calls[0];
}

test("permission_ask posts Allow/Deny buttons in the session's topic", async () => {
  const bot = fakeBot({ sendText: mock(async () => 77) });
  const r = new Router(bot, freshStore(), fakeServer() as any, "/tmp/cc-tg-hub-r-inbox");
  const [topicId, text, opts] = await askPermission(r, bot);
  expect(topicId).toBe(99);                       // the topic createTopic handed this session
  expect(text).toContain("Bash");
  expect(text).toContain("npm publish --access public");
  expect(opts.buttons.map((b: any) => b.data)).toEqual(["perm:1:allow", "perm:1:deny"]);
});

test("tapping Allow routes a decision frame back to the asking session", async () => {
  const bot = fakeBot({ sendText: mock(async () => 77), answerCallback: mock(async () => undefined), editText: mock(async () => undefined) });
  const server = fakeServer();
  const r = new Router(bot, freshStore(), server as any, "/tmp/cc-tg-hub-r-inbox");
  await askPermission(r, bot);
  await r.processCallback({ callback_query: { id: "cb1", from: { id: 7, username: "u" }, data: "perm:1:allow" } } as any);
  expect(server.sent).toContainEqual({ id: "c1", frame: { type: "permission_decision", requestId: "req-abc", behavior: "allow" } });
  // Answering twice must not re-fire: the token is consumed.
  await r.processCallback({ callback_query: { id: "cb2", from: { id: 7 }, data: "perm:1:allow" } } as any);
  expect(server.sent.filter((s) => s.frame.type === "permission_decision").length).toBe(1);
});

test("a tap from a user outside the allowlist decides nothing", async () => {
  const bot = fakeBot({ sendText: mock(async () => 77), answerCallback: mock(async () => undefined), isAllowed: (id: number) => id === 7 });
  const server = fakeServer();
  const r = new Router(bot, freshStore(), server as any, "/tmp/cc-tg-hub-r-inbox");
  await askPermission(r, bot);
  await r.processCallback({ callback_query: { id: "cb1", from: { id: 999 }, data: "perm:1:allow" } } as any);
  expect(server.sent.some((s) => s.frame.type === "permission_decision")).toBe(false);
});

test("a tap for a session whose socket died decides nothing", async () => {
  const bot = fakeBot({ sendText: mock(async () => 77), answerCallback: mock(async () => undefined) });
  const live = new Set(["c1"]);
  const server = fakeServer({ live });
  const r = new Router(bot, freshStore(), server as any, "/tmp/cc-tg-hub-r-inbox");
  await askPermission(r, bot);
  live.delete("c1");                               // session exits before anyone taps
  await r.processCallback({ callback_query: { id: "cb1", from: { id: 7 }, data: "perm:1:allow" } } as any);
  expect(server.sent.some((s) => s.frame.type === "permission_decision")).toBe(false);
});

test("stop() sends a stop frame and marks stopped", async () => {
  const bot = fakeBot();
  const store = freshStore();
  const server = fakeServer();
  const r = new Router(bot, store, server as any, "/tmp/cc-tg-hub-r-inbox");
  store.upsert({ sessionId: "s1", name: "n", cwd: "/c", topicId: 10, status: "online", lastSeen: 0, socketId: "c1", paused: false });
  r.stop("s1");
  expect(server.sent).toContainEqual({ id: "c1", frame: { type: "stop" } });
  expect(store.get("s1")?.status).toBe("stopped");
});

test("handleDisconnect on a stopped record is a no-op", () => {
  const bot = fakeBot();
  const store = freshStore();
  const server = fakeServer();
  const r = new Router(bot, store, server as any, "/tmp/cc-tg-hub-r-inbox");
  store.upsert({ sessionId: "s1", name: "n", cwd: "/c", topicId: 10, status: "online", lastSeen: 0, socketId: "c1", paused: false });
  store.setStopped("s1");
  r.handleDisconnect("c1");
  expect(store.get("s1")?.status).toBe("stopped");
});

test("handleRegister does not resurrect a stopped session — re-sends stop", async () => {
  const bot = fakeBot();
  const store = freshStore();
  const server = fakeServer();
  const r = new Router(bot, store, server as any, "/tmp/cc-tg-hub-r-inbox");
  // A stopped session whose socket died before the stop frame was delivered.
  store.upsert({ sessionId: "s1", name: "n", cwd: "/c", topicId: 10, status: "stopped", lastSeen: 0, socketId: "", paused: false });
  // The same MCP (same sessionId) reconnects on a fresh socket.
  await r.handleFrame("c2", { type: "register", sessionId: "s1", name: "n", cwd: "/c" });
  // The session stays stopped — not resurrected to online.
  expect(store.get("s1")?.status).toBe("stopped");
  // The fresh socket was told to stop (so the MCP disconnects and won't loop).
  expect(server.sent.some((s) => s.id === "c2" && s.frame.type === "stop")).toBe(true);
  // No registered frame was sent — the MCP is not being admitted.
  expect(server.sent.some((s) => s.frame.type === "registered")).toBe(false);
});

test("handleRegister still admits a re-register of an online/offline session", async () => {
  // Regression guard: the new guard must not block the normal reconnect path.
  const bot = fakeBot();
  const store = freshStore();
  const server = fakeServer();
  const r = new Router(bot, store, server as any, "/tmp/cc-tg-hub-r-inbox");
  store.upsert({ sessionId: "s1", name: "n", cwd: "/c", topicId: 10, status: "offline", lastSeen: 0, socketId: "", paused: false });
  await r.handleFrame("c2", { type: "register", sessionId: "s1", name: "n", cwd: "/c" });
  expect(store.get("s1")?.status).toBe("online");
  expect(store.get("s1")?.socketId).toBe("c2");
  expect(server.sent.some((s) => s.id === "c2" && s.frame.type === "registered")).toBe(true);
  expect(server.sent.some((s) => s.frame.type === "stop")).toBe(false);
});

test("processUpdate drops when the record's socketId is not live, and marks it offline", async () => {
  const bot = fakeBot({ downloadFile: mock(async () => "/tmp/should-not") });
  const store = freshStore();
  const server = fakeServer({ live: new Set() });   // no socketId is live
  const r = new Router(bot, store, server as any, "/tmp/cc-tg-hub-r-inbox");
  store.upsert({ sessionId: "s1", name: "n", cwd: "/c", topicId: 10, status: "online", lastSeen: 0, socketId: "c1", paused: false });
  await r.processUpdate({ message: { message_thread_id: 10, message_id: 1, from: { id: 7 }, date: 1, text: "hi", chat: { id: "-100123" } } } as any);
  expect(server.sent.length).toBe(0);
  expect(store.get("s1")?.status).toBe("offline");
});

test("handleDisconnect of a stale socketId after reconnect does not offline the record (race guard)", async () => {
  const bot = fakeBot();
  const store = freshStore();
  const server = fakeServer();
  const r = new Router(bot, store, server as any, "/tmp/cc-tg-hub-r-inbox");
  await r.handleFrame("c1", { type: "register", sessionId: "s1", name: "n", cwd: "/c" });
  await r.handleFrame("c2", { type: "register", sessionId: "s1", name: "n", cwd: "/c" }); // reconnect on new socket first
  r.handleDisconnect("c1"); // old socket's close arrives late
  expect(store.get("s1")?.status).toBe("online");
  expect(store.get("s1")?.socketId).toBe("c2");
});

test("two live sessions sharing (name,cwd): first session's reply still resolves after the second registers (no ping-pong eviction)", async () => {
  const bot = fakeBot({ sendText: mock(async () => 5) });
  const store = freshStore();
  const server = fakeServer();
  const r = new Router(bot, store, server as any, "/tmp/cc-tg-hub-r-inbox");
  await r.handleFrame("c1", { type: "register", sessionId: "s1", name: "n", cwd: "/c" });
  await r.handleFrame("c2", { type: "register", sessionId: "s2", name: "n", cwd: "/c" }); // reuseKey hands it the same topic as s1
  await r.handleFrame("c1", { type: "reply", chatId: "-100123", text: "still alive" });
  expect((bot.sendText as any).mock.calls.length).toBe(1); // s1's record must still exist
});

test("handleDisconnect of the current socketId offlines the record", async () => {
  const bot = fakeBot();
  const store = freshStore();
  const server = fakeServer();
  const r = new Router(bot, store, server as any, "/tmp/cc-tg-hub-r-inbox");
  await r.handleFrame("c1", { type: "register", sessionId: "s1", name: "n", cwd: "/c" });
  await r.handleFrame("c2", { type: "register", sessionId: "s1", name: "n", cwd: "/c" });
  r.handleDisconnect("c2"); // the socket the record currently points at
  expect(store.get("s1")?.status).toBe("offline");
});