import { test, expect } from "bun:test";
import { join } from "node:path";
import { rmSync } from "node:fs";
import { SocketServer } from "../../broker/src/socket";
import { BrokerClient } from "./broker-client";

const sockPath = "/tmp/tg-hub-mcp-test.sock";
rmSync(sockPath, { force: true });

test("BrokerClient connects, registers, and receives messages", async () => {
  const server = new SocketServer(sockPath);
  const sent: any[] = [];
  await server.start(async (sid, frame) => {
    sent.push(frame);
    if (frame.type === "register") server.send(sid, { type: "registered", topicId: 7, chatId: "-1001" });
  });
  const c = new BrokerClient(sockPath, "s1", "foo", "/x");
  await c.connect();
  await new Promise((r) => setTimeout(r, 50));
  expect(sent[0]?.type).toBe("register");
  let got: any;
  c.onMessage((f) => { got = f; });
  // server sends to the first connection
  server.send(server.socketIds()[0], { type: "message", chatId: "-1001", topicId: 7, messageId: "1", user: "ren", userId: "1", ts: "2026-07-25T00:00:00Z", text: "hi" });
  await new Promise((r) => setTimeout(r, 50));
  expect(got?.text).toBe("hi");
  c.disconnect();
  server.stop();
  rmSync(sockPath, { force: true });
});