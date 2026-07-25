import { readFileSync, existsSync } from "node:fs";
import { join, normalize } from "node:path";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
};

/** Serve a built SPA from distDir. Returns null for unsafe/traversal paths so
 * the caller can 404. Unknown valid paths fall back to index.html (SPA routing). */
export function serveStatic(distDir: string): (req: Request) => Response | null {
  return (req: Request): Response | null => {
    const u = new URL(req.url);
    let rel = decodeURIComponent(u.pathname);
    if (rel.includes("..")) return null;                    // ponytail: refuse traversal outright
    if (rel === "/" || rel === "") rel = "/index.html";
    const safe = normalize(join(distDir, rel));
    if (!safe.startsWith(distDir)) return null;             // resolved outside dist
    if (existsSync(safe) && !safe.endsWith("/")) {
      const ext = safe.slice(safe.lastIndexOf("."));
      return new Response(readFileSync(safe), { headers: { "content-type": MIME[ext] ?? "application/octet-stream" } });
    }
    // SPA fallback
    const idx = join(distDir, "index.html");
    if (existsSync(idx)) return new Response(readFileSync(idx), { headers: { "content-type": "text/html; charset=utf-8" } });
    return null;
  };
}