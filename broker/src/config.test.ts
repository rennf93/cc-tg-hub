import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "./config";

const tmp = join(import.meta.dir, ".tmp-config");

beforeEach(() => mkdirSync(tmp, { recursive: true }));
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

test("loadConfig parses a valid config", () => {
  writeFileSync(join(tmp, "config.json"), JSON.stringify({
    botToken: "123:abc", groupId: "-100123", allowUserIds: [111], socketPath: join(tmp, "s.sock"), stateDir: tmp,
  }));
  const c = loadConfig(join(tmp, "config.json"));
  expect(c.botToken).toBe("123:abc");
  expect(c.groupId).toBe("-100123");
  expect(c.allowUserIds).toEqual([111]);
});

test("loadConfig throws on missing botToken", () => {
  writeFileSync(join(tmp, "config.json"), JSON.stringify({ groupId: "-100123", allowUserIds: [111], socketPath: "x", stateDir: "y" }));
  expect(() => loadConfig(join(tmp, "config.json"))).toThrow(/botToken/);
});