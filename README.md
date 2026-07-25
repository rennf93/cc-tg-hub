# cc-tg-hub — Telegram Mini App for multiple Claude Code sessions

Each Claude Code session becomes a forum topic you chat with from your phone. One shared bot, one broker daemon (the sole Telegram poller), one MCP per session. Starting a new session never kills the old one.

## Setup (one-time)

1. **Bot + group.** Via @BotFather create a bot. Create a supergroup, enable Topics in group settings, add the bot as admin with "Manage Topics". Get the group id (e.g. from `@raw_data` bot or the API).

2. **Config.** Create `~/.claude/cc-tg-hub/config.json`:
   ```json
   {
     "botToken": "123:abc",
     "groupId": "-1001234567890",
     "allowUserIds": [<your Telegram user id>]
   }
   ```
   Find your user id via @userinfobot.

3. **Install the broker.**
   ```sh
   bun install
   bash scripts/install-launchd.sh
   ```
   Check `~/.claude/cc-tg-hub/logs/broker.err.log`.

4. **Enable the MCP** per-project (copy `.mcp.example.json` to the project as `.mcp.json` with the absolute path) or globally in `~/.claude/settings.json` `mcpServers`.

5. **Use.** Start `claude` in any project. A forum topic appears in the group. Message it from your phone; Claude responds via the `reply` tool.

## Why not the official plugin?

The official Telegram Channels plugin (`telegram@claude-plugins-official`) can only serve one session per bot — each new session SIGTERMs the previous poller (`server.ts:59-69`). cc-tg-hub fixes this with a single-poller broker daemon; sessions register over a UNIX socket and never poll.

## Mini App (Phase 2)

The broker serves an HTTP API on `httpPort` (default 8787) and, when `app/dist`
is present, the built Mini App. In development:

1. Start the broker: `bun run broker` (needs `~/.claude/cc-tg-hub/config.json`
   with bot token, group id, and your Telegram user id in `allowUserIds`).
2. In another terminal: `bun run --cwd app dev` — Vite serves the app on
   http://localhost:5173 and proxies `/api/*` to the broker.
3. Open http://localhost:5173 in a browser. Outside Telegram, the app shows the
   "Open from Telegram" wall in production builds; in dev it falls back to a
   mock bridge so you can see the shell.

Production wiring (deploy step, deferred): build the app (`bun run --cwd app
build`), place `dist/` at the broker's `app-dist` path (or wire a configured
path), expose the broker's `httpPort` over HTTPS via cloudflared, and register
that HTTPS URL as the bot's Mini App URL with BotFather.

## Develop

```sh
bun test              # all unit tests
bun scripts/smoke.ts  # end-to-end multi-session check (mock Telegram)
```