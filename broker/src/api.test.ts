import { test, expect } from "bun:test";
import { Api, validateInitData } from "./api";
import { createHmac } from "node:crypto";
import { SessionsStore } from "./state";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BOT_TOKEN = "1234:token";
const USER_ID = 7;

/** Build a Telegram-signed initData string for tests. */
function signedInitData(userId: number, authDate: number): string {
  const params = new URLSearchParams();
  params.set("user", JSON.stringify({ id: userId, first_name: "Op" }));
  params.set("auth_date", String(authDate));
  const entries = [...params.entries()].sort(([a], [b]) => a.localeCompare(b));
  const dataCheck = entries.map(([k, v]) => `${k}=${v}`).join("\n");
  const secret = createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
  const hash = createHmac("sha256", secret).update(dataCheck).digest("hex");
  params.set("hash", hash);
  return params.toString();
}

function cfg(over: Record<string, unknown> = {}) {
  return {
    botToken: BOT_TOKEN, groupId: "-100123", allowUserIds: [USER_ID],
    socketPath: "/tmp/x.sock", stateDir: "/tmp/x", idleMs: 300000,
    authFreshnessMs: 86400000, sessionTtlMs: 604800000, httpPort: 8787,
    webAppOrigin: "http://localhost:5173", ...over,
  } as any;
}
function freshStore() { return new SessionsStore(mkdtempSync(join(tmpdir(), "cc-tg-hub-api-"))); }
function fakeRouter() { return { stop: () => undefined } as any; }

test("validateInitData accepts a valid signature for an allowlisted user", () => {
  const r = validateInitData(signedInitData(USER_ID, Math.floor(Date.now()/1000)), BOT_TOKEN, [USER_ID], 86400000);
  expect(r.ok).toBe(true);
  expect(r.userId).toBe(USER_ID);
});

test("validateInitData rejects a tampered hash", () => {
  const bad = signedInitData(USER_ID, Math.floor(Date.now()/1000)).replace(/hash=[0-9a-f]+/, "hash=deadbeef");
  const r = validateInitData(bad, BOT_TOKEN, [USER_ID], 86400000);
  expect(r.ok).toBe(false);
});

test("validateInitData rejects a non-allowlisted user", () => {
  const r = validateInitData(signedInitData(999, Math.floor(Date.now()/1000)), BOT_TOKEN, [USER_ID], 86400000);
  expect(r.ok).toBe(false);
});

test("validateInitData rejects an expired auth_date", () => {
  const longAgo = Math.floor(Date.now()/1000) - 1000000;
  const r = validateInitData(signedInitData(USER_ID, longAgo), BOT_TOKEN, [USER_ID], 86400000);
  expect(r.ok).toBe(false);
});

test("POST /api/auth/telegram sets a cookie and returns 200", async () => {
  const api = new Api({} as any, freshStore(), fakeRouter(), cfg());
  const res = await api.handle(new Request("http://x/api/auth/telegram", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ initData: signedInitData(USER_ID, Math.floor(Date.now()/1000)) }),
  }));
  expect(res.status).toBe(200);
  expect(res.headers.get("set-cookie")).toContain("tg_hub_sid=");
});

test("ungated GET /api/sessions returns 401 without cookie", async () => {
  const api = new Api({} as any, freshStore(), fakeRouter(), cfg());
  const res = await api.handle(new Request("http://x/api/sessions"));
  expect(res.status).toBe(401);
});

test("with cookie, GET /api/sessions returns derived status list", async () => {
  const store = freshStore();
  store.upsert({ sessionId: "s1", name: "n", cwd: "/c", topicId: 10, status: "online", lastSeen: Date.now(), socketId: "c1", paused: false });
  // brief deviation: bot stub must carry groupId (BotApi.groupId is readonly string); {} as any makes serialize's topicDeepLink throw.
  const api = new Api({ groupId: "-100123" } as any, store, fakeRouter(), cfg());
  const auth = await api.handle(new Request("http://x/api/auth/telegram", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ initData: signedInitData(USER_ID, Math.floor(Date.now()/1000)) }),
  }));
  const cookie = auth.headers.get("set-cookie")!.split(";")[0];
  const res = await api.handle(new Request("http://x/api/sessions", { headers: { cookie } }));
  expect(res.status).toBe(200);
  const list = await res.json();
  expect(list[0].id).toBe("s1");
  expect(list[0].status).toBe("online");
  expect(list[0].deepLink).toContain("t.me/c/");
});

test("POST /api/sessions/:id/stop calls router.stop", async () => {
  const store = freshStore();
  store.upsert({ sessionId: "s1", name: "n", cwd: "/c", topicId: 10, status: "online", lastSeen: Date.now(), socketId: "c1", paused: false });
  let stopped = false;
  const api = new Api({} as any, store, { stop: () => { stopped = true; } } as any, cfg());
  const auth = await api.handle(new Request("http://x/api/auth/telegram", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ initData: signedInitData(USER_ID, Math.floor(Date.now()/1000)) }) }));
  const cookie = auth.headers.get("set-cookie")!.split(";")[0];
  const res = await api.handle(new Request("http://x/api/sessions/s1/stop", { method: "POST", headers: { cookie } }));
  expect(res.status).toBe(200);
  expect(stopped).toBe(true);
});