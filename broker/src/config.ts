import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface Config {
  botToken: string;
  groupId: string;          // supergroup id with topics enabled, e.g. "-1001234567890"
  allowUserIds: number[];    // operator Telegram user IDs
  socketPath: string;        // default ~/.claude/tg-hub/broker.sock
  stateDir: string;          // default ~/.claude/tg-hub
  apiRoot?: string;          // override Bot API root (for tests); defaults to Telegram
  idleMs: number;            // operator idle timeout, default 5min
  authFreshnessMs: number;   // auth window, default 24h
  sessionTtlMs: number;      // session lifetime, default 7d
  httpPort: number;          // HTTP control port, default 8787
  webAppOrigin: string;     // allowed web app origin, default http://localhost:5173
}

export function defaultStateDir(): string {
  return join(homedir(), ".claude", "tg-hub");
}

export function loadConfig(path = join(defaultStateDir(), "config.json")): Config {
  const raw = JSON.parse(readFileSync(path, "utf8"));
  if (typeof raw.botToken !== "string" || !raw.botToken) throw new Error("config: botToken required");
  if (typeof raw.groupId !== "string") throw new Error("config: groupId required");
  if (!Array.isArray(raw.allowUserIds) || !raw.allowUserIds.every((u: unknown) => typeof u === "number"))
    throw new Error("config: allowUserIds must be number[]");
  const stateDir = raw.stateDir ?? defaultStateDir();
  return {
    botToken: raw.botToken,
    groupId: raw.groupId,
    allowUserIds: raw.allowUserIds,
    socketPath: raw.socketPath ?? join(stateDir, "broker.sock"),
    stateDir,
    apiRoot: raw.apiRoot,
    idleMs: raw.idleMs ?? 300000,
    authFreshnessMs: raw.authFreshnessMs ?? 86400000,
    sessionTtlMs: raw.sessionTtlMs ?? 604800000,
    httpPort: raw.httpPort ?? 8787,
    webAppOrigin: raw.webAppOrigin ?? "http://localhost:5173",
  };
}