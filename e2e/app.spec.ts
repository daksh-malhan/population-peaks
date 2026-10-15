import { readFile } from 'node:fs/promises';
import { addPlace, expect, litPixels, ready, shareHash, test } from './helpers';

test('first visit draws a place, continuous across the antimeridian', async ({ page }) => {
  await page.goto('./');
  await ready(page);
  await expect(page.locator('.stage-title')).toHaveText("Dateland's population distribution");
  await expect(page.locator('.stage-stats')).toContainText(/≈ 6\d\d,\d00 people/);
  expect(await litPixels(page)).toBeGreaterThan(400);
  await expect(page.locator('canvas.stage-canvas')).toHaveAttribute('aria-label', /3D population map of Dateland/);
});

test('search adds a country, a state and a tiny place', async ({ page }) => {
  await page.goto('./');
  await ready(page);
  await addPlace(page, 'testland', /Testland/);
  await expect(page.locator('.stage-title')).toHaveText("Testland's population distribution");
  await expect(page.locator('.stage-stats')).toContainText('≈ 3.3M people');
  await expect(page.locator('.stage-stats')).toContainText('near Capital City');
  await addPlace(page, 'nordland', /North Testland/);
  await expect(page.locator('.stage-stats')).toContainText('≈ 2.6M people');
  await addPlace(page, 'microland', /Microland/);
  await expect(page.locator('.stage-subtitle')).toHaveText('Shown with 10 km of its surroundings');
  await expect(page.locator('.gallery .card:not(.card-add)')).toHaveCount(4);
});

test('a city is a circle whose radius can change', async ({ page }) => {
  await page.goto('./');
  await ready(page);
  await addPlace(page, 'capital city', /Capital City/);
  await expect(page.locator('.stage-subtitle')).toHaveText('Within 40 km of the centre');
  await page.locator('#radius').fill('20');
  await expect(page.locator('.stage-subtitle')).toHaveText('Within 20 km of the centre');
  await expect(page.locator('.gallery .card-active')).toContainText('Capital City');
});

test('exports a 1080×1350 PNG poster', async ({ page }) => {
  await page.goto('./');
  await ready(page);
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export poster' }).click()]);
  expect(download.suggestedFilename()).toBe('dateland-population-portrait.png');
  const png = await readFile((await download.path())!);
  expect(png.subarray(1, 4).toString()).toBe('PNG');
  expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1080, 1350]);
  await expect(page.getByRole('status').filter({ hasText: 'Poster saved' })).toBeVisible();
});

test('a share link reopens the same gallery and settings', async ({ page, context }) => {
  await page.goto('./');
  await ready(page);
  await addPlace(page, 'testland', /Testland/);
  await page.getByText('Gold', { exact: true }).click();
  await page.getByLabel('Title', { exact: true }).fill('Testland, seen from above');
  await page.waitForFunction(() => location.hash.length > 10);
  await page.waitForTimeout(400);
  const url = page.url();

  const other = await context.newPage();
  await other.goto(url);
  await ready(other);
  await expect(other.locator('.stage-title')).toHaveText('Testland, seen from above');
  await expect(other.locator('.gallery .card:not(.card-add)')).toHaveCount(2);
  await expect(other.locator('input[name="palette"][value="gold"]')).toBeChecked();
});

test('a damaged link is ignored with a message', async ({ page }) => {
  await page.goto('./#s=%%%not-a-link');
  await expect(page.getByRole('status').filter({ hasText: 'This link is damaged' })).toBeVisible();
  await ready(page);
  await expect(page.locator('.stage-title')).toHaveText("Dateland's population distribution");
});

test('text from a link is shown as text, never as markup', async ({ page }) => {
  const evil = '<img src=x onerror=alert(1)> & <script>alert(2)</script>';
  await page.goto(`./${shareHash({ v: 1, cards: [{ k: 'c', id: 'ZZ', ti: evil, st: '<b>bold</b>' }], au: '<svg onload=alert(3)>' })}`);
  await ready(page);
  const title = page.locator('.stage-title');
  await expect(title).toHaveText(evil);
  expect(await title.evaluate((el) => el.children.length)).toBe(0);
  await expect(page.locator('img[src="x"], .stage script, svg[onload]')).toHaveCount(0);
  await expect(page.locator('.stage-subtitle')).toHaveText('<b>bold</b>');
});

test('cards from an unknown country are skipped with a message', async ({ page }) => {
  await page.goto(`./${shareHash({ v: 1, cards: [{ k: 'c', id: 'QQ' }, { k: 'c', id: 'ZZ' }] })}`);
  await expect(page.getByRole('status').filter({ hasText: 'not in the map data' })).toBeVisible();
  await ready(page);
  await expect(page.locator('.stage-title')).toHaveText("Testland's population distribution");
});

test('the map survives a lost graphics context', async ({ page }) => {
  await page.goto('./');
  await ready(page);
  await page.evaluate(async () => {
    const ext = (window as unknown as { __pp: { loseContext(): WEBGL_lose_context | null } }).__pp.loseContext();
    ext?.loseContext();
    await new Promise((r) => setTimeout(r, 300));
    ext?.restoreContext();
    await new Promise((r) => setTimeout(r, 800));
  });
  expect(await litPixels(page)).toBeGreaterThan(400);
});

test('the page has the security policy and no third-party requests', async ({ page }) => {
  const origins = new Set<string>();
  page.on('request', (r) => origins.add(new URL(r.url()).origin));
  await page.goto('./');
  await ready(page);
  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  expect(csp).toContain("default-src 'none'");
  expect([...origins]).toEqual([new URL(page.url()).origin]);
});

test('the gallery is keyboard operable and keeps focus while cards load', async ({ page }) => {
  await page.goto('./');
  await ready(page);
  // Hold Testland's file, so its card finishes loading (and the gallery updates) while another card has focus.
  let release = (): void => {};
  const held = new Promise<void>((r) => (release = () => r()));
  await page.route('**/places/ZZ.json', async (route) => {
    await held;
    await route.continue();
  });
  await addPlace(page, 'testland', /Testland/);
  const cards = page.locator('.gallery .card:not(.card-add)');
  await cards.first().focus();
  await page.keyboard.press('Enter');
  await expect(cards.first()).toHaveAttribute('aria-current', 'true');
  await expect(cards.nth(1)).toContainText('Loading');
  const remove = page.getByRole('button', { name: 'Remove Dateland' });
  await remove.focus();
  release();
  await expect(cards.nth(1)).toContainText('people');
  await expect(remove).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(cards).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Remove Testland' })).toBeFocused();
});
