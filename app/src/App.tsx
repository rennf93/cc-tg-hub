import { useEffect, useState } from "react";
import {
  waitForTelegramWebApp, createDevMockWebApp, isDevMockWebApp, type TelegramWebApp,
} from "@/lib/telegram/webapp";
import { startTelegramThemeSync } from "@/lib/telegram/theme";
import { TgWebAppProvider } from "@/lib/telegram/hooks";
import { api, type SessionView } from "@/api";
import { SessionsPage } from "@/pages/SessionsPage";
import { SessionDetail } from "@/pages/SessionDetail";
import { ArrowSquareOut, CircleNotch, Warning } from "@phosphor-icons/react";

type State =
  | { kind: "validating" }
  | { kind: "ready"; webApp: TelegramWebApp }
  | { kind: "not_in_telegram" }
  | { kind: "error"; message: string };

function CenteredMessage({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full min-h-[70dvh] flex-col items-center justify-center gap-3 p-6 text-center">{children}</div>;
}

export function App() {
  const [state, setState] = useState<State>({ kind: "validating" });
  const [open, setOpen] = useState<SessionView | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let webApp = await waitForTelegramWebApp();
      if (cancelled) return;
      if (!webApp?.initData && import.meta.env.DEV) webApp = createDevMockWebApp();
      if (!webApp || (!webApp.initData && !isDevMockWebApp(webApp))) {
        setState({ kind: "not_in_telegram" });
        return;
      }
      webApp.ready();
      webApp.expand();
      webApp.disableVerticalSwipes?.();
      if (isDevMockWebApp(webApp)) { setState({ kind: "ready", webApp }); return; }
      try {
        await api.authTelegram(webApp.initData ?? "");
        if (!cancelled) setState({ kind: "ready", webApp });
      } catch (err) { if (!cancelled) setState({ kind: "error", message: String((err as Error).message) }); }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (state.kind !== "ready") return;
    const shell = document.getElementById("tg-shell");
    if (!shell) return;
    return startTelegramThemeSync(state.webApp, shell);
  }, [state]);

  if (state.kind === "validating")
    return <CenteredMessage><CircleNotch weight="bold" className="h-8 w-8 animate-spin text-muted-foreground" /><p className="text-sm text-muted-foreground">Connecting…</p></CenteredMessage>;
  if (state.kind === "not_in_telegram")
    return <CenteredMessage><ArrowSquareOut weight="duotone" className="h-10 w-10 text-muted-foreground" /><h1 className="text-lg font-semibold">Open from Telegram</h1><p className="text-sm text-muted-foreground">Open this from the bot&apos;s menu button.</p></CenteredMessage>;
  if (state.kind === "error")
    return <CenteredMessage><Warning weight="duotone" className="h-10 w-10 text-destructive" /><h1 className="text-lg font-semibold">Couldn&apos;t sign in</h1><p className="text-sm text-muted-foreground">{state.message}</p></CenteredMessage>;

  return (
    <TgWebAppProvider webApp={state.webApp}>
      {open ? <SessionDetail session={open} onBack={() => setOpen(null)} onChanged={() => {}} /> : <SessionsPage onOpen={setOpen} />}
    </TgWebAppProvider>
  );
}