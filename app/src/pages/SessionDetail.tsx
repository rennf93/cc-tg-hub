import { useState } from "react";
import { api, type SessionView } from "@/api";
import { TgSubPage, TgCircleAction, TG_PRESS } from "@/components/ui";
import { useTgWebApp } from "@/lib/telegram/hooks";
import { haptics, type TelegramWebApp } from "@/lib/telegram/webapp";
import { ArrowSquareOut, Pause, Play, Stop, PencilSimple } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

/** Telegram's showConfirm is callback-based; wrap it in a Promise. Proceeds
 * (true) when no bridge/showConfirm is present (dev mock) so local dev isn't blocked. */
function confirmDialog(webApp: TelegramWebApp | null, message: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (!webApp?.showConfirm) return resolve(true);
    webApp.showConfirm(message, (ok: boolean) => resolve(ok));
  });
}

export function SessionDetail({ session, onBack, onChanged }: {
  session: SessionView;
  onBack: () => void;
  onChanged: () => void;
}) {
  const webApp = useTgWebApp();
  const [name, setName] = useState(session.name);
  const [editing, setEditing] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const open = () => webApp?.openTelegramLink?.(session.deepLink);
  const commitRename = async () => {
    setBusy(true);
    try {
      const r = await api.renameSession(session.id, name);
      setWarning(r.warning ?? null);
      setEditing(false);
      onChanged();
      haptics.success();
    } catch (e) { setWarning(String((e as Error).message)); }
    finally { setBusy(false); }
  };
  const togglePause = async () => {
    setBusy(true);
    try {
      if (session.paused) await api.resumeSession(session.id); else await api.pauseSession(session.id);
      onChanged(); haptics.tap();
    } finally { setBusy(false); }
  };
  const stop = async () => {
    const ok = await confirmDialog(webApp, "Stop this session? It will disconnect from Telegram. The Claude process in your terminal keeps running.");
    if (!ok) return;
    setBusy(true);
    try { await api.stopSession(session.id); onChanged(); onBack(); } finally { setBusy(false); }
  };

  return (
    <TgSubPage title={session.name} subtitle={session.cwd} onBack={onBack}>
      <div className="tg-stagger space-y-3">
        <div className="rounded-[20px] bg-card p-4 text-card-foreground">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Status</span>
            <span className="text-sm font-medium capitalize">{session.status}</span>
          </div>
          <div className="mt-2 flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Last activity</span>
            <span className="text-sm">{session.lastActivity}</span>
          </div>
          <div className="mt-2 flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Topic</span>
            <span className="text-sm tabular-nums">#{session.topicId}</span>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <TgCircleAction icon={ArrowSquareOut} label="Open" onPress={open} />
          <TgCircleAction icon={session.paused ? Play : Pause} label={session.paused ? "Resume" : "Pause"} onPress={togglePause} busy={busy} />
          <TgCircleAction icon={Stop} label="Stop" accent onPress={stop} busy={busy} />
        </div>

        <div className="rounded-[20px] bg-card p-4 text-card-foreground">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Name</span>
            {!editing && (
              <button type="button" onClick={() => setEditing(true)} className={cn("text-muted-foreground", TG_PRESS)}>
                <PencilSimple weight="duotone" className="h-4 w-4" />
              </button>
            )}
          </div>
          {editing ? (
            <div className="mt-2 flex gap-2">
              <input value={name} onChange={(e) => setName(e.target.value)} className="flex-1 rounded-lg bg-input px-3 py-2 text-sm" />
              <button type="button" onClick={commitRename} disabled={busy} className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground">Save</button>
            </div>
          ) : (
            <p className="mt-1 text-sm">{session.name}</p>
          )}
          {warning && <p className="mt-1 text-xs text-amber-300">{warning}</p>}
        </div>
      </div>
    </TgSubPage>
  );
}