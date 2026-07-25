import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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

function writeCfg(dir: string, raw: object): string {
  const p = join(dir, "config.json");
  writeFileSync(p, JSON.stringify(raw));
  return p;
}

test("defaults applied when Phase 2 fields absent", () => {
  const dir = mkdtempSync(join(tmpdir(), "tg-hub-cfg-"));
  const p = writeCfg(dir, { botToken: "t", groupId: "-1001", allowUserIds: [7] });
  const c = loadConfig(p);
  expect(c.idleMs).toBe(300000);
  expect(c.authFreshnessMs).toBe(86400000);
  expect(c.sessionTtlMs).toBe(604800000);
  expect(c.httpPort).toBe(8787);
  expect(c.webAppOrigin).toBe("http://localhost:5173");
});

test("explicit values honored", () => {
  const dir = mkdtempSync(join(tmpdir(), "tg-hub-cfg-"));
  const p = writeCfg(dir, { botToken: "t", groupId: "-1001", allowUserIds: [7], idleMs: 60000, httpPort: 9000, webAppOrigin: "https://app.example" });
  const c = loadConfig(p);
  expect(c.idleMs).toBe(60000);
  expect(c.httpPort).toBe(9000);
  expect(c.webAppOrigin).toBe("https://app.example");
});