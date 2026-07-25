const BASE = "";  // same origin in prod; Vite proxy in dev

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, { credentials: "include", ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  if (!res.ok) {
    let msg = res.statusText;
    try { const j = await res.json(); msg = (j as any).error ?? msg; } catch {}
    throw new Error(msg);
  }
  return res.json().catch(() => ({})) as T;
}

export interface SessionView {
  id: string; name: string; cwd: string; topicId: number;
  status: "online" | "idle" | "paused" | "offline" | "stopped";
  paused: boolean; lastSeen: number; lastActivity: string; deepLink: string;
}

export const api = {
  authTelegram: (initData: string) => req<{ ok: true; user: { id: number } }>("/api/auth/telegram", { method: "POST", body: JSON.stringify({ initData }) }),
  listSessions: () => req<SessionView[]>("/api/sessions"),
  renameSession: (id: string, name: string) => req<{ ok: true; warning?: string }>(`/api/sessions/${id}`, { method: "PATCH", body: JSON.stringify({ name }) }),
  pauseSession: (id: string) => req<{ ok: true; paused: boolean }>(`/api/sessions/${id}/pause`, { method: "POST" }),
  resumeSession: (id: string) => req<{ ok: true; paused: boolean }>(`/api/sessions/${id}/resume`, { method: "POST" }),
  stopSession: (id: string) => req<{ ok: true; status: string }>(`/api/sessions/${id}/stop`, { method: "POST" }),
};