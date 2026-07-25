import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, chmodSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { BotApi } from "./telegram";
import type { SessionsStore, SessionRecord } from "./state";
import type { Router } from "./router";
import type { Config } from "./config";

export interface ValidateResult { ok: boolean; userId?: number; chatId?: string }

/** Validate Telegram WebApp initData per the Web App auth spec.
 * secret = HMAC-SHA256("WebAppData", bot_token); hash = HMAC-SHA256(secret, data_check_string). */
export function validateInitData(
  initData: string,
  botToken: string,
  allowUserIds: number[],
  freshnessMs: number,
): ValidateResult {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return { ok: false };
  params.delete("hash");
  const dataCheck = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join("\n");
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const expected = createHmac("sha256", secret).update(dataCheck).digest("hex");
  const a = Buffer.from(hash, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false };
  let user: { id?: unknown } = {};
  try { user = JSON.parse(params.get("user") ?? "{}"); } catch { return { ok: false }; }
  const uid = Number(user.id);
  if (!Number.isFinite(uid) || !allowUserIds.includes(uid)) return { ok: false };
  const authDate = Number(params.get("auth_date") ?? 0);
  if (authDate * 1000 < Date.now() - freshnessMs) return { ok: false };
  const chatId = params.get("chat_id") ?? undefined;
  return { ok: true, userId: uid, chatId };
}

function humanize(ms: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/** Deep link to a topic in a private supergroup: t.me/c/<internal>/<topic>. */
function topicDeepLink(groupId: string, topicId: number): string {
  // groupId like "-1001234567890" -> internal "1234567890"
  const internal = groupId.startsWith("-100") ? groupId.slice(4) : groupId.replace(/^-/, "");
  return `https://t.me/c/${internal}/${topicId}`;
}

interface CookieSession { userId: number; chatId?: string; expiresAt: number }

export class Api {
  private bot: BotApi;
  private store: SessionsStore;
  private router: Router;
  private config: Config;
  private sessions = new Map<string, CookieSession>();
  private sessionsPath: string;

  constructor(bot: BotApi, store: SessionsStore, router: Router, config: Config) {
    this.bot = bot;
    this.store = store;
    this.router = router;
    this.config = config;
    this.sessionsPath = join(config.stateDir, "sessions-cookies.json");
    this.loadSessions();
  }

  private loadSessions(): void {
    mkdirSync(this.config.stateDir, { recursive: true, mode: 0o700 });
    if (existsSync(this.sessionsPath)) {
      try {
        const arr = JSON.parse(readFileSync(this.sessionsPath, "utf8")) as [string, CookieSession][];
        const now = Date.now();
        for (const [k, v] of arr) if (v.expiresAt > now) this.sessions.set(k, v);
      } catch { /* ponytail: corrupt cookie store — start empty */ }
    }
  }

  private persistSessions(): void {
    writeFileSync(this.sessionsPath, JSON.stringify([...this.sessions.entries()], null, 2));
    try { chmodSync(this.sessionsPath, 0o600); } catch {}
  }

  private deriveStatus(r: SessionRecord): "online" | "idle" | "paused" | "offline" | "stopped" {
    if (r.status === "stopped") return "stopped";
    if (r.paused) return "paused";
    if (r.status === "offline") return "offline";
    // online socket: idle if quiet past idleMs
    return Date.now() - r.lastSeen > this.config.idleMs ? "idle" : "online";
  }

  private serialize(r: SessionRecord) {
    return {
      id: r.sessionId,
      name: r.name,
      cwd: r.cwd,
      topicId: r.topicId,
      status: this.deriveStatus(r),
      paused: r.paused,
      lastSeen: r.lastSeen,
      lastActivity: humanize(r.lastSeen),
      deepLink: topicDeepLink(this.bot.groupId, r.topicId),
    };
  }

  private cookieOf(req: Request): string | undefined {
    const c = req.headers.get("cookie") ?? "";
    const m = c.match(/(?:^|;\s*)tg_hub_sid=([^;]+)/);
    return m ? m[1] : undefined;
  }

  private isAuthed(req: Request): boolean {
    const sid = this.cookieOf(req);
    if (!sid) return false;
    const s = this.sessions.get(sid);
    if (!s) return false;
    if (s.expiresAt < Date.now()) { this.sessions.delete(sid); return false; }
    return true;
  }

  async handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;
    const cors = {
      "Access-Control-Allow-Origin": this.config.webAppOrigin,
      "Access-Control-Allow-Credentials": "true",
      "Access-Control-Allow-Headers": "content-type",
      "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
    };
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    const sendCors = (body: unknown, init: ResponseInit = {}) =>
      new Response(JSON.stringify(body), { ...init, headers: { "content-type": "application/json", ...cors, ...(init.headers ?? {}) } });

    if (path === "/api/auth/telegram" && req.method === "POST") {
      const body = await req.json().catch(() => ({})) as { initData?: string };
      return this.handleAuth(body.initData ?? "", cors, sendCors);
    }

    // All other /api routes require a cookie.
    if (path.startsWith("/api/")) {
      if (!this.isAuthed(req)) return sendCors({ error: "unauthorized" }, { status: 401 });

      const mList = path === "/api/sessions" && req.method === "GET";
      if (mList) return sendCors(this.store.list().map((r) => this.serialize(r)));

      const mOne = path.match(/^\/api\/sessions\/([^/]+)$/);
      if (mOne) {
        const r = this.store.get(mOne[1]);
        if (!r) return sendCors({ error: "not found" }, { status: 404 });
        if (req.method === "GET") return sendCors(this.serialize(r));
        if (req.method === "PATCH") return this.handleRename(r, req, sendCors);
      }

      const mPause = path.match(/^\/api\/sessions\/([^/]+)\/pause$/) && req.method === "POST";
      if (mPause) { const id = path.match(/^\/api\/sessions\/([^/]+)\/pause$/)![1]; this.store.setPaused(id, true); return sendCors({ ok: true, paused: true }); }

      const mResume = path.match(/^\/api\/sessions\/([^/]+)\/resume$/) && req.method === "POST";
      if (mResume) { const id = path.match(/^\/api\/sessions\/([^/]+)\/resume$/)![1]; this.store.setPaused(id, false); return sendCors({ ok: true, paused: false }); }

      const mStop = path.match(/^\/api\/sessions\/([^/]+)\/stop$/) && req.method === "POST";
      if (mStop) { const id = path.match(/^\/api\/sessions\/([^/]+)\/stop$/)![1]; this.router.stop(id); return sendCors({ ok: true, status: "stopped" }); }

      return sendCors({ error: "not found" }, { status: 404 });
    }
    return sendCors({ error: "not found" }, { status: 404 });
  }

  private async handleAuth(initData: string, cors: Record<string, string>, sendCors: (b: unknown, i?: ResponseInit) => Response): Promise<Response> {
    const r = validateInitData(initData, this.config.botToken, this.config.allowUserIds, this.config.authFreshnessMs);
    if (!r.ok || r.userId === undefined) return sendCors({ error: "invalid auth" }, { status: 401, headers: cors } as ResponseInit);
    const sid = randomBytes(24).toString("hex");
    this.sessions.set(sid, { userId: r.userId, chatId: r.chatId, expiresAt: Date.now() + this.config.sessionTtlMs });
    this.persistSessions();
    const cookie = `tg_hub_sid=${sid}; HttpOnly; Path=/; Max-Age=${Math.floor(this.config.sessionTtlMs / 1000)}; SameSite=Lax`;
    return new Response(JSON.stringify({ ok: true, user: { id: r.userId } }), {
      status: 200, headers: { "content-type": "application/json", "set-cookie": cookie, ...cors },
    });
  }

  private async handleRename(r: SessionRecord, req: Request, sendCors: (b: unknown, i?: ResponseInit) => Response): Promise<Response> {
    const body = await req.json().catch(() => ({})) as { name?: string };
    const name = (body.name ?? "").trim();
    if (!name || name.length > 128) return sendCors({ error: "invalid name" }, { status: 400 });
    this.store.rename(r.sessionId, name);
    try {
      await this.bot.editForumTopicTitle(r.topicId, name);
    } catch (e) {
      process.stderr.write(`editForumTopicTitle: ${e}\n`);
      return sendCors({ ok: true, warning: "topic title not synced" });
    }
    return sendCors({ ok: true });
  }
}