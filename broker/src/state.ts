import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

export interface SessionRecord {
  sessionId: string;
  name: string;
  cwd: string;
  topicId: number;
  status: "online" | "idle" | "offline";
  lastSeen: number;
  socketId: string;
}

export class SessionsStore {
  private path: string;
  private byId = new Map<string, SessionRecord>();
  private byTopicId = new Map<number, SessionRecord>();

  constructor(stateDir: string) {
    this.path = join(stateDir, "sessions.json");
    mkdirSync(stateDir, { recursive: true, mode: 0o700 });
    chmodSync(stateDir, 0o700);
    if (existsSync(this.path)) {
      const arr = JSON.parse(readFileSync(this.path, "utf8")) as SessionRecord[];
      for (const r of arr) {
        this.byId.set(r.sessionId, r);
        this.byTopicId.set(r.topicId, r);
      }
    }
  }

  private persist(): void {
    mkdirSync(join(this.path, ".."), { recursive: true, mode: 0o700 });
    writeFileSync(this.path, JSON.stringify([...this.byId.values()], null, 2));
  }

  upsert(r: SessionRecord): void {
    const prev = this.byId.get(r.sessionId);
    if (prev) this.byTopicId.delete(prev.topicId);
    this.byId.set(r.sessionId, r);
    this.byTopicId.set(r.topicId, r);
    this.persist();
  }

  get(sessionId: string): SessionRecord | undefined {
    return this.byId.get(sessionId);
  }

  byTopic(topicId: number): SessionRecord | undefined {
    return this.byTopicId.get(topicId);
  }

  list(): SessionRecord[] {
    return [...this.byId.values()];
  }

  setOffline(sessionId: string): void {
    const r = this.byId.get(sessionId);
    if (!r) return;
    r.status = "offline";
    r.socketId = "";
    this.persist();
  }

  /** Find an existing topic for a (name, cwd) pair, for reuse when sessionId may have changed. */
  reuseKey(name: string, cwd: string): number | undefined {
    for (const r of this.byId.values()) {
      if (r.name === name && r.cwd === cwd) return r.topicId;
    }
    return undefined;
  }
}

/** Stable fallback id when CLAUDE_SESSION_ID is absent. */
export function sessionKeyHash(name: string, cwd: string): string {
  return createHash("sha1").update(`${name}\0${cwd}`).digest("hex").slice(0, 16);
}