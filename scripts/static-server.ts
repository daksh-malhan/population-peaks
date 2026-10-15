// Minimal static server for the built site at /population-peaks/ (no listings, no paths outside dist).
import { readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { extname, join, normalize } from 'node:path';

export const BASE = '/population-peaks/';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.bin': 'application/octet-stream',
};

export async function serve(dist: string): Promise<{ origin: string; server: Server }> {
  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (!url.pathname.startsWith(BASE)) return void res.writeHead(404).end();
      let rel = decodeURIComponent(url.pathname.slice(BASE.length));
      // /p/<id>/ pages are generated at deploy time; the app shell serves them the same way.
      if (/^p\/[a-z]{2,3}\/$/.test(rel)) rel = '';
      if (rel === '' || rel.endsWith('/')) rel += 'index.html';
      const file = normalize(join(dist, rel));
      if (!file.startsWith(dist)) return void res.writeHead(403).end();
      try {
        res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(await readFile(file));
      } catch {
        res.writeHead(404).end();
      }
    })();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return { origin: `http://127.0.0.1:${(server.address() as { port: number }).port}`, server };
}
