#!/usr/bin/env node
/**
 * Local preview server for the demo page.
 *
 *   node apps/demo-ui/serve.ts [port]
 *
 * A convenience, not a service. It binds 127.0.0.1 only, answers GET and HEAD
 * only, serves a fixed set of static extensions from `apps/demo-ui/public`, and
 * has no route that writes anything. Nothing installs it, nothing supervises it,
 * and it is not part of the deployment story.
 *
 * The page also opens directly from the filesystem — the evidence travels as a
 * classic script rather than a fetch precisely so that works:
 *
 *   file:///…/apps/demo-ui/public/index.html
 *
 * Use this server when you want the page under an http:// origin (for example
 * to exercise the asynchronous clipboard API).
 */
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, normalize, extname, dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), "public");
const HOST = "127.0.0.1";
const DEFAULT_PORT = 4408;

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

/** Maps a request path to an absolute file inside PUBLIC_DIR, or null. */
export function resolveStaticPath(urlPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath.split("?")[0].split("#")[0]);
  } catch {
    return null;
  }
  if (decoded.includes("\0")) return null;
  if (decoded === "/" || decoded === "") decoded = "/index.html";

  const target = resolve(join(PUBLIC_DIR, normalize(decoded)));
  if (target !== PUBLIC_DIR && !target.startsWith(PUBLIC_DIR + sep)) return null;
  if (!Object.prototype.hasOwnProperty.call(TYPES, extname(target).toLowerCase())) return null;
  return target;
}

function main(): void {
  const port = Number(process.argv[2] ?? DEFAULT_PORT);

  const server = createServer((req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { "content-type": "text/plain; charset=utf-8", allow: "GET, HEAD" });
      res.end("this preview server is read-only\n");
      return;
    }

    const file = resolveStaticPath(req.url ?? "/");
    if (!file) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("not found\n");
      return;
    }

    void (async () => {
      try {
        const info = await stat(file);
        if (!info.isFile()) throw new Error("not a file");
        const body = await readFile(file);
        res.writeHead(200, {
          "content-type": TYPES[extname(file).toLowerCase()],
          "content-length": String(body.byteLength),
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
          "referrer-policy": "no-referrer",
        });
        res.end(req.method === "HEAD" ? undefined : body);
      } catch {
        res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        res.end("not found\n");
      }
    })();
  });

  server.listen(port, HOST, () => {
    console.log(`demo-ui preview: http://${HOST}:${port}/  (read-only, ${PUBLIC_DIR})`);
    console.log("stop with Ctrl-C");
  });
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main();
}
