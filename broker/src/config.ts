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
  };
}