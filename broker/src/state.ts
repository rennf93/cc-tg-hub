import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync } from "node:fs";
import { join } from "node:path";

export interface SessionRecord {
  sessionId: string;
  name: string;
  cwd: string;
  topicId: number;
  status: "online" | "offline" | "stopped";   // idle + paused derived, not stored
  lastSeen: number;
  socketId: string;
  paused: boolean;
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
        if (r.paused === undefined) r.paused = false;
        if (r.status === "idle") r.status = "online";   // legacy: idle is now derived
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
    if (r.status === "stopped") return;      // ponytail: don't downgrade a stopped session
    r.status = "offline";
    r.socketId = "";
    this.persist();
  }

  setPaused(sessionId: string, paused: boolean): void {
    const r = this.byId.get(sessionId);
    if (!r) return;
    r.paused = paused;
    this.persist();
  }

  setStopped(sessionId: string): void {
    const r = this.byId.get(sessionId);
    if (!r) return;
    r.status = "stopped";
    r.paused = false;
    r.socketId = "";
    this.persist();
  }

  rename(sessionId: string, name: string): void {
    const r = this.byId.get(sessionId);
    if (!r) return;
    r.name = name;
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