import { loadConfig, type Config } from "./config";
import { SessionsStore } from "./state";
import { BotApi, createBot } from "./telegram";
import { SocketServer } from "./socket";
import { Router } from "./router";
import { Api } from "./api";
import { serveStatic } from "./static";
import { existsSync } from "node:fs";
import { join } from "node:path";

async function main(): Promise<void> {
  const config = loadConfig();
  const store = new SessionsStore(config.stateDir);
  const server = new SocketServer(config.socketPath);
  const botApi = new BotApi(config.botToken, config.groupId, config.apiRoot, config.allowUserIds);
  const router = new Router(botApi, store, server, config.stateDir);

  await server.start((socketId, frame) => router.handleFrame(socketId, frame));
  process.stderr.write(`cc-tg-hub broker: socket at ${config.socketPath}\n`);

  const api = new Api(botApi, store, router, config);
  const distDir = join(config.stateDir, "app-dist");   // deploy step will point this at the built app
  const serveApp = existsSync(distDir) ? serveStatic(distDir) : null;
  const http = Bun.serve({
    port: config.httpPort,
    fetch(req) {
      const u = new URL(req.url);
      if (u.pathname.startsWith("/api/")) return api.handle(req);
      if (serveApp) {
        const res = serveApp(req);
        if (res) return res;
      }
      return new Response("not found", { status: 404 });
    },
  });
  process.stderr.write(`cc-tg-hub broker: http on :${http.port}\n`);

  const bot = createBot(config);
  bot.on("message:text", (ctx) => router.processUpdate(ctx.update as any));
  bot.on("message:photo", (ctx) => router.processUpdate(ctx.update as any));
  bot.on("message:document", (ctx) => router.processUpdate(ctx.update as any));

  const stop = () => { bot.stop(); server.stop(); http.stop(); process.exit(0); };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);

  // bot.start() runs the long-poll loop; only message updates needed.
  await bot.start({
    allowed_updates: ["message"],
    onStart: () => process.stderr.write("cc-tg-hub broker: polling Telegram\n"),
  });
}

void main().catch((e) => { process.stderr.write(`broker fatal: ${e}\n`); process.exit(1); });