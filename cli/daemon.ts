import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, readFileSync, unlinkSync } from "node:fs";

export const STATE_DIR = join(homedir(), ".claude", "cc-tg-hub");
export const PID_PATH = join(STATE_DIR, "broker.pid");
export const SOCK_PATH = join(STATE_DIR, "broker.sock");
export const LOG_DIR = join(STATE_DIR, "logs");
export const CONFIG_PATH = join(STATE_DIR, "config.json");

export function readPid(): number | undefined {
  if (!existsSync(PID_PATH)) return undefined;
  const pid = Number(readFileSync(PID_PATH, "utf8").trim());
  return Number.isFinite(pid) && pid > 0 ? pid : undefined;
}

export function isRunning(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

export function statusBroker(): { running: boolean; pid?: number } {
  const pid = readPid();
  if (pid && isRunning(pid)) return { running: true, pid };
  return { running: false };
}

export async function stopBroker(): Promise<boolean> {
  const pid = readPid();
  if (!pid || !isRunning(pid)) {
    try { unlinkSync(PID_PATH); } catch {}
    try { unlinkSync(SOCK_PATH); } catch {}
    return false;
  }
  try { process.kill(pid, "SIGTERM"); } catch { return false; }
  for (let i = 0; i < 50 && isRunning(pid); i++) await new Promise((r) => setTimeout(r, 100));
  try { if (!isRunning(pid)) unlinkSync(PID_PATH); } catch {}
  try { unlinkSync(SOCK_PATH); } catch {}
  return !isRunning(pid);
}