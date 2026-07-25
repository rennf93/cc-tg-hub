import { test, expect } from "bun:test";
import { createDevMockWebApp, isDevMockWebApp, waitForTelegramWebApp } from "./webapp";

test("dev mock is recognized and has empty initData", () => {
  const m = createDevMockWebApp();
  expect(isDevMockWebApp(m)).toBe(true);
  expect(m.initData).toBe("");
});

test("waitForTelegramWebApp resolves null when no bridge present", async () => {
  // No window.Telegram.WebApp in the bun test env.
  const r = await waitForTelegramWebApp(50);
  expect(r).toBeNull();
});