import type { BotApi } from "./telegram";
import { SessionsStore } from "./state";
import type { SocketServer } from "./socket";
import type { Frame, MessageFrame, ReplyFrame } from "@cc-tg-hub/frames";

interface TelegramUpdate {
  message?: {
    message_thread_id?: number;
    message_id: number;
    from?: { id: number; username?: string };
    date: number;
    text?: string;
    caption?: string;
    photo?: Array<{ file_id: string; file_unique_id: string }>;
    document?: { file_id: string; file_name?: string };
    chat: { id: number };   // Telegram sends this as a NUMBER — MessageFrame.chatId is a string
  };
}

export class Router {
  private socketToSession = new Map<string, string>();   // socketId -> sessionId
  private bot: BotApi;
  private store: SessionsStore;
  private server: SocketServer;
  private inboxDir: string;

  constructor(bot: BotApi, store: SessionsStore, server: SocketServer, stateDir: string) {
    this.bot = bot;
    this.store = store;
    this.server = server;
    this.inboxDir = `${stateDir}/inbox`;
  }

  async handleFrame(socketId: string, frame: Frame): Promise<void> {
    switch (frame.type) {
      case "register":
        return this.handleRegister(socketId, frame);
      case "reply":
        return this.handleReply(socketId, frame);
      case "unregister":
        return this.handleDisconnect(socketId);
    }
  }

  private async handleRegister(socketId: string, f: { sessionId: string; name: string; cwd: string }): Promise<void> {
    // A stopped session must not be resurrected by a re-register: if the socket
    // died before the stop frame was delivered, the still-alive MCP (stopped=false)
    // reconnects after backoff and lands here. Re-send stop to the fresh socket so
    // the MCP finally honors it, disconnects, and won't reconnect again; leave the
    // record stopped. (Safe because sessionId is per-process — a new claude session
    // gets a new sessionId, so this only catches the same-MCP reconnect, not a legit
    // restart.)
    if (this.store.get(f.sessionId)?.status === "stopped") {
      this.server.send(socketId, { type: "stop" });
      return;
    }
    // Reuse an existing topic for this (name, cwd) if a prior session used one — keeps history.
    let topicId = this.store.reuseKey(f.name, f.cwd);
    if (topicId === undefined) {
      topicId = await this.bot.createTopic(f.name);
    }
    this.socketToSession.set(socketId, f.sessionId);
    this.store.upsert({
      sessionId: f.sessionId,
      name: f.name,
      cwd: f.cwd,
      topicId,
      status: "online",
      lastSeen: Date.now(),
      socketId,
      paused: false,
    });
    this.server.send(socketId, { type: "registered", topicId, chatId: this.bot.groupId });
  }

  private async handleReply(socketId: string, f: ReplyFrame): Promise<void> {
    const sessionId = this.socketToSession.get(socketId);
    const rec = sessionId ? this.store.get(sessionId) : undefined;
    if (!rec) return;
    const mid = await this.bot.sendText(rec.topicId, f.text, { replyTo: f.replyTo, format: f.format });
    if (f.files && f.files.length) {
      for (const p of f.files) {
        try { await this.bot.sendPhoto(rec.topicId, p); } catch (e) { process.stderr.write(`sendPhoto ${p}: ${e}\n`); }
      }
    }
    void mid;
    this.bumpLastSeen(rec.sessionId);
  }

  private bumpLastSeen(sessionId: string): void {
    const r = this.store.get(sessionId);
    if (r) { r.lastSeen = Date.now(); }
  }

  async processUpdate(u: TelegramUpdate): Promise<void> {
    const msg = u.message;
    if (!msg || !msg.from) { process.stderr.write(`[trace] update: no msg/from\n`); return; }
    if (!this.bot.isAllowed(msg.from.id)) { process.stderr.write(`[trace] update from ${msg.from.id}: not allowed\n`); return; } // trust boundary
    const topicId = msg.message_thread_id;
    process.stderr.write(`[trace] update from ${msg.from.username ?? msg.from.id}: topicId=${topicId} text=${JSON.stringify(msg.text ?? msg.caption ?? "").slice(0,40)}\n`);
    if (topicId === undefined) { process.stderr.write(`[trace] drop: no topicId (not in a topic)\n`); return; } // not in a topic — ignore (no general chat)
    const rec = this.store.byTopic(topicId);
    if (!rec || rec.status !== "online" || !rec.socketId) { process.stderr.write(`[trace] drop: no live session for topicId=${topicId} (rec=${rec ? rec.sessionId : "none"} status=${rec?.status})\n`); return; } // no live session for this topic
    if (rec.paused) { process.stderr.write(`[trace] drop: session ${rec.sessionId} paused\n`); return; }   // paused: drop inbound before any side effect
    process.stderr.write(`[trace] forwarding to session ${rec.sessionId} (socket ${rec.socketId})\n`);
    let text = msg.text ?? msg.caption ?? "";
    let image_path: string | undefined;
    let attachment_file_id: string | undefined;
    let attachment_kind: string | undefined;
    let attachment_name: string | undefined;
    if (msg.photo && msg.photo.length) {
      const best = msg.photo[msg.photo.length - 1];
      try { image_path = await this.bot.downloadFile(best.file_id, this.inboxDir); } catch (e) { process.stderr.write(`download photo: ${e}\n`); }
    } else if (msg.document) {
      attachment_file_id = msg.document.file_id;
      attachment_kind = "document";
      attachment_name = msg.document.file_name;
    }
    const frame: MessageFrame = {
      type: "message",
      chatId: String(msg.chat.id),
      topicId,
      messageId: String(msg.message_id),
      user: msg.from.username ?? String(msg.from.id),
      userId: String(msg.from.id),
      ts: new Date(msg.date * 1000).toISOString(),
      text,
      image_path,
      attachment_file_id,
      attachment_kind,
      attachment_name,
    };
    if (!this.server.has(rec.socketId)) {
      // Record says online but the socket is gone (send() would silently no-op) —
      // e.g. the close event hasn't reached the router yet. Drop and correct the record.
      process.stderr.write(`[trace] drop: socket ${rec.socketId} not live for session ${rec.sessionId}\n`);
      this.store.setOffline(rec.sessionId);
      return;
    }
    this.server.send(rec.socketId, frame);
    this.bumpLastSeen(rec.sessionId);
  }

  handleDisconnect(socketId: string): void {
    const sessionId = this.socketToSession.get(socketId);
    this.socketToSession.delete(socketId);
    // Reconnect race: the MCP can register a new socket for the same sessionId
    // before the OLD socket's close event fires. Only offline the record if it
    // still points at THIS closing socketId — otherwise a stale close would
    // clobber the freshly-reconnected session.
    if (sessionId && this.store.get(sessionId)?.socketId === socketId) {
      this.store.setOffline(sessionId);
    }
  }

  stop(sessionId: string): void {
    const rec = this.store.get(sessionId);
    if (!rec || rec.status === "stopped") return;
    if (rec.socketId) this.server.send(rec.socketId, { type: "stop" });
    this.store.setStopped(sessionId);
    // Drop the socket mapping so a late frame from the dying MCP is ignored.
    for (const [sid, sess] of this.socketToSession) if (sess === sessionId) this.socketToSession.delete(sid);
  }
}