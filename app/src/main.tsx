import { createRoot } from "react-dom/client";
import "./globals.css";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(
  <div id="tg-shell" className="min-h-[100dvh] bg-background text-foreground">
    <App />
  </div>,
);