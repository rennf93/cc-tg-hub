# tg-hub — Telegram Mini App for multiple Claude Code sessions

Each Claude Code session becomes a forum topic you chat with from your phone. One shared bot, one broker daemon (the sole Telegram poller), one MCP per session. Starting a new session never kills the old one.

## Setup (one-time)

1. **Bot + group.** Via @BotFather create a bot. Create a supergroup, enable Topics in group settings, add the bot as admin with "Manage Topics". Get the group id (e.g. from `@raw_data` bot or the API).

2. **Config.** Create `~/.claude/tg-hub/config.json`:
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
   Check `~/.claude/tg-hub/logs/broker.err.log`.

4. **Enable the MCP** per-project (copy `.mcp.example.json` to the project as `.mcp.json` with the absolute path) or globally in `~/.claude/settings.json` `mcpServers`.

5. **Use.** Start `claude` in any project. A forum topic appears in the group. Message it from your phone; Claude responds via the `reply` tool.

## Why not the official plugin?

The official Telegram Channels plugin (`telegram@claude-plugins-official`) can only serve one session per bot — each new session SIGTERMs the previous poller (`server.ts:59-69`). tg-hub fixes this with a single-poller broker daemon; sessions register over a UNIX socket and never poll.

## Mini App

Phase 2 (separate plan): a Vite/React Mini App porting roboco's `#tg-shell` patterns for session list + management.

## Develop

```sh
bun test              # all unit tests
bun scripts/smoke.ts  # end-to-end multi-session check (mock Telegram)
```