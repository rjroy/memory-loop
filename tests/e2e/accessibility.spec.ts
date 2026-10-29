import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  for (const name of ['Ground', 'Capture', 'Think', 'Recall']) {
    test(`${name} is accessible at ${viewport.width}px without external services or storage`, async ({ page }) => {
      await page.setViewportSize(viewport);
      const failures: string[] = [];
      page.on('pageerror', error => failures.push(error.message));
      page.on('console', message => { if (message.type() === 'error') failures.push(message.text()); });
      page.on('request', request => {
        const url = new URL(request.url());
        if (url.origin !== 'http://127.0.0.1:4173' || url.pathname.startsWith('/api/')) failures.push(request.url());
      });
      await page.goto(`/${name.toLowerCase()}`);
      await expect(page.getByRole('main')).toBeVisible();
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
      await expect(page.getByRole('navigation').getByRole('link', { name })).toHaveAttribute('aria-current', 'page');
      await page.keyboard.press('Tab');
      await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(page.locator(':focus')).toHaveCount(1);
      const results = await new AxeBuilder({ page }).analyze();
      expect(results.violations).toEqual([]);
      expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      if (viewport.width < 896) {
        const main = await page.getByRole('main').boundingBox();
        const nav = await page.getByRole('navigation').boundingBox();
        expect(main).not.toBeNull();
        expect(nav).not.toBeNull();
        if (main && nav) {
          await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
          const last = page.getByRole('main').locator('p').last();
          const lastBox = await last.boundingBox();
          const navBox = await page.getByRole('navigation').boundingBox();
          if (lastBox && navBox) expect(lastBox.y + lastBox.height).toBeLessThanOrEqual(navBox.y);
        }
      }
      expect(failures).toEqual([]);
    });
  }
}
