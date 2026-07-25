import { Bot, InputFile } from "grammy";
import { join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import type { Config } from "./config";

const TELEGRAM = "https://api.telegram.org";

export class BotApi {
  private token: string;
  private groupId: string;
  private apiRoot: string;
  private allowUserIds: Set<number>;

  constructor(token: string, groupId: string, apiRoot: string | undefined, allowUserIds: number[] = []) {
    this.token = token;
    this.groupId = groupId;
    this.apiRoot = apiRoot ?? TELEGRAM;
    this.allowUserIds = new Set(allowUserIds);
  }

  private async call(method: string, form: Record<string, string | InputFile>): Promise<any> {
    const body = new FormData();
    for (const [k, v] of Object.entries(form)) {
      if (v instanceof InputFile) body.append(k, v.file, v.filename ?? k);
      else if (v !== undefined && v !== null) body.append(k, String(v));
    }
    const res = await fetch(`${this.apiRoot}/bot${this.token}/${method}`, { method: "POST", body });
    const json = await res.json() as any;
    if (!json.ok) throw new Error(`telegram ${method} failed: ${JSON.stringify(json)}`);
    return json.result;
  }

  isAllowed(userId: number): boolean {
    return this.allowUserIds.has(userId);
  }

  async createTopic(name: string): Promise<number> {
    const r = await this.call("createForumTopic", { chat_id: this.groupId, name });
    return r.message_thread_id as number;
  }

  async sendText(topicId: number, text: string, opts: { replyTo?: string; format?: "text" | "markdownv2" } = {}): Promise<number> {
    const r = await this.call("sendMessage", {
      chat_id: this.groupId,
      message_thread_id: String(topicId),
      text,
      reply_to_message_id: opts.replyTo,
      parse_mode: opts.format === "markdownv2" ? "MarkdownV2" : undefined,
    });
    return r.message_id as number;
  }

  async sendPhoto(topicId: number, path: string, caption?: string): Promise<number> {
    const r = await this.call("sendPhoto", {
      chat_id: this.groupId,
      message_thread_id: String(topicId),
      photo: new InputFile(path),
      caption: caption,
    });
    return r.message_id as number;
  }

  async editText(messageId: number, text: string, format?: "text" | "markdownv2"): Promise<void> {
    await this.call("editMessageText", {
      chat_id: this.groupId,
      message_id: String(messageId),
      text,
      parse_mode: format === "markdownv2" ? "MarkdownV2" : undefined,
    });
  }

  async react(messageId: number, emoji: string): Promise<void> {
    await this.call("setMessageReaction", {
      chat_id: this.groupId,
      message_id: String(messageId),
      reaction: JSON.stringify([{ type: "emoji", emoji }]),
    });
  }

  async downloadFile(fileId: string, inboxDir: string): Promise<string> {
    const file = await this.call("getFile", { file_id: fileId });
    const url = `${this.apiRoot}/file/bot${this.token}/${file.file_path}`;
    const res = await fetch(url);
    const buf = Buffer.from(await res.arrayBuffer());
    const ext = (file.file_path as string).split(".").pop() ?? "bin";
    const path = join(inboxDir, `${Date.now()}-${fileId.slice(-8)}.${ext}`);
    mkdirSync(inboxDir, { recursive: true });
    writeFileSync(path, buf);
    return path;
  }
}

export function createBot(config: Config): Bot {
  return new Bot(config.botToken, { client: { apiRoot: config.apiRoot ?? TELEGRAM } });
}