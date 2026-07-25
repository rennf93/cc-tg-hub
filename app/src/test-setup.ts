// ponytail: bun test has no DOM; the telegram bridges assume a browser/jsdom
// env (roboco runs them under vitest+jsdom). Stub just enough of `window` for
// the ported code — only `matchMedia` is touched (createDevMockWebApp's
// colorScheme detection). `window.Telegram.WebApp` stays absent, so
// waitForTelegramWebApp still resolves null and getTelegramWebApp returns null.
if (typeof (globalThis as { window?: unknown }).window === "undefined") {
  (globalThis as { window: unknown }).window = {
    matchMedia: () => ({ matches: false }),
  };
}