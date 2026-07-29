import { test, expect } from "bun:test";
import { SessionsStore } from "./state";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function freshStore(): { store: SessionsStore; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "cc-tg-hub-state-"));
  return { store: new SessionsStore(dir), dir };
}

function reg(store: SessionsStore, sessionId: string, topicId: number) {
  store.upsert({ sessionId, name: "n", cwd: "/c", topicId, status: "online", lastSeen: 0, socketId: "c1", paused: false });
}

test("upsert defaults are explicit; paused persists", () => {
  const { store } = freshStore();
  reg(store, "s1", 10);
  store.setPaused("s1", true);
  expect(store.get("s1")?.paused).toBe(true);
});

test("setStopped then setOffline does NOT downgrade to offline", () => {
  const { store } = freshStore();
  reg(store, "s1", 10);
  store.setStopped("s1");
  store.setOffline("s1"); // e.g. socket closes after stop — must stay stopped
  expect(store.get("s1")?.status).toBe("stopped");
});

test("setOffline works for a non-stopped session", () => {
  const { store } = freshStore();
  reg(store, "s1", 10);
  store.setOffline("s1");
  expect(store.get("s1")?.status).toBe("offline");
  expect(store.get("s1")?.socketId).toBe("");
});

test("rename updates name", () => {
  const { store } = freshStore();
  reg(store, "s1", 10);
  store.rename("s1", "new-name");
  expect(store.get("s1")?.name).toBe("new-name");
});

test("reuseKey finds prior topic by name+cwd", () => {
  const { store } = freshStore();
  reg(store, "s1", 42);
  expect(store.reuseKey("n", "/c")).toBe(42);
  expect(store.reuseKey("other", "/c")).toBeUndefined();
});

test("record + topic mapping persist across reload", () => {
  const { store, dir } = freshStore();
  reg(store, "s1", 42);
  const reloaded = new SessionsStore(dir);
  expect(reloaded.get("s1")?.name).toBe("n");
  expect(reloaded.byTopic(42)?.sessionId).toBe("s1");
  expect(reloaded.get("s1")?.paused).toBe(false);
});

test("setOffline keeps the topic mapping", () => {
  const { store } = freshStore();
  reg(store, "s1", 42);
  store.setOffline("s1");
  expect(store.get("s1")?.status).toBe("offline");
  expect(store.byTopic(42)?.sessionId).toBe("s1");
});

test("loading a file with an online record demotes it to offline/empty socketId", () => {
  const dir = mkdtempSync(join(tmpdir(), "cc-tg-hub-state-"));
  writeFileSync(join(dir, "sessions.json"), JSON.stringify([
    { sessionId: "s1", name: "n", cwd: "/c", topicId: 10, status: "online", lastSeen: 0, socketId: "c7", paused: false },
  ]));
  const store = new SessionsStore(dir);
  expect(store.get("s1")?.status).toBe("offline");
  expect(store.get("s1")?.socketId).toBe("");
});

test("loading a file with a stopped record leaves it untouched", () => {
  const dir = mkdtempSync(join(tmpdir(), "cc-tg-hub-state-"));
  writeFileSync(join(dir, "sessions.json"), JSON.stringify([
    { sessionId: "s1", name: "n", cwd: "/c", topicId: 10, status: "stopped", lastSeen: 0, socketId: "c7", paused: false },
  ]));
  const store = new SessionsStore(dir);
  expect(store.get("s1")?.status).toBe("stopped");
  expect(store.get("s1")?.socketId).toBe("c7");
});

test("upsert takeover does NOT evict an online record", () => {
  const { store } = freshStore();
  reg(store, "old", 5);
  reg(store, "new", 5); // new sessionId takes over topic 5 (e.g. via reuseKey), old is still live
  expect(store.get("old")?.status).toBe("online");
  expect(store.byTopic(5)?.sessionId).toBe("new");
});

test("upsert takeover does NOT evict a stopped record", () => {
  const { store } = freshStore();
  reg(store, "old", 5);
  store.setStopped("old");
  reg(store, "new", 5); // takes over topic 5; old's tombstone must survive
  expect(store.get("old")?.status).toBe("stopped");
  expect(store.byTopic(5)?.sessionId).toBe("new");
});

test("upsert takeover evicts ALL same-topic offline records", () => {
  const { store } = freshStore();
  reg(store, "old1", 5);
  reg(store, "old2", 5); // takes over byTopicId; old1 not evicted (still online at this point)
  store.setOffline("old1");
  store.setOffline("old2"); // both now offline, sharing topic 5, coexisting in byId
  reg(store, "new", 5); // sweeps every offline record on topic 5
  const ids = store.list().map((r) => r.sessionId);
  expect(ids).not.toContain("old1");
  expect(ids).not.toContain("old2");
  expect(store.byTopic(5)?.sessionId).toBe("new");
});