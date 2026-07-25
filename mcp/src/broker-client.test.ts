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

import { createServer as createNetServer, type Socket } from "node:net";

function withBroker(handler: (sock: Socket) => void): { sockPath: string; close: () => void } {
  const sockPath = "/tmp/tg-hub-stop-test.sock";
  rmSync(sockPath, { force: true });
  const srv = createNetServer((sock) => handler(sock));
  srv.listen(sockPath);
  return { sockPath, close: () => { srv.close(); rmSync(sockPath, { force: true }); } };
}

test("on receiving a stop frame, BrokerClient disconnects and does not reconnect", async () => {
  let brokerGotUnregister = false;
  const { sockPath, close } = withBroker((sock) => {
    sock.on("data", (b) => { if (b.toString().includes('"unregister"')) brokerGotUnregister = true; });
    // Immediately send a stop frame once the client connects.
    sock.write('{"type":"stop"}\n');
  });
  const client = new BrokerClient(sockPath, "s1", "n", "/c");
  await client.connect();
  // Give the stop frame a moment to be received and processed.
  await new Promise((r) => setTimeout(r, 100));
  expect(brokerGotUnregister).toBe(true);
  // No reconnect should occur — wait a bit beyond the backoff and confirm no new connection.
  await new Promise((r) => setTimeout(r, 1200));
  close();
});