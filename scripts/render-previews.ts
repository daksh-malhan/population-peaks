// Data workflow step: render a link preview (1200x630) and a small fallback poster per country.
//   node scripts/render-previews.ts --dist dist [--only HU,AT] [--concurrency 2] [--software]
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { chromium } from '@playwright/test';

const { values } = parseArgs({
  options: {
    dist: { type: 'string', default: 'dist' },
    only: { type: 'string' },
    concurrency: { type: 'string', default: '2' },
    software: { type: 'boolean', default: false },
  },
});
const dist = resolve(values.dist!);
const base = '/population-peaks/';
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.bin': 'application/octet-stream',
};

// A minimal static server for the built site (no directory listings, no paths outside dist).
const server = createServer((req, res) => {
  void (async () => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (!url.pathname.startsWith(base)) return void res.writeHead(404).end();
    let rel = decodeURIComponent(url.pathname.slice(base.length));
    // /p/<id>/ pages are generated after previews; the app shell serves them the same way.
    if (/^p\/[a-z]{2,3}\/$/.test(rel)) rel = '';
    if (rel === '' || rel.endsWith('/')) rel += 'index.html';
    const file = normalize(join(dist, rel));
    if (!file.startsWith(dist)) return void res.writeHead(403).end();
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(body);
    } catch {
      res.writeHead(404).end();
    }
  })();
});
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
const port = (server.address() as { port: number }).port;

const manifestPath = join(dist, 'data', 'manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { countries: { id: string; preview: boolean }[] };
const only = values.only ? new Set(values.only.split(',').map((s) => s.trim().toUpperCase())) : null;
const queue = manifest.countries.map((c) => c.id).filter((id) => !only || only.has(id));
const total = queue.length;
const out = join(dist, 'data', 'previews');
await mkdir(join(out, 'og'), { recursive: true });
await mkdir(join(out, 'poster'), { recursive: true });

const browser = await chromium.launch({ args: values.software ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : [] });
const done = new Set<string>();
const failed: string[] = [];

async function render(id: string): Promise<void> {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
  try {
    await page.goto(`http://127.0.0.1:${port}${base}p/${id.toLowerCase()}/`, { timeout: 60_000 });
    await page.waitForFunction(() => 'ready' in ((window as unknown as { __pp?: object }).__pp ?? {}), null, { timeout: 60_000 });
    const shots = await page.evaluate(async () => {
      const pp = (window as unknown as { __pp: { ready: Promise<void>; image(f: string, m: string, q: number, w?: number): Promise<string> } }).__pp;
      await pp.ready;
      return [await pp.image('og', 'image/jpeg', 0.82), await pp.image('portrait', 'image/jpeg', 0.8, 540)];
    });
    const [og, poster] = shots.map((d) => Buffer.from(d.slice(d.indexOf(',') + 1), 'base64'));
    await writeFile(join(out, 'og', `${id}.jpg`), og!);
    await writeFile(join(out, 'poster', `${id}.jpg`), poster!);
    done.add(id);
    console.log(`  ${id} ✓ (${done.size}/${total})`);
  } catch (e) {
    failed.push(id);
    console.warn(`  ${id} failed: ${(e as Error).message.split('\n')[0]}`);
  } finally {
    await page.close();
  }
}

const workers = Array.from({ length: Math.max(1, Number(values.concurrency)) }, async () => {
  for (let id = queue.shift(); id; id = queue.shift()) await render(id);
});
await Promise.all(workers);
await browser.close();
server.close();

for (const c of manifest.countries) c.preview = c.preview || done.has(c.id);
await writeFile(manifestPath, JSON.stringify(manifest));
console.log(`previews: ${done.size} rendered, ${failed.length} failed${failed.length ? ` (${failed.join(', ')})` : ''}`);
