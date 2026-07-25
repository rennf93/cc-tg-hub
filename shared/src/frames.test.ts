import { test, expect } from "bun:test";
import { encodeFrame, parseFrame, type Frame, type StopFrame } from "./frames";

test("encodeFrame produces one JSON line", () => {
  const line = encodeFrame({ type: "register", sessionId: "s1", name: "foo", cwd: "/x" });
  expect(line).toBe('{"type":"register","sessionId":"s1","name":"foo","cwd":"/x"}\n');
});

test("parseFrame round-trips every frame kind", () => {
  const frames: Frame[] = [
    { type: "register", sessionId: "s1", name: "foo", cwd: "/x" },
    { type: "registered", topicId: 42, chatId: "-100123" },
    { type: "reply", chatId: "-100123", text: "hi", replyTo: "9", files: ["/a.png"], format: "text" },
    { type: "message", chatId: "-100123", topicId: 42, messageId: "5", user: "u", userId: "1", ts: "2026-07-25T00:00:00Z", text: "hey" },
    { type: "unregister" },
  ];
  for (const f of frames) {
    expect(parseFrame(encodeFrame(f))).toEqual(f);
  }
});

test("parseFrame rejects malformed JSON", () => {
  expect(() => parseFrame("not json\n")).toThrow();
});

test("StopFrame round-trips through encode/parse", () => {
  const f: StopFrame = { type: "stop" };
  const line = encodeFrame(f);
  expect(line).toBe('{"type":"stop"}\n');
  expect(parseFrame(line.trim())).toEqual({ type: "stop" });
});

test("parseFrame rejects non-object", () => {
  expect(() => parseFrame('"hello"')).toThrow();
  expect(() => parseFrame("null")).toThrow();
});