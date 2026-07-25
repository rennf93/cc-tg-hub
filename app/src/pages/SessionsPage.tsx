import { useEffect, useState, useCallback } from "react";
import { api, type SessionView } from "@/api";
import { TgSection, TgRow, TgAvatar } from "@/components/ui";
import { basename } from "@/lib/path";

const GROUPS: { key: SessionView["status"]; label: string }[] = [
  { key: "paused", label: "Paused" },
  { key: "online", label: "Online" },
  { key: "idle", label: "Idle" },
  { key: "offline", label: "Offline" },
];

export function SessionsPage({ onOpen }: { onOpen: (s: SessionView) => void }) {
  const [sessions, setSessions] = useState<SessionView[]>([]);
  const refresh = useCallback(() => {
    api.listSessions().then(setSessions).catch(() => {});
  }, []);
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, [refresh]);

  return (
    <div className="tg-stagger space-y-3 p-3 pb-24">
      <h1 className="tg-brand text-[13px] tracking-[0.3em] text-foreground">tg-hub</h1>
      {sessions.length === 0 && (
        <p className="px-1 text-sm text-muted-foreground">No sessions registered. Start <code className="text-foreground">claude</code> with the tg-hub MCP enabled.</p>
      )}
      {GROUPS.map(({ key, label }) => {
        const rows = sessions.filter((s) => s.status === key);
        if (!rows.length) return null;
        return (
          <TgSection key={key} title={`${label} · ${rows.length}`}>
            <div className="space-y-0.5">
              {rows.map((s) => (
                <TgRow
                  key={s.id}
                  leading={<TgAvatar name={basename(s.cwd)} active={s.status === "online"} />}
                  title={s.name}
                  meta={`${basename(s.cwd)} · ${s.lastActivity}`}
                  onPress={() => onOpen(s)}
                />
              ))}
            </div>
          </TgSection>
        );
      })}
    </div>
  );
}