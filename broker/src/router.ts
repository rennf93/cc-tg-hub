import type { BotApi } from "./telegram";
import { SessionsStore, sessionKeyHash } from "./state";
import type { SocketServer } from "./socket";
import type { Frame, MessageFrame, ReplyFrame } from "@tg-hub/frames";

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
    chat: { id: string };
  };
}

export class Router {
  private socketToSession = new Map<string, string>();   // socketId -> sessionId
  private socketToConn = new Map<string, string>();        // socketId -> socketId (for server.send)
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
  }

  async processUpdate(u: TelegramUpdate): Promise<void> {
    const msg = u.message;
    if (!msg || !msg.from) return;
    if (!this.bot.isAllowed(msg.from.id)) return; // trust boundary
    const topicId = msg.message_thread_id;
    if (topicId === undefined) return; // not in a topic — ignore (no general chat)
    const rec = this.store.byTopic(topicId);
    if (!rec || rec.status !== "online" || !rec.socketId) return; // no live session for this topic
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
      chatId: msg.chat.id,
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
    this.server.send(rec.socketId, frame);
  }

  handleDisconnect(socketId: string): void {
    const sessionId = this.socketToSession.get(socketId);
    if (sessionId) {
      this.socketToSession.delete(socketId);
      this.store.setOffline(sessionId);
    }
  }
}