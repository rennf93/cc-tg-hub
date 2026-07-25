import { test, expect } from "bun:test";
import { serveStatic } from "./static";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function dist(): string {
  const d = mkdtempSync(join(tmpdir(), "tg-hub-dist-"));
  writeFileSync(join(d, "index.html"), "<!doctype html><div id=\"root\"></div>");
  mkdirSync(join(d, "assets"), { recursive: true });
  writeFileSync(join(d, "assets/app.js"), "console.log('x')");
  return d;
}

test("serves a known file", async () => {
  const d = dist();
  const serve = serveStatic(d);
  const res = serve(new Request("http://x/assets/app.js"));
  expect(res?.status).toBe(200);
  expect(await res?.text()).toContain("console.log");
});

test("unknown path falls back to index.html (SPA)", async () => {
  const d = dist();
  const serve = serveStatic(d);
  const res = serve(new Request("http://x/sessions/s1"));
  expect(res?.status).toBe(200);
  expect(await res?.text()).toContain("id=\"root\"");
});

test("returns null for directory traversal attempts", () => {
  const d = dist();
  const serve = serveStatic(d);
  // ponytail: %2f-encoded slash survives URL normalization so `..` reaches the guard;
  // a literal `../../` would be normalized to `/etc/passwd` by the URL parser and fall
  // through to SPA fallback, not test the guard.
  const res = serve(new Request("http://x/..%2f..%2fetc/passwd"));
  expect(res).toBeNull();
});