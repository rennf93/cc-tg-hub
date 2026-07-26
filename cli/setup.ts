import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { STATE_DIR, CONFIG_PATH, stopBroker } from "./daemon";

const API = "https://api.telegram.org";
const SETTINGS_PATH = join(homedir(), ".claude", "settings.json");
const CTRL_C = "\u0003";
const DEL = "\u007f";

async function tg(token: string, method: string, form: Record<string, string> = {}): Promise<any> {
  const body = new FormData();
  for (const [k, v] of Object.entries(form)) if (v !== undefined && v !== null) body.append(k, v);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 35000);
  try {
    const res = await fetch(`${API}/bot${token}/${method}`, { method: "POST", body, signal: ctrl.signal });
    const json = await res.json() as any;
    if (!json.ok) throw new Error(json.description ?? JSON.stringify(json));
    return json.result;
  } finally { clearTimeout(t); }
}

async function readHidden(msg: string): Promise<string> {
  process.stdout.write(msg);
  if (!process.stdin.isTTY) return (prompt("") ?? "");
  return new Promise((resolve) => {
    let input = "";
    const cleanup = () => {
      process.stdin.pause();
      try { (process.stdin as any).setRawMode(false); } catch {}
      process.stdin.removeListener("data", onData);
    };
    const onData = (chunk: Buffer) => {
      for (const ch of chunk.toString()) {
        if (ch === "\r" || ch === "\n") { cleanup(); process.stdout.write("\n"); resolve(input.trim()); return; }
        if (ch === CTRL_C) { cleanup(); process.exit(0); }
        if (ch === DEL || ch === "\b") { if (input.length) input = input.slice(0, -1); continue; }
        input += ch;
      }
    };
    try { (process.stdin as any).setRawMode(true); } catch {}
    process.stdin.resume();
    try { (process.stdin as any).setEncoding("utf8"); } catch {}
    process.stdin.on("data", onData);
  });
}

function fail(msg: string): never { console.error(`✗ ${msg}`); process.exit(1); }
function ok(msg: string): void { console.log(`✓ ${msg}`); }

export async function setup(): Promise<void> {
  const token = (await readHidden("Bot token: ")).trim();
  if (!/^\d+:[\w-]+$/.test(token)) fail("invalid token format (expected `123:abc-DEF`)");
  const me = await tg(token, "getMe").catch((e) => fail(`getMe failed: ${e}`));
  ok(`token valid — bot is @${me.username}`);

  await stopBroker();
  console.log("\nNow in Telegram:");
  console.log(`  1. Add @${me.username} to a supergroup`);
  console.log("  2. Enable Topics in the group's settings");
  console.log("  3. Make the bot an admin with Manage Topics permission");
  console.log("  4. Send any message (e.g. /start) in that group");
  prompt("\nPress Enter once you've sent the message… ");

  let offset = 0;
  let found: { chatId: string; title: string; userId: number } | undefined;
  while (!found) {
    const updates: any[] = await tg(token, "getUpdates", {
      offset: String(offset),
      timeout: "30",
      allowed_updates: '["message"]',
    }).catch((e) => fail(`getUpdates failed: ${e}`));
    if (updates.length === 0) continue;
    for (const u of updates) {
      offset = Math.max(offset, u.update_id + 1);
      const m = u.message;
      if (!m) continue;
      if (m.chat?.type === "supergroup" || m.chat?.type === "group") {
        const chat = await tg(token, "getChat", { chat_id: String(m.chat.id) }).catch((e) => fail(`getChat failed: ${e}`));
        if (!chat.is_forum) fail(`group "${chat.title}" doesn't have Topics enabled — enable Topics in its settings and re-run \`cc-tg-hub setup\``);
        found = { chatId: String(m.chat.id), title: chat.title, userId: m.from.id };
      }
    }
  }

  ok(`detected group "${found.title}" (id ${found.chatId})`);
  ok(`your Telegram user id: ${found.userId}`);
  const ans = (prompt("Use these? [Y/n] ") ?? "").trim().toLowerCase();
  if (ans && ans !== "y") { console.log("aborted; no changes written"); process.exit(0); }

  mkdirSync(STATE_DIR, { recursive: true });
  const config = { botToken: token, groupId: found.chatId, allowUserIds: [found.userId] };
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n");
  try { chmodSync(CONFIG_PATH, 0o600); } catch {}
  ok(`wrote ${CONFIG_PATH}`);

  const pkgRoot = join(import.meta.dir, "..");
  const cliJs = join(pkgRoot, "dist", "cli.js");
  const mcpEntry = existsSync(cliJs)
    ? { command: "bun", args: [cliJs, "mcp"] }
    : { command: "bun", args: [join(pkgRoot, "mcp", "src", "index.ts")] };

  let settings: any = {};
  if (existsSync(SETTINGS_PATH)) {
    try { settings = JSON.parse(readFileSync(SETTINGS_PATH, "utf8")); } catch { settings = {}; }
  }
  settings.mcpServers ??= {};
  settings.mcpServers["cc-tg-hub"] = mcpEntry;
  mkdirSync(join(homedir(), ".claude"), { recursive: true });
  writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2) + "\n");
  ok(`wired MCP into ${SETTINGS_PATH}`);

  console.log("\nDone. Run `claude` in any project — a forum topic appears in your");
  console.log("group; message it from your phone and Claude replies via the `reply` tool.");
  console.log("\nThe broker starts itself the first time you open `claude` and stays up.");
  console.log("Manage it: cc-tg-hub status | stop | logs | uninstall");
}