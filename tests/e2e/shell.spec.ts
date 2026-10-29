import { expect, test } from '@playwright/test';

const views = ['Ground', 'Capture', 'Think', 'Recall'] as const;

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
  const nav = page.getByRole('navigation');
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
  await page.getByRole('navigation').getByRole('link', { name: 'Capture' }).click({ modifiers: ['Control'] });
  const tab = await newPage;
  await tab.waitForLoadState();
  await expect(tab).toHaveURL(/\/capture$/);
  await expect(page).toHaveURL(/\/ground$/);
});

test('unknown address offers recovery', async ({ page }) => {
  await page.goto('/unknown');
  await expect(page).toHaveTitle('Page not found · Memory Loop');
  await expect(page.getByRole('navigation').locator('[aria-current="page"]')).toHaveCount(0);
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
  await page.getByRole('navigation').getByRole('link', { name: 'Capture' }).evaluate((link: HTMLElement) => link.click());
  await page.goBack();
  await expect(page).toHaveURL(/\/ground$/);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(500);
  await expect(page.locator(':focus')).not.toHaveCount(0);
});
