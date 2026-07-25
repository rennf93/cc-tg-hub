import { test, expect } from "bun:test";
import { SessionsStore } from "./state";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function freshStore(): { store: SessionsStore; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "tg-hub-state-"));
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