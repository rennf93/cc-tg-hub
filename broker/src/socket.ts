import { createServer as createNetServer, type Socket } from "node:net";
import { mkdirSync, rmSync, chmodSync } from "node:fs";
import { dirname } from "node:path";
import { encodeFrame, parseFrame, type Frame } from "@cc-tg-hub/frames";

export type FrameHandler = (socketId: string, frame: Frame) => Promise<void>;

export class SocketServer {
  private sockPath: string;
  private server = createNetServer();
  private sockets = new Map<string, Socket>();
  private buffers = new Map<Socket, string>();
  private counter = 0;
  private handler?: FrameHandler;

  constructor(sockPath: string) {
    this.sockPath = sockPath;
  }

  async start(handler: FrameHandler): Promise<void> {
    this.handler = handler;
    mkdirSync(dirname(this.sockPath), { recursive: true, mode: 0o700 });
    rmSync(this.sockPath, { force: true });
    this.server.on("connection", (sock) => this.onConnection(sock));
    await new Promise<void>((r) => this.server.listen(this.sockPath, r));
    chmodSync(this.sockPath, 0o600);
  }

  private onConnection(sock: Socket): void {
    const socketId = `c${++this.counter}`;
    this.sockets.set(socketId, sock);
    this.buffers.set(sock, "");
    sock.on("data", (buf) => {
      // ponytail: brief's code used `const s` and never updated it inside the
      // while loop, so s.indexOf("\n") returned the same index forever — infinite
      // loop on any complete frame. Minimal root-cause fix: mutate s per line and
      // persist the buffer once at the end. Deviation from verbatim, see report.
      let s = this.buffers.get(sock) + buf.toString();
      let nl: number;
      while ((nl = s.indexOf("\n")) >= 0) {
        const line = s.slice(0, nl);
        s = s.slice(nl + 1);
        try {
          const frame = parseFrame(line);
          void this.handler?.(socketId, frame);
        } catch (err) {
          process.stderr.write(`socket: bad frame from ${socketId}: ${err}\n`);
        }
      }
      this.buffers.set(sock, s);
    });
    sock.on("close", () => {
      this.sockets.delete(socketId);
      this.buffers.delete(sock);
    });
  }

  send(socketId: string, frame: Frame): void {
    const sock = this.sockets.get(socketId);
    if (sock && !sock.destroyed) sock.write(encodeFrame(frame));
  }

  socketIds(): string[] {
    return [...this.sockets.keys()];
  }

  stop(): void {
    for (const s of this.sockets.values()) s.destroy();
    this.server.close();
    rmSync(this.sockPath, { force: true });
  }
}