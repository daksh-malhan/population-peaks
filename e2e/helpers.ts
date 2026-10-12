import { expect, type Page, test as base } from '@playwright/test';

/** Every test fails on console errors, CSP violations, uncaught exceptions or unexpected dialogs. */
export const test = base.extend<{ problems: string[] }>({
  problems: [
    async ({ page }, use) => {
      const problems: string[] = [];
      page.on('console', (m) => {
        if (m.type() === 'error') problems.push(`console: ${m.text()}`);
      });
      page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
      page.on('dialog', (d) => {
        problems.push(`dialog: ${d.message()}`);
        void d.dismiss();
      });
      await use(problems);
      expect(problems).toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

export async function ready(page: Page): Promise<void> {
  await page.waitForFunction(() => 'ready' in ((window as unknown as { __pp?: object }).__pp ?? {}));
  await page.evaluate(() => (window as unknown as { __pp: { ready: Promise<void> } }).__pp.ready);
}

/** Render a poster in the page and count lit (non-background) pixels, to prove the map was drawn. */
export async function litPixels(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const pp = (window as unknown as { __pp: { poster(f: string): Promise<string> } }).__pp;
    const img = new Image();
    img.src = await pp.poster('portrait');
    await img.decode();
    const c = document.createElement('canvas');
    c.width = 270;
    c.height = 337;
    const g = c.getContext('2d')!;
    g.drawImage(img, 0, 0, 270, 337);
    const d = g.getImageData(0, 54, 270, 230).data;
    let lit = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i]! > 90 && d[i]! > d[i + 1]! * 1.3) lit++;
    return lit;
  });
}

export function shareHash(state: unknown): string {
  return `#s=${Buffer.from(JSON.stringify(state)).toString('base64url')}`;
}

export async function addPlace(page: Page, query: string, option: RegExp): Promise<void> {
  const box = page.getByRole('combobox', { name: 'Search a country, state or city' });
  await box.fill(query);
  await page.getByRole('option', { name: option }).first().click();
}
