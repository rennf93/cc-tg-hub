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

/** A tool-permission prompt raised inside a session, to be answered from Telegram. */
export interface PermissionAskFrame {
  type: "permission_ask";
  requestId: string;
  toolName: string;
  description?: string;
  inputPreview?: string;
}
/** The tap on Allow/Deny, routed back to the session that asked. */
export interface PermissionDecisionFrame {
  type: "permission_decision";
  requestId: string;
  behavior: "allow" | "deny";
}

export type Frame =
  | RegisterFrame | RegisteredFrame | ReplyFrame | MessageFrame | UnregisterFrame | StopFrame
  | PermissionAskFrame | PermissionDecisionFrame;

export function encodeFrame(f: Frame): string {
  return JSON.stringify(f) + "\n";
}

export function parseFrame(line: string): Frame {
  const raw = JSON.parse(line); // throws on malformed — caller handles
  if (typeof raw !== "object" || raw === null || typeof raw.type !== "string")
    throw new Error("invalid frame");
  return raw as Frame;
}