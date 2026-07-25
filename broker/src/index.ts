import { loadConfig, type Config } from "./config";
import { SessionsStore } from "./state";
import { BotApi, createBot } from "./telegram";
import { SocketServer } from "./socket";
import { Router } from "./router";

async function main(): Promise<void> {
  const config = loadConfig();
  const store = new SessionsStore(config.stateDir);
  const server = new SocketServer(config.socketPath);
  const botApi = new BotApi(config.botToken, config.groupId, config.apiRoot, config.allowUserIds);
  const router = new Router(botApi, store, server, config.stateDir);

  await server.start((socketId, frame) => router.handleFrame(socketId, frame));
  process.stderr.write(`tg-hub broker: socket at ${config.socketPath}\n`);

  const bot = createBot(config);
  bot.on("message:text", (ctx) => router.processUpdate(ctx.update as any));
  bot.on("message:photo", (ctx) => router.processUpdate(ctx.update as any));
  bot.on("message:document", (ctx) => router.processUpdate(ctx.update as any));

  const stop = () => { bot.stop(); server.stop(); process.exit(0); };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);

  // bot.start() runs the long-poll loop; only message updates needed.
  await bot.start({
    allowed_updates: ["message"],
    onStart: () => process.stderr.write("tg-hub broker: polling Telegram\n"),
  });
}

void main().catch((e) => { process.stderr.write(`broker fatal: ${e}\n`); process.exit(1); });