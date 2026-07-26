#!/usr/bin/env bun
import { existsSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { STATE_DIR, LOG_DIR, statusBroker, stopBroker } from "./daemon";

const SETTINGS_PATH = join(homedir(), ".claude", "settings.json");

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
spawns brings up the broker if it isn't already running.`;

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

async function uninstall(): Promise<void> {
  const stopped = await stopBroker();
  console.log(stopped ? "✓ broker stopped" : "• broker was not running");
  try { rmSync(STATE_DIR, { recursive: true, force: true }); console.log(`✓ removed ${STATE_DIR}`); }
  catch (e) { console.error(`✗ could not remove ${STATE_DIR}: ${e}`); }
  if (existsSync(SETTINGS_PATH)) {
    try {
      const settings = JSON.parse(readFileSync(SETTINGS_PATH, "utf8"));
      if (settings.mcpServers?.["cc-tg-hub"]) {
        delete settings.mcpServers["cc-tg-hub"];
        writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2) + "\n");
        console.log(`✓ removed cc-tg-hub from ${SETTINGS_PATH}`);
      }
    } catch (e) { console.error(`✗ could not update ${SETTINGS_PATH}: ${e}`); }
  }
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