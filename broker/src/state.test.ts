import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { SessionsStore } from "./state";

const tmp = join(import.meta.dir, ".tmp-state");

beforeEach(() => mkdirSync(tmp, { recursive: true }));
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

test("upsert + byTopic round-trips and persists", () => {
  const s = new SessionsStore(tmp);
  s.upsert({ sessionId: "s1", name: "foo", cwd: "/x", topicId: 42, status: "online", lastSeen: 1, socketId: "c1" });
  expect(s.byTopic(42)?.sessionId).toBe("s1");
  const s2 = new SessionsStore(tmp); // reload from disk
  expect(s2.byTopic(42)?.sessionId).toBe("s1");
});

test("setOffline keeps topic mapping", () => {
  const s = new SessionsStore(tmp);
  s.upsert({ sessionId: "s1", name: "foo", cwd: "/x", topicId: 42, status: "online", lastSeen: 1, socketId: "c1" });
  s.setOffline("s1");
  expect(s.get("s1")?.status).toBe("offline");
  expect(s.byTopic(42)?.sessionId).toBe("s1");
});

test("reuseKey returns existing topicId for same name+cwd", () => {
  const s = new SessionsStore(tmp);
  s.upsert({ sessionId: "old", name: "foo", cwd: "/x", topicId: 42, status: "offline", lastSeen: 0, socketId: "" });
  expect(s.reuseKey("foo", "/x")).toBe(42);
  expect(s.reuseKey("foo", "/y")).toBeUndefined();
});