import { test, expect, mock } from "bun:test";
import { Router } from "./router";
import type { BotApi } from "./telegram";
import type { Frame } from "@tg-hub/frames";

type SendLog = { id: string; frame: Frame };
function fakeServer() {
  const sent: SendLog[] = [];
  return {
    sent,
    send: (id: string, frame: Frame) => sent.push({ id, frame }),
  } as any;
}
function fakeBot(overrides: Partial<BotApi> = {}): BotApi {
  return {
    groupId: "-100123",
    isAllowed: () => true,
    createTopic: async () => 99,
    sendText: async () => 1,
    sendPhoto: async () => 1,
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
function freshStore() { return new SessionsStore(mkdtempSync(join(tmpdir(), "tg-hub-r-"))); }

test("processUpdate drops a paused session before any side effect", async () => {
  const bot = fakeBot({ downloadFile: mock(async () => "/tmp/should-not") });
  const store = freshStore();
  const server = fakeServer();
  const r = new Router(bot, store, server as any, "/tmp/tg-hub-r-inbox");
  store.upsert({ sessionId: "s1", name: "n", cwd: "/c", topicId: 10, status: "online", lastSeen: 0, socketId: "c1", paused: true });
  await r.processUpdate({ message: { message_thread_id: 10, message_id: 1, from: { id: 7 }, date: 1, text: "hi", chat: { id: "-100123" } } } as any);
  expect((bot.downloadFile as any).mock.calls.length).toBe(0);   // no photo download attempted
  expect(server.sent.length).toBe(0);                            // no frame sent
});

test("processUpdate bumps lastSeen and sends a message frame", async () => {
  const bot = fakeBot();
  const store = freshStore();
  const server = fakeServer();
  const r = new Router(bot, store, server as any, "/tmp/tg-hub-r-inbox");
  store.upsert({ sessionId: "s1", name: "n", cwd: "/c", topicId: 10, status: "online", lastSeen: 0, socketId: "c1", paused: false });
  await r.processUpdate({ message: { message_thread_id: 10, message_id: 1, from: { id: 7, username: "u" }, date: 1, text: "hi", chat: { id: "-100123" } } } as any);
  expect(server.sent.length).toBe(1);
  expect(server.sent[0].frame).toHaveProperty("type", "message");
  expect(store.get("s1")?.lastSeen).toBeGreaterThan(0);
});

test("handleReply bumps lastSeen", async () => {
  const bot = fakeBot({ sendText: mock(async () => 5) });
  const store = freshStore();
  const server = fakeServer();
  const r = new Router(bot, store, server as any, "/tmp/tg-hub-r-inbox");
  // Register first so socketToSession["c1"] -> "s1" is seeded by the real path.
  await r.handleFrame("c1", { type: "register", sessionId: "s1", name: "n", cwd: "/c" });
  const before = store.get("s1")!.lastSeen;
  await new Promise((res) => setTimeout(res, 5)); // ensure Date.now() advances
  await r.handleFrame("c1", { type: "reply", chatId: "-100123", text: "yo" });
  expect(store.get("s1")!.lastSeen).toBeGreaterThan(before);
});

test("stop() sends a stop frame and marks stopped", async () => {
  const bot = fakeBot();
  const store = freshStore();
  const server = fakeServer();
  const r = new Router(bot, store, server as any, "/tmp/tg-hub-r-inbox");
  store.upsert({ sessionId: "s1", name: "n", cwd: "/c", topicId: 10, status: "online", lastSeen: 0, socketId: "c1", paused: false });
  r.stop("s1");
  expect(server.sent).toContainEqual({ id: "c1", frame: { type: "stop" } });
  expect(store.get("s1")?.status).toBe("stopped");
});

test("handleDisconnect on a stopped record is a no-op", () => {
  const bot = fakeBot();
  const store = freshStore();
  const server = fakeServer();
  const r = new Router(bot, store, server as any, "/tmp/tg-hub-r-inbox");
  store.upsert({ sessionId: "s1", name: "n", cwd: "/c", topicId: 10, status: "online", lastSeen: 0, socketId: "c1", paused: false });
  store.setStopped("s1");
  r.handleDisconnect("c1");
  expect(store.get("s1")?.status).toBe("stopped");
});