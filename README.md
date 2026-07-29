# cc-tg-hub — Telegram Mini App for multiple Claude Code sessions

Each Claude Code session becomes a forum topic you chat with from your phone. One shared bot, one broker (the sole Telegram poller), one MCP per session. Starting a new session never kills the old one.

## Setup

1. **Telegram, one-time (~2 min, manual):** In [@BotFather](https://t.me/BotFather) run `/newbot` and save the token. Create a supergroup, enable **Topics** in its settings, and add the bot as an admin with **Manage Topics** permission.

2. **Install + configure (one command):**
   ```sh
   bunx cc-tg-hub setup
   ```
   Paste the bot token when prompted, then send any message (e.g. `/start`) in your group. setup detects the group and your user id from that message, writes `~/.claude/cc-tg-hub/config.json`, and wires the MCP into `~/.claude.json` globally — so every `claude` session gets it with no per-project config. It also pre-allows `mcp__cc-tg-hub__reply` in `~/.claude/settings.json` so unattended sessions can reply without a permission prompt; sessions installed before this change need one manual "Yes, and don't ask again" approval on the first reply.

3. **Use:** Launch sessions with `claude --dangerously-load-development-channels server:cc-tg-hub` — an Anthropic research-preview feature (claude ≥ 2.x, requires claude.ai/Console auth, not Bedrock/Vertex) that's needed for inbound Telegram messages to reach Claude at all. Alias it, e.g. `alias claude-tg='claude --dangerously-load-development-channels server:cc-tg-hub'`. **Accept the "Loading development channels" warning at launch** (Enter) — without that the channel never attaches and inbound messages are silently dropped. Verify with `/status`: it should read `Channels: Listening for messages from server:cc-tg-hub`. A forum topic appears in your group; message it from your phone and Claude replies via the `reply` tool.

   > **Known upstream limitation (Claude Code ≤ 2.1.220):** channel messages only render in **fresh** conversations. In a resumed conversation (`--continue`, `--resume`, or the in-app resume picker) the host receives the notifications but silently drops them — verified with a minimal repro. Start a new conversation when you need the Telegram bridge.

The broker starts itself the first time you open `claude` (the MCP claude spawns brings it up as a detached background process) and stays up across sessions. You never start or manage it by hand. If you need to: `cc-tg-hub status` / `cc-tg-hub stop` / `cc-tg-hub logs` / `cc-tg-hub uninstall`.

> No bot token? The setup step is the only place secrets are needed — the token, group id, and your user id all flow from that one paste + one message.

## Upgrading

Installing the new package is **not** enough. The broker and the MCP both execute `~/.claude/cc-tg-hub/cli.js` — a self-contained copy of the bundle that only `setup` refreshes:

```sh
bunx cc-tg-hub@latest setup
```

It stops the running broker, re-copies the bundle, and re-detects your group, so have the bot token to hand and send one message in the group again, exactly as on a first install. Sessions that are already open keep the old MCP until you restart them.

## Why not the official plugin?

The official Telegram Channels plugin (`telegram@claude-plugins-official`) can only serve one session per bot — each new session SIGTERMs the previous poller (`server.ts:59-69`). cc-tg-hub fixes this with a single-poller broker; sessions register over a UNIX socket and never poll. The broker is lazily spawned by the MCP when `claude` starts and shared across all sessions, so there's exactly one poller no matter how many sessions are open.

## Optional: phone sessions UI (Mini App)

The core feature — chatting with your sessions from Telegram — needs no Mini App. The Mini App is an optional sessions-management UI served by the broker's HTTP API on `httpPort` (default 8787).

- **Dev:** `bun run broker` in one terminal, `bun run app` in another (Vite on http://localhost:5173, proxies `/api/*` to the broker). Outside Telegram, production builds show an "Open from Telegram" wall; dev falls back to a mock bridge.
- **Production:** build the app (`bun run app:build`), place `dist/` at `~/.claude/cc-tg-hub/app-dist/`, expose the broker's `httpPort` over HTTPS via cloudflared, and register that HTTPS URL as the bot's Mini App URL with BotFather. Release artifacts (built `app/dist`) are attached to each GitHub release.

## Develop

```sh
bun install
bun test              # all unit tests (shared/broker/mcp/app)
bun scripts/smoke.ts  # end-to-end multi-session check (mock Telegram)
bun run build:cli     # build the published CLI bundle into dist/cli.js
```