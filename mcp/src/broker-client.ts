import { connect, type Socket } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { encodeFrame, parseFrame, type Frame, type MessageFrame, type RegisteredFrame } from "@cc-tg-hub/frames";

const DEFAULT_SOCKET = join(homedir(), ".claude", "cc-tg-hub", "broker.sock");
const PID_PATH = join(homedir(), ".claude", "cc-tg-hub", "broker.pid");

function readPid(): number | undefined {
  if (!existsSync(PID_PATH)) return undefined;
  const pid = Number(readFileSync(PID_PATH, "utf8").trim());
  return Number.isFinite(pid) && pid > 0 ? pid : undefined;
}

function isRunning(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

// Resolve the broker entry point. When this file is bundled into dist/cli.js
// (installed via bunx), import.meta.dir is <pkgRoot>/dist and the broker runs as
// `bun dist/cli.js broker`. In a dev worktree, fall back to the broker source.
function brokerEntry(): string {
  const here = import.meta.dir;
  const candidates = [
    join(here, "cli.js"),                          // bundled: <pkgRoot>/dist/cli.js
    join(here, "..", "..", "dist", "cli.js"),      // dev: <repo>/dist/cli.js (built)
    join(here, "..", "..", "broker", "src", "index.ts"), // dev: broker from source
  ];
  return candidates.find((p) => existsSync(p)) ?? candidates[2];
}

function spawnBroker(): void {
  // Shell-background + reparent-to-init: `sh -c 'bun … broker &'` exits
  // immediately, leaving the broker as init's child, fully decoupled from the
  // MCP/claude lifecycle. (Bun's `detached: true` does NOT survive parent exit
  // on macOS; this does, and works on Linux too.)
  const entry = brokerEntry();
  Bun.spawn({
    cmd: ["sh", "-c", `bun "${entry}" broker >/dev/null 2>&1 &`],
    stdio: ["ignore", "ignore", "ignore"],
    env: { ...process.env, CC_TG_HUB_DAEMON: "1" },
  });
}

function probeSocket(sockPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const s = connect(sockPath, () => { s.end(); resolve(true); });
    s.on("error", () => resolve(false));
  });
}

function waitForSocket(sockPath: string, ms: number): Promise<boolean> {
  const start = Date.now();
  return (function loop(): Promise<boolean> {
    if (existsSync(sockPath)) return probeSocket(sockPath).then((ok) => ok ? true : (Date.now() - start > ms ? false : loop()));
    return Date.now() - start > ms ? Promise.resolve(false) : new Promise((r) => setTimeout(() => r(loop()), 100));
  })();
}

export class BrokerClient {
  private sock: Socket | null = null;
  private buf = "";
  private onMsg: (f: MessageFrame) => void = () => {};
  private onReg: (f: RegisteredFrame) => void = () => {};
  private onStoppedCb: () => void = () => {};
  private stopped = false;
  private sockPath: string;
  private sessionId: string;
  private name: string;
  private cwd: string;

  constructor(sockPath = process.env.TG_HUB_SOCKET ?? DEFAULT_SOCKET, sessionId: string, name: string, cwd: string) {
    this.sockPath = sockPath;
    this.sessionId = sessionId;
    this.name = name;
    this.cwd = cwd;
  }

  connect(): Promise<void> {
    // First attempt: if the broker isn't up, spawn it (detached) and retry once.
    return this.connectOnce().catch((e) => {
      if (this.stopped) throw e;
      return this.ensureBroker().then(() => this.connectOnce());
    });
  }

  private async ensureBroker(): Promise<void> {
    if (await probeSocket(this.sockPath)) return;
    // Another MCP may have just spawned a broker that's still binding. If its
    // pidfile is live, don't spawn a duplicate — just wait for the socket.
    const pid = readPid();
    if (pid && isRunning(pid)) { await waitForSocket(this.sockPath, 8000); return; }
    if (existsSync(this.sockPath)) { try { unlinkSync(this.sockPath); } catch {} }
    spawnBroker();
    await waitForSocket(this.sockPath, 8000);
  }

  private connectOnce(): Promise<void> {
    return new Promise((resolve, reject) => {
      const onErr = (e: unknown) => { if (!this.stopped) reject(e); };
      this.buf = "";
      this.sock = connect(this.sockPath);
      this.sock.on("error", onErr);
      this.sock.on("close", () => {
        if (this.stopped) return;
        // Reconnect with backoff; re-register on the new socket. ensureBroker
        // respawns the broker if it has died.
        setTimeout(() => { if (!this.stopped) void this.connect().catch(() => {}); }, 1000);
      });
      this.sock.on("connect", () => {
        this.sock!.write(encodeFrame({ type: "register", sessionId: this.sessionId, name: this.name, cwd: this.cwd }));
        resolve();
      });
      this.sock.on("data", (b) => {
        this.buf += b.toString();
        let nl;
        while ((nl = this.buf.indexOf("\n")) >= 0) {
          let f: Frame;
          try { f = parseFrame(this.buf.slice(0, nl)); } catch { this.buf = this.buf.slice(nl + 1); continue; }
          this.buf = this.buf.slice(nl + 1);
          if (f.type === "message") this.onMsg(f);
          else if (f.type === "registered") this.onReg(f);
          else if (f.type === "stop") { this.onStoppedCb(); this.disconnect(); }
        }
      });
    });
  }

  onMessage(cb: (f: MessageFrame) => void): void { this.onMsg = cb; }
  onRegistered(cb: (f: RegisteredFrame) => void): void { this.onReg = cb; }
  onStopped(cb: () => void): void { this.onStoppedCb = cb; }

  sendReply(chatId: string, text: string, opts: { replyTo?: string; files?: string[]; format?: "text" | "markdownv2" } = {}): void {
    this.sock?.write(encodeFrame({ type: "reply", chatId, text, replyTo: opts.replyTo, files: opts.files, format: opts.format }));
  }

  disconnect(): void {
    this.stopped = true;
    try { this.sock?.write(encodeFrame({ type: "unregister" })); } catch {}
    this.sock?.end();
  }
}