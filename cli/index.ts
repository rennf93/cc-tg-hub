#!/usr/bin/env bun
import { existsSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { STATE_DIR, LOG_DIR, MCP_CONFIG_PATH, PERMISSIONS_PATH, REPLY_TOOL, statusBroker, stopBroker } from "./daemon";

const HELP = `cc-tg-hub — Telegram Mini App for multiple Claude Code sessions

Usage: cc-tg-hub <command>

Commands:
  setup        One-time install: paste your bot token, send a message in your
               group, and cc-tg-hub configures itself + wires the MCP globally.
  status       Show whether the broker daemon is running.
  stop         Stop the broker daemon (it auto-starts next time you run claude).
  logs         Print the broker's recent log output.
  uninstall    Stop the broker, remove config/state, and un-wire the MCP.

  broker       Run the broker in the foreground (used internally; spawned by
               the MCP when claude starts).
  mcp          Run the MCP server (used internally; spawned by claude).

Running \`claude\` in any project is what activates cc-tg-hub — the MCP it
spawns brings up the broker if it isn't already running.

Inbound messages additionally need the channels flag; without it the bridge
can send but never receive:

  claude --dangerously-load-development-channels server:cc-tg-hub

Accept the warning it shows at launch, and check \`/status\` reads
"Channels: Listening for messages from server:cc-tg-hub".`;

async function logs(): Promise<void> {
  if (!existsSync(LOG_DIR)) { console.log("no logs yet (broker has not run as a daemon)"); return; }
  let any = false;
  for (const name of ["broker.err.log", "broker.out.log"]) {
    const p = join(LOG_DIR, name);
    if (!existsSync(p)) continue;
    const txt = readFileSync(p, "utf8");
    if (!txt.trim()) continue;
    any = true;
    console.log(`=== ${p} (last 100 lines) ===`);
    console.log(txt.split("\n").slice(-100).join("\n"));
  }
  if (!any) console.log("(logs are empty)");
}

/** Read-modify-write a JSON file, skipping it if absent and writing only when edit() reports a change. */
function editJson(path: string, edit: (o: any) => boolean): void {
  if (!existsSync(path)) return;
  try {
    const o = JSON.parse(readFileSync(path, "utf8"));
    if (!edit(o)) return;
    writeFileSync(path, JSON.stringify(o, null, 2) + "\n");
  } catch (e) { console.error(`✗ could not update ${path}: ${e}`); }
}

async function uninstall(): Promise<void> {
  const stopped = await stopBroker();
  console.log(stopped ? "✓ broker stopped" : "• broker was not running");
  try { rmSync(STATE_DIR, { recursive: true, force: true }); console.log(`✓ removed ${STATE_DIR}`); }
  catch (e) { console.error(`✗ could not remove ${STATE_DIR}: ${e}`); }
  // Unwind both files setup writes. Their paths come from daemon.ts so this can
  // never again target a file setup stopped using.
  editJson(MCP_CONFIG_PATH, (o) => {
    if (!o.mcpServers?.["cc-tg-hub"]) return false;
    delete o.mcpServers["cc-tg-hub"];
    console.log(`✓ removed cc-tg-hub from ${MCP_CONFIG_PATH}`);
    return true;
  });
  editJson(PERMISSIONS_PATH, (o) => {
    const allow: string[] | undefined = o.permissions?.allow;
    const i = allow?.indexOf(REPLY_TOOL) ?? -1;
    if (i < 0) return false;
    allow!.splice(i, 1);
    console.log(`✓ removed ${REPLY_TOOL} from ${PERMISSIONS_PATH}`);
    return true;
  });
  console.log("Uninstalled. (The npm package is still installed — `bun remove -g cc-tg-hub` to remove it.)");
}

async function main(): Promise<void> {
  const cmd = process.argv[2] ?? "setup";
  switch (cmd) {
    case "setup": {
      const { setup } = await import("./setup.ts");
      await setup();
      return;
    }
    case "broker":
      await import("../broker/src/index.ts");
      return;
    case "mcp":
      await import("../mcp/src/index.ts");
      return;
    case "status": {
      const s = statusBroker();
      console.log(s.running ? `broker running (pid ${s.pid})` : "broker not running");
      return;
    }
    case "stop": {
      const stopped = await stopBroker();
      console.log(stopped ? "✓ broker stopped" : "• broker was not running");
      return;
    }
    case "logs":
      await logs();
      return;
    case "uninstall":
      await uninstall();
      return;
    case "--help":
    case "-h":
    case "help":
      console.log(HELP);
      return;
    default:
      console.error(`unknown command: ${cmd}\n`);
      console.log(HELP);
      process.exit(1);
  }
}

void main().catch((e) => { console.error(`cc-tg-hub: ${e}`); process.exit(1); });