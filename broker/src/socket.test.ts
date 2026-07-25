import { test, expect } from "bun:test";
import { rmSync } from "node:fs";
import { connect } from "node:net";
import { SocketServer } from "./socket";
import { encodeFrame } from "@tg-hub/frames";

const sockPath = "/tmp/tg-hub-socket-test.sock";
rmSync(sockPath, { force: true });

test("server receives frames and can send back", async () => {
  const server = new SocketServer(sockPath);
  const received: any[] = [];
  await server.start(async (socketId, frame) => {
    received.push(frame);
    if (frame.type === "register") server.send(socketId, { type: "registered", topicId: 5, chatId: "-1001" });
  });
  const sock = connect(sockPath);
  await new Promise((r) => sock.once("connect", r));
  sock.write(encodeFrame({ type: "register", sessionId: "s1", name: "foo", cwd: "/x" }));
  await new Promise((r) => setTimeout(r, 80));
  expect(received[0]?.type).toBe("register");
  sock.end();
  server.stop();
  rmSync(sockPath, { force: true });
});