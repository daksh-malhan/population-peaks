// Regenerate the README images from a local build that has map data for HU, AT, CH, NL and IS:
//   npx vite build && node scripts/readme-images.ts
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, type Page } from '@playwright/test';
import { BASE, serve } from './static-server.ts';

const dist = resolve('dist');
const out = resolve('docs/images');
await mkdir(out, { recursive: true });
const { origin, server } = await serve(dist);
const browser = await chromium.launch();

const gallery = {
  v: 1,
  cards: [{ k: 'c', id: 'HU' }, { k: 't', id: '2761369', c: 'AT', r: 40 }, { k: 'c', id: 'CH' }, { k: 'c', id: 'NL' }],
};
const hash = `#s=${Buffer.from(JSON.stringify(gallery)).toString('base64url')}`;

async function ready(page: Page): Promise<void> {
  await page.waitForFunction(() => 'ready' in ((window as unknown as { __pp?: object }).__pp ?? {}));
  await page.evaluate(() => (window as unknown as { __pp: { ready: Promise<void> } }).__pp.ready);
}

async function image(page: Page, format: string, width?: number): Promise<Buffer> {
  const data = await page.evaluate(
    ([f, w]) => (window as unknown as { __pp: { image(f: string, m: string, q: number, w?: number): Promise<string> } }).__pp.image(f as string, 'image/jpeg', 0.86, w as number | undefined),
    [format, width] as const,
  );
  return Buffer.from(data.slice(data.indexOf(',') + 1), 'base64');
}

const desktop = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
await desktop.goto(`${origin}${BASE}${hash}`);
await ready(desktop);
await desktop.waitForTimeout(4000); // let the other cards load their previews
await desktop.screenshot({ path: `${out}/app-desktop.jpg`, type: 'jpeg', quality: 82 });
await writeFile(`${out}/poster-hungary.jpg`, await image(desktop, 'portrait'));

const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await mobile.goto(`${origin}${BASE}${hash}`);
await ready(mobile);
await mobile.waitForTimeout(1500);
await mobile.screenshot({ path: `${out}/app-mobile.jpg`, type: 'jpeg', quality: 82 });

for (const id of ['nl', 'ch', 'is']) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(`${origin}${BASE}p/${id}/`);
  await ready(page);
  await writeFile(`${out}/poster-${id}.jpg`, await image(page, 'portrait', 540));
  await page.close();
}

await browser.close();
server.close();
console.log(`README images written to ${out}`);
