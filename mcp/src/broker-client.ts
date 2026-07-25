import { connect, type Socket } from "node:net";
import { encodeFrame, parseFrame, type Frame, type MessageFrame } from "@tg-hub/frames";

export class BrokerClient {
  private sock: Socket | null = null;
  private buf = "";
  private onMsg: (f: MessageFrame) => void = () => {};
  constructor(private sockPath: string, private sessionId: string, private name: string, private cwd: string) {}

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.sock = connect(this.sockPath);
      this.sock.on("connect", () => {
        this.sock!.write(encodeFrame({ type: "register", sessionId: this.sessionId, name: this.name, cwd: this.cwd }));
        resolve();
      });
      this.sock.on("error", reject);
      this.sock.on("data", (b) => {
        this.buf += b.toString();
        let nl;
        while ((nl = this.buf.indexOf("\n")) >= 0) {
          try { const f = parseFrame(this.buf.slice(0, nl)); if (f.type === "message") this.onMsg(f); } catch {}
          this.buf = this.buf.slice(nl + 1);
        }
      });
    });
  }
  onMessage(cb: (f: MessageFrame) => void) { this.onMsg = cb; }
  async sendReply(chatId: string, text: string) {
    this.sock?.write(encodeFrame({ type: "reply", chatId, text }));
  }
  disconnect() { this.sock?.end(); }
}