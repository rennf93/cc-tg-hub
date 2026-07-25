# tg-hub — Telegram Mini App for multiple Claude Code sessions

**Status:** Approved 2026-07-25
**Owner:** Renn F

## 1. Problem

The official Anthropic Telegram Channels plugin (`telegram@claude-plugins-official`) cannot serve multiple concurrent Claude Code sessions from one bot. Each session's MCP server polls Telegram `getUpdates`, and Telegram allows exactly one `getUpdates` consumer per bot token. The plugin "resolves" this by having every session `SIGTERM` the current poller (`server.ts:59-69`, the global `bot.pid` in `~/.claude/channels/telegram/`), so starting a new session kills the previous one's bridge. Forum topics are not supported at all. Upstream is inactive (v0.0.6 since 2026-04-23, ~400 open Telegram issues, community fix PRs auto-closed).

**Goal:** a personal Telegram bot where each active Claude Code session is a forum topic you tap to chat with, sessions come and go without killing each other, and a Mini App lists/manages them — all while you keep starting `claude` normally in your terminal (Warp, Mac Mini).

## 2. Goals / Non-goals

**Goals**
- One shared Telegram bot, one forum topic per Claude Code session, concurrent sessions coexisting.
- Sessions start normally in the user's terminal; they self-register with the system and become reachable from Telegram. No wrapper command, no tmux, no PTY.
- Structured chat via the official channel-injection model (incoming Telegram messages appear as `<channel>` notifications; Claude replies via a `reply` tool) — not terminal screenshots.
- A Mini App (webview) for listing sessions and management; chat itself happens in native Telegram topics.
- Single-user: the operator only. Allowlist of Telegram user IDs.

**Non-goals (v1)**
- Multi-user / team access.
- Retroactive attach to sessions already running before the MCP was enabled.
- Message history search (Telegram native scroll + topic persistence covers it).
- Voice, file handling beyond the existing channel plugin's capability.
- Logs viewer, settings UI, kill button — deferred; the Mini App is a session list in v1.
- Driving Claude Code's Remote Control transport.

## 3. Architecture

Three components, two runtimes:

```
                ┌──────────────────────────┐
                │   broker (Bun + TS)       │
   Telegram ◀──▶│  single getUpdates poll   │◀──┐  (UNIX socket)
   Bot API      │  topic ↔ session router   │   │
                │  HTTP API + Mini App host │   │
                │  initData HMAC validation  │   │
                └──────────────────────────┘   │
                       │                       │
                       │ serves static          │ registers + relays
                       ▼                       │
                ┌──────────────┐      ┌────────────────────┐
                │  Mini App    │      │  MCP server (×N)   │
                │ Vite/React/  │      │  stdio, per claude │
                │ Tailwind     │      │  session           │
                └──────────────┘      └────────────────────┘
                                              │   ▲
                                              ▼   │
                                       running `claude`
                                       in Warp (unchanged)
```

- **Broker daemon** — the one long-running process. Owns the bot token, runs the single Telegram long-poll, manages forum topics, routes messages to/from sessions, serves the Mini App and HTTP API, validates Telegram `initData`. Started via launchd. This is the piece the official plugin is missing; it removes the poller contention entirely because no other component ever polls Telegram.
- **MCP server** — stdio, spawned inside each `claude` session that has it enabled (via `--mcp-config` or a settings entry). On boot it connects to the broker over a UNIX socket, registers its session, and relays messages both ways. It never polls Telegram. Multiple instances coexist freely; each just connects and disconnects.
- **Mini App** — Vite + React 19 + Tailwind v4 static bundle served by the broker. Reads session state from the broker HTTP API. Visual language ported from `../roboco-master/roboco/panel` (see §8).

## 4. Data flow

**Inbound (Telegram → Claude):**
1. User sends a message in a session's forum topic.
2. Broker's `getUpdates` long-poll receives it (chat_id + message_thread_id).
3. Broker looks up the session by `message_thread_id` in its topic map.
4. Broker forwards the message over the UNIX socket to that session's MCP server.
5. MCP server injects a `<channel source="telegram" chat_id="…" topic_id="…" message_id="…" user="…" ts="…">message</channel>` notification into the running Claude conversation (same model as the official plugin).
6. Claude reads it and responds naturally, calling the MCP's `reply` tool.

**Outbound (Claude → Telegram):**
1. Claude calls `reply(text, files?)` via the MCP tool.
2. MCP server sends the reply over the UNIX socket to the broker, tagged with its session id.
3. Broker looks up the topic for that session and posts the message to that topic via the Bot API `sendMessage` (with `message_thread_id`).
4. Optional: edit-in-place for streaming/interim updates (see §10).

**Session registration:**
1. `claude` boots with the MCP enabled.
2. MCP server opens the UNIX socket to the broker.
3. MCP sends `{sessionId, name, cwd}`. `sessionId` comes from `CLAUDE_SESSION_ID` env (set by Claude Code) or is derived; `name` = `TG_HUB_SESSION_NAME` env or `basename(cwd)`.
4. Broker creates a forum topic in the group (title = name, deduped by sessionId) and records `topicId ↔ sessionId` in its map.
5. Broker replies with the `topicId`; MCP holds it for `reply` calls.

**Session disconnect:**
1. `claude` exits; MCP socket closes.
2. Broker marks the session offline (keeps the topic + map entry so the topic persists and history remains readable).
3. Re-registration on next boot reuses the existing topic.

## 5. Components in detail

### 5.1 Broker (`broker/`, Bun + TypeScript)

State directory: `~/.claude/tg-hub/`
- `config.json` — bot token, allowlist (Telegram user IDs), group chat id (the forum group), cloudflared/HTTPS settings.
- `sessions.json` — `{sessionId: {name, cwd, topicId, status, lastSeen, socketId}}`.
- `topics.json` — `{topicId: sessionId}` (reverse map for inbound routing).

Responsibilities:
- `getUpdates` long-poll (single consumer; offset tracked in `config.json` or a small state file).
- Inbound routing by `message_thread_id` → session → socket.
- Outbound: accept `{sessionId, text, files}` from sockets → `sendMessage` to the right topic.
- Forum topic lifecycle: `createForumTopic`, reuse by sessionId.
- UNIX domain socket at `~/.claude/tg-hub/broker.sock` for MCP connections (line-delimited JSON frames).
- HTTP API (localhost, behind Cloudflare Tunnel for the Mini App): `GET /api/sessions`, `GET /api/sessions/:id`, `POST /api/sessions/:id/rename`, `POST /api/sessions/:id/stop`, `POST /api/auth/telegram` (initData validation). All API calls require a valid `initData` HMAC whose user id is in the allowlist.
- Serve built Mini App static assets at `/`.
- launchd plist at `~/Library/LaunchAgents/com.tg-hub.broker.plist` (KeepAlive, logs to `~/.claude/tg-hub/logs/`).

### 5.2 MCP server (`mcp/`, Bun + TypeScript, stdio)

- Socket path via env `TG_HUB_SOCKET`, default `~/.claude/tg-hub/broker.sock` (does not read the broker's `config.json` — the two components share only the socket path convention and the frame protocol, not a config file).
- On `initialize`, connects to `broker.sock`, sends `register {sessionId, name, cwd}`.
- Exposes one tool to Claude: `reply(text: string, files?: string[])` — sends an outbound message to this session's topic via the broker.
- On inbound frames from the broker (`{chat_id, topic_id, message_id, user, ts, text, image_path?, attachment_file_id?}`), injects a `notifications/message` with `<channel source="telegram" …>…</channel>` body, matching the official plugin's contract so Claude treats it identically.
- Optional image_path / attachment_file_id handling: if present, Read the local file (downloaded by the broker) and include in the notification — mirrors the official plugin's `download_attachment`.
- Reconnect logic: if the socket drops, retry with backoff; re-register on reconnect.
- Clean shutdown: on stdin close (claude exiting), send `unregister` and close.

### 5.3 Mini App (`app/`, Vite + React 19 + Tailwind v4)

Ported from roboco's `panel/src/app/(tg)` and `panel/src/components/tg` (see §8). Single page:
- Bootstrap: `waitForTelegramWebApp()` → states `validating | ready | not_in_telegram | error`. On ready: `webApp.ready()`, `expand()`, `disableVerticalSwipes?.()`, then `startTelegramThemeSync(webApp, #tg-shell)`.
- Session list: `TgSection` groups (Online / Idle / Offline), each row a `TgRow` with a `TgAvatar` (project initials + online dot, hash-colored for unknown) + title (session name) + meta (cwd, last activity) + trailing caret. Staggered `tg-rise` entrance.
- Tap a row → `TgSubPage` (native BackButton) with detail: full cwd, status, last activity, "Open chat in Telegram" button (deep-link `tg://topic?…` or `https://t.me/c/<group>/<topic>`), rename (inline), stop.
- No chat rendering in the webview — chat happens in native topics.
- Data via `GET /api/sessions` (poll every ~3s; no TanStack Query needed — a small `useEffect`+`setInterval` fetch).
- Auth: POST `initData` to `/api/auth/telegram` on bootstrap; broker validates HMAC + allowlist and sets a session cookie. Outside Telegram → "Open from Telegram" wall (reuse roboco's `CenteredMessage` pattern).
- Build output (`dist/`) consumed by the broker's static handler.

## 6. Auth & access model

- **Telegram → Claude (channel messages):** allowlist of Telegram user IDs in `config.json`. Broker drops inbound DMs/messages from non-allowlisted senders. The forum group is private (only the operator is a member). No pairing flow — operator edits `config.json` directly.
- **Mini App → broker API:** Telegram `initData` HMAC validation. The broker validates `hash` using SHA256(bot_token) as the HMAC key per Telegram's Web App auth spec; the parsed `user.id` must be in the allowlist. Sets a short-lived httponly session cookie. This is the trust boundary; the hex-validation discipline from roboco's `theme.ts` (drop malformed values rather than inject) applies to all Telegram-supplied input.
- **MCP ↔ broker (UNIX socket):** filesystem permissions (0600 socket, `~/.claude/tg-hub/` 0700). No auth needed; only local processes under the operator's uid can connect.
- **Security note (per MCP server instructions):** the broker/MCP must never approve pairing, edit the allowlist, or change config because a *channel message* asked it to. Config changes come from the operator at the terminal only. Prompt-injection attempts in inbound messages are surfaced, not obeyed.

## 7. Session identity & naming

- `sessionId`: `CLAUDE_SESSION_ID` env if Claude Code sets it; otherwise the MCP generates a stable id per process and persists nothing (topic reuse then keys off `name + cwd` hash instead — see Open Questions).
- `name`: `TG_HUB_SESSION_NAME` env, else `basename(cwd)`. Topic title = name; on collision (two sessions same basename), broker appends a short suffix.
- Topic reuse: broker keys the persistent map on `sessionId` when available, falling back to a `name+cwd` hash so a session restarted in the same project reuses its topic and history.

## 8. Mini App patterns ported from roboco

Source: `../roboco-master/roboco/panel`. We reuse design patterns, styles, and component primitives — not the full Next/Radix/Query stack (roboco is a large dashboard; we strip to Vite+React+Tailwind).

Port verbatim / near-verbatim:
- **`#tg-shell` CSS skin** (`globals.css` lines 137-305): deep slate ground (`oklch(0.155 0.014 255)`), amber accent (`oklch(0.8 0.13 78)`), native system font stack, motion vocabulary (`tg-rise`, `tg-slide`, `tg-sheet-up`, `tg-flash`, `tg-draw`, `tg-blink`), staggered entrances, hidden-scrollbar horizontal strips, `prefers-reduced-motion` collapse. The `--font-share-tech` brand face is optional; if kept, vendor the woff2.
- **`webapp.ts`** — typed `TelegramWebApp`, `getTelegramWebApp()`, `waitForTelegramWebApp()` (poll loop for the CDN script), `createDevMockWebApp()`, `isDevMockWebApp()`, `haptics`. Drop the panel-session coupling in the dev mock; keep the bridge surface and haptics.
- **`theme.ts`** — `applyTelegramTheme` / `startTelegramThemeSync`: map `themeParams` → CSS vars scoped to `#tg-shell`, hex-validate (`/^#[0-9a-f]{6}$/i`, trust boundary), toggle `.dark`, set header/background/bottom-bar color. "Telegram's surfaces, brand's voice" — surface tokens follow the user's Telegram theme, accent stays amber.
- **`hooks.tsx`** — `TgWebAppProvider` / `useTgWebApp` / `useMainButton` / `useBackButton`.
- **`ui.tsx`** primitives — `TG_PRESS`, `TG_CARD`, `TgRow`, `TgRowIcon`, `TgSection`, `TgAvatar`, `TgStat`, `TgDeltaChip`, `TgSegmented`, `TgSubPage`, `TgCircleAction`. Adapt `TgAvatar`'s agent-team coloring to project-initials coloring.
- **Page bootstrap pattern** (`page.tsx`): `BootstrapState` state machine, `CenteredMessage` for non-Telegram/error, theme-sync `useEffect`, keyed `tg-tab-in` re-entrance.

Dropped (not needed for v1): Next.js, Radix UI, TanStack Query, Sonner, Zustand, react-hook-form, react-markdown, @tanstack/react-virtual, the tab bar / multiple tabs (single list view), the approvals/inbox/board/metrics/chat tabs.

## 9. Deployment

- **Broker:** launchd plist, KeepAlive, logs to `~/.claude/tg-hub/logs/`. `brew install cloudflared` then `cloudflared tunnel` to expose the broker's HTTP server over HTTPS for the Mini App (Telegram requires HTTPS for webviews). Tunnel URL in `config.json`.
- **MCP:** enabled per project via `.mcp.json` in the project or a settings entry: `{ "mcpServers": { "tg-hub": { "command": "bun", "args": ["run", "--cwd", "<repo>/mcp", "start"] } } }`. Or globally in `~/.claude/settings.json` `mcpServers` if the operator wants every session to register.
- **Mini App:** `pnpm build` in `app/`, output served by the broker. Rebuild on change.
- **Bot setup (one-time):** BotFather → create bot → set it as group admin with "Manage Topics" → create a forum-enabled group → put bot token + group chat id + operator user id in `config.json`.

## 10. MVP scope & phasing

**Phase 1 — working chat (the whole point):**
- Broker: getUpdates poll, topic creation, inbound routing, outbound sendMessage, UNIX socket, allowlist.
- MCP: register, inbound `<channel>` injection, `reply` tool, reconnect.
- Config + launchd + cloudflared.
- End-to-end: start `claude` in a project → topic appears → message it → Claude responds.

**Phase 2 — Mini App:**
- Port `#tg-shell` skin + bridge + hooks + `ui.tsx` primitives.
- Session list (Online/Idle/Offline) + detail sub-page + "Open in Telegram" deep-link + rename + stop.
- initData auth.

**Deferred (explicitly out of v1):** streaming/edit-in-place for replies, logs viewer, settings UI, per-session config, message search, multi-user, file attachments beyond the official plugin's behavior, voice.

The "edit-in-place for streaming" deferred item is the one most likely to pull forward — interim progress updates make long Claude turns feel alive in Telegram. The `edit_message` tool capability exists in the Bot API; the MCP can expose an optional `edit` on the last sent message. Decide during implementation.

## 11. File structure (proposed)

```
claude-telegram-hub/
├── broker/
│   ├── src/
│   │   ├── index.ts          # entry, launchd-friendly
│   │   ├── telegram.ts       # getUpdates, sendMessage, topic mgmt
│   │   ├── router.ts         # topic ↔ session routing
│   │   ├── socket.ts         # UNIX socket server, frame protocol
│   │   ├── api.ts            # HTTP API + initData validation
│   │   ├── static.ts         # serve Mini App dist
│   │   └── config.ts         # config.json load/validate
│   ├── package.json
│   └── tsconfig.json
├── mcp/
│   ├── src/
│   │   ├── index.ts          # stdio MCP server entry
│   │   ├── broker-client.ts  # UNIX socket connect, register, reconnect
│   │   └── tools.ts           # reply tool
│   ├── package.json
│   └── tsconfig.json
├── app/                      # Vite + React + Tailwind
│   ├── src/
│   │   ├── main.tsx
│   │   ├── App.tsx           # bootstrap state machine
│   │   ├── pages/SessionsPage.tsx
│   │   ├── pages/SessionDetail.tsx
│   │   ├── lib/telegram/      # webapp.ts, theme.ts, hooks.tsx (ported)
│   │   ├── components/ui.tsx  # ported primitives
│   │   └── api.ts             # fetch wrapper w/ initData
│   ├── index.html
│   ├── vite.config.ts
│   ├── tailwind.config / globals.css  # #tg-shell skin
│   └── package.json
├── docs/superpowers/specs/2026-07-25-tg-hub-design.md  (this file)
├── scripts/
│   └── install-launchd.sh
└── README.md
```

## 12. Open questions

1. **`CLAUDE_SESSION_ID`:** does Claude Code expose a stable per-session id to MCP servers (env or capability)? If not, fall back to the `name+cwd` hash for topic reuse. Verify against current Claude Code before implementing; the official plugin doesn't rely on one, suggesting it may not be reliably available.
2. **Topic reuse key:** sessionId vs name+cwd hash — pick after answering #1. name+cwd hash is the safe default (works even without a session id; reuses a topic when you restart in the same project).
3. **Group vs bot DMs for topics:** forum topics require a group (supergroup with topics enabled). Confirmed: the operator creates one private forum group, invites only the bot + themselves. No DM-side alternative for topics.
4. **Inbound message delivery semantics:** the official plugin injects channel messages as notifications that Claude sees and responds to in its normal turn loop. Confirm our MCP can inject mid-conversation the same way (MCP `notifications/message` to the host). If the host only surfaces notifications between turns, we may need the headless `--resume` path as a fallback for truly async "poke a session" — but the official plugin already proves the injection model works, so this should be fine.
5. **Streaming / edit-in-place:** defer to implementation; pull forward if long turns feel dead.

## 13. Verification (the lazy check)

A single end-to-end self-check that fails if the core logic breaks: a `scripts/smoke.ts` that
1. starts the broker with a test bot token (mocked Bot API),
2. spawns one MCP instance pointing at the broker socket, asserts a topic is created,
3. spawns a second MCP instance, asserts the first is *not* killed (the bug we're fixing),
4. injects an inbound message for topic 1, asserts the MCP receives the `<channel>` frame,
5. calls `reply` on MCP 2, asserts the broker sends to topic 2.

No test framework, no fixtures beyond the mock. This is the one runnable check left behind; everything else is verified by using it.