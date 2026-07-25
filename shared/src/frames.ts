/** Line-delimited JSON frames exchanged between broker and MCP over the UNIX socket.
 * MCP -> broker: register, reply, unregister. Broker -> MCP: registered, message, stop. */

export interface RegisterFrame { type: "register"; sessionId: string; name: string; cwd: string }
export interface RegisteredFrame { type: "registered"; topicId: number; chatId: string }
export interface ReplyFrame {
  type: "reply";
  chatId: string;
  text: string;
  replyTo?: string;
  files?: string[];
  format?: "text" | "markdownv2";
}
export interface MessageFrame {
  type: "message";
  chatId: string;
  topicId: number;
  messageId?: string;
  user: string;
  userId: string;
  ts: string;
  text: string;
  image_path?: string;
  attachment_file_id?: string;
  attachment_kind?: string;
  attachment_name?: string;
}
export interface UnregisterFrame { type: "unregister" }
export interface StopFrame { type: "stop" }

export type Frame =
  | RegisterFrame | RegisteredFrame | ReplyFrame | MessageFrame | UnregisterFrame | StopFrame;

export function encodeFrame(f: Frame): string {
  return JSON.stringify(f) + "\n";
}

export function parseFrame(line: string): Frame {
  const raw = JSON.parse(line); // throws on malformed — caller handles
  if (typeof raw !== "object" || raw === null || typeof raw.type !== "string")
    throw new Error("invalid frame");
  return raw as Frame;
}