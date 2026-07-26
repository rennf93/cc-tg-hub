import { loadConfig, type Config } from "./config";
import { SessionsStore } from "./state";
import { BotApi, createBot } from "./telegram";
import { SocketServer } from "./socket";
import { Router } from "./router";
import { Api } from "./api";
import { serveStatic } from "./static";
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";

async function main(): Promise<void> {
  const config = loadConfig();

  // Detached daemon (spawned by the MCP when claude starts): mirror stderr to
  // a log file so `cc-tg-hub logs` can show it. Foreground dev runs keep stderr.
  const pidPath = join(config.stateDir, "broker.pid");
  if (process.env.CC_TG_HUB_DAEMON === "1") {
    mkdirSync(join(config.stateDir, "logs"), { recursive: true });
    const sink = Bun.file(join(config.stateDir, "logs", "broker.err.log")).writer();
    const orig = process.stderr.write.bind(process.stderr);
    (process.stderr as any).write = (chunk: any, ...rest: any[]) => { try { sink.write(chunk); } catch {} return orig(chunk, ...rest); };
    process.on("exit", () => { try { sink.end(); } catch {} });
  }

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
  // Bind succeeded (socket + http): claim the pidfile. A duplicate spawn that
  // lost the bind race fatal-exits before reaching here, so the pidfile always
  // points at the winning broker.
  writeFileSync(pidPath, String(process.pid));

  const bot = createBot(config);
  bot.on("message:text", (ctx) => router.processUpdate(ctx.update as any));
  bot.on("message:photo", (ctx) => router.processUpdate(ctx.update as any));
  bot.on("message:document", (ctx) => router.processUpdate(ctx.update as any));

  const stop = () => { try { unlinkSync(pidPath); } catch {} bot.stop(); server.stop(); http.stop(); process.exit(0); };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);

  // bot.start() runs the long-poll loop; only message updates needed.
  await bot.start({
    allowed_updates: ["message"],
    onStart: () => process.stderr.write("cc-tg-hub broker: polling Telegram\n"),
  });
}

void main().catch((e) => { process.stderr.write(`broker fatal: ${e}\n`); process.exit(1); });