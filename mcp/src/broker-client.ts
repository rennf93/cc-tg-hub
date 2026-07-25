import { connect, type Socket } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import { encodeFrame, parseFrame, type Frame, type MessageFrame, type RegisteredFrame } from "@tg-hub/frames";

const DEFAULT_SOCKET = join(homedir(), ".claude", "tg-hub", "broker.sock");

export class BrokerClient {
  private sock: Socket | null = null;
  private buf = "";
  private onMsg: (f: MessageFrame) => void = () => {};
  private onReg: (f: RegisteredFrame) => void = () => {};
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
    return new Promise((resolve, reject) => {
      const onErr = (e: unknown) => { if (!this.stopped) reject(e); };
      this.buf = "";
      this.sock = connect(this.sockPath);
      this.sock.on("error", onErr);
      this.sock.on("close", () => {
        if (this.stopped) return;
        // Reconnect with backoff; re-register on the new socket.
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
        }
      });
    });
  }

  onMessage(cb: (f: MessageFrame) => void): void { this.onMsg = cb; }
  onRegistered(cb: (f: RegisteredFrame) => void): void { this.onReg = cb; }

  sendReply(chatId: string, text: string, opts: { replyTo?: string; files?: string[]; format?: "text" | "markdownv2" } = {}): void {
    this.sock?.write(encodeFrame({ type: "reply", chatId, text, replyTo: opts.replyTo, files: opts.files, format: opts.format }));
  }

  disconnect(): void {
    this.stopped = true;
    try { this.sock?.write(encodeFrame({ type: "unregister" })); } catch {}
    this.sock?.end();
  }
}