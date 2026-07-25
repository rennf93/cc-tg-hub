import { test, expect } from "bun:test";
import { renderToStaticMarkup as render } from "react-dom/server";
import { TgAvatar, TgRow, TgSection } from "./ui";

test("TgAvatar renders project initials from a name", () => {
  const html = render(<TgAvatar name="claude-telegram-hub" />);
  // initials: first letters of first two segments -> "CT"
  expect(html).toContain("CT");
});

test("TgRow renders title and meta", () => {
  const html = render(<TgRow title="my-session" meta="/Users/x/proj" onPress={() => {}} />);
  expect(html).toContain("my-session");
  expect(html).toContain("/Users/x/proj");
});

test("TgSection renders its title", () => {
  const html = render(<TgSection title="Online">{null}</TgSection>);
  expect(html).toContain("Online");
});