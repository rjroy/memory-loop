import { expect, test } from '@playwright/test';

const views = ['Ground', 'Capture', 'Think', 'Recall'] as const;

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test(`44W top navigation is horizontal above the workspace at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/ground');
    const nav = page.getByRole('navigation', { name: 'Primary' });
    const links = nav.getByRole('link');
    await expect(links).toHaveCount(4);
    expect(await links.allTextContents()).toEqual([...views]);
    const boxes = await Promise.all(views.map(name => nav.getByRole('link', { name }).boundingBox()));
    const navBox = await nav.boundingBox();
    const mainBox = await page.getByRole('main').boundingBox();
    expect(navBox).not.toBeNull();
    expect(mainBox).not.toBeNull();
    for (const box of boxes) expect(box).not.toBeNull();
    if (!navBox || !mainBox || boxes.some(box => box === null)) throw new Error('Expected visible navigation and workspace');
    const visibleBoxes = boxes.filter(box => box !== null);
    expect(navBox.y + navBox.height).toBeLessThanOrEqual(mainBox.y + 1);
    expect(mainBox.x).toBeLessThanOrEqual(visibleBoxes[0].x);
    for (let index = 1; index < visibleBoxes.length; index++) {
      expect(visibleBoxes[index].x).toBeGreaterThan(visibleBoxes[index - 1].x);
      expect(Math.max(visibleBoxes[index].y, visibleBoxes[0].y)).toBeLessThan(
        Math.min(visibleBoxes[index].y + visibleBoxes[index].height, visibleBoxes[0].y + visibleBoxes[0].height));
    }
    for (const [index, name] of views.entries()) {
      await expect(links.nth(index)).toHaveAttribute('href', `/${name.toLowerCase()}`);
    }
    await expect(nav.getByRole('link', { name: 'Ground' })).toHaveAttribute('aria-current', 'page');
    await nav.getByRole('link', { name: 'Capture' }).click();
    await expect(nav.getByRole('link', { name: 'Capture' })).toHaveAttribute('aria-current', 'page');
    await page.goBack();
    await expect(nav.getByRole('link', { name: 'Ground' })).toHaveAttribute('aria-current', 'page');
  });
}

test('declares a neutral favicon instead of requesting a missing icon', async ({ page }) => {
  const faviconRequests: string[] = [];
  page.on('request', request => {
    if (new URL(request.url()).pathname === '/favicon.ico') faviconRequests.push(request.url());
  });
  await page.goto('/ground');
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', 'data:,');
  expect(faviconRequests).toEqual([]);
});

test('root resolves without adding a history hop', async ({ page }) => {
  await page.route('**/preceding', route => route.fulfill({ contentType: 'text/html', body: '<title>Before</title><a href="/">Enter</a>' }));
  await page.goto('/preceding');
  await page.getByRole('link', { name: 'Enter' }).click();
  await expect(page).toHaveURL(/\/ground$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/preceding$/);
});

for (const name of views) {
  test(`${name} supports direct entry and refresh`, async ({ page }) => {
    const path = `/${name.toLowerCase()}`;
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name })).not.toBeFocused();
    await page.reload();
    await expect(page).toHaveURL(new RegExp(`${path}$`));
    await expect(page).toHaveTitle(`${name} · Memory Loop`);
  });
}

test('navigation preserves history, current-link no-op and focus', async ({ page }) => {
  await page.goto('/ground');
  const nav = page.getByRole('navigation', { name: 'Primary' });
  await nav.getByRole('link', { name: 'Capture' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Capture' })).toBeFocused();
  await nav.getByRole('link', { name: 'Capture' }).click();
  await nav.getByRole('link', { name: 'Think' }).click();
  await page.goBack();
  await expect(page).toHaveURL(/\/capture$/);
  await expect(page).toHaveTitle('Capture · Memory Loop');
  await expect(nav.getByRole('link', { name: 'Capture' })).toHaveAttribute('aria-current', 'page');
  await page.goBack();
  await expect(page).toHaveURL(/\/ground$/);
  await page.goForward();
  await expect(page).toHaveTitle('Capture · Memory Loop');
  await expect(nav.getByRole('link', { name: 'Capture' })).toHaveAttribute('aria-current', 'page');
  await expect(page.locator(':focus')).not.toHaveCount(0);
});

test('modified click opens a new tab without changing the current page', async ({ page, context }) => {
  await page.goto('/ground');
  const newPage = context.waitForEvent('page');
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Capture' }).click({ modifiers: ['Control'] });
  const tab = await newPage;
  await tab.waitForLoadState();
  await expect(tab).toHaveURL(/\/capture$/);
  await expect(page).toHaveURL(/\/ground$/);
});

test('unknown address offers recovery', async ({ page }) => {
  await page.goto('/unknown');
  await expect(page).toHaveTitle('Page not found · Memory Loop');
  await expect(page.getByRole('navigation', { name: 'Primary' }).locator('[aria-current="page"]')).toHaveCount(0);
  await page.getByRole('link', { name: 'Go to Ground' }).click();
  await expect(page).toHaveURL(/\/ground$/);
});

test('back restores scroll without a leave guard', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 600 });
  await page.goto('/ground');
  await page.evaluate(() => {
    const spacer = document.createElement('div');
    spacer.id = 'test-spacer';
    spacer.style.height = '3000px';
    document.body.append(spacer);
    window.scrollTo(0, 700);
  });
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(500);
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Capture' }).evaluate((link: HTMLElement) => link.click());
  await page.goBack();
  await expect(page).toHaveURL(/\/ground$/);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(500);
  await expect(page.locator(':focus')).not.toHaveCount(0);
});
