import AxeBuilder from '@axe-core/playwright';
import { expect, test } from './recall-fixture';

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  for (const name of ['Ground', 'Capture', 'Think', 'Recall']) {
    test(`${name} is accessible at ${viewport.width}px without external services or storage`, async ({ page, baseURL }) => {
      if (!baseURL) throw new Error('The test preview origin is not configured');
      const allowedOrigin = new URL(baseURL).origin;
      await page.setViewportSize(viewport);
      const failures: string[] = [];
      const groundRequests = new Set<string>();
      const groundPaths = new Set(['quick-actions', 'inspiration', 'prompts', 'goals', 'recent-captures', 'recent-conversations'].map(path => `/api/ground/${path}`));
      let expectedConsoleErrors = 0;
      let expectedResponses = 0;
      const responseChecks: Promise<void>[] = [];
      page.on('pageerror', error => failures.push(error.message));
      page.on('console', message => {
        if (message.type() !== 'error') return;
        const location = message.location().url;
        const url = location ? new URL(location, allowedOrigin) : undefined;
        if (name === 'Think' && url?.origin === allowedOrigin && url.pathname === '/api/think/conversations' && !url.search &&
            message.text() === 'Failed to load resource: the server responded with a status of 503 (Service Unavailable)') expectedConsoleErrors++;
        else failures.push(message.text());
      });
      page.on('response', response => {
        if (name !== 'Think' || response.status() < 400) return;
        const url = new URL(response.url());
        responseChecks.push((async () => {
          try {
            const value: unknown = await response.json();
            if (url.origin === allowedOrigin && url.pathname === '/api/think/conversations' && !url.search && response.request().method() === 'POST' && response.status() === 503 &&
                typeof value === 'object' && value !== null && 'error' in value && typeof value.error === 'object' && value.error !== null && 'code' in value.error && value.error.code === 'think_unavailable') { expectedResponses++; return; }
          } catch { /* Unexpected or unreadable error responses remain failures. */ }
          failures.push('Unexpected Think HTTP error response');
        })());
      });
      page.on('request', request => {
        const url = new URL(request.url());
        const groundRead = name === 'Ground' && groundPaths.has(url.pathname) && !url.search && request.method() === 'GET';
        const viewMetadata = !url.search && (url.pathname === '/api/think/views' && request.method() === 'POST' || url.pathname === '/api/think/selection' && ['GET', 'POST'].includes(request.method()));
        if (groundRead) groundRequests.add(url.pathname);
        if (url.origin !== allowedOrigin || (name !== 'Recall' && url.pathname.startsWith('/api/') && !groundRead && !viewMetadata && !(name === 'Think' && (url.pathname === '/api/think/conversations' || url.pathname.startsWith('/api/think/conversations/'))))) failures.push(request.url());
      });
      await page.goto(`/${name.toLowerCase()}`);
      if (name === 'Think') await expect(page).toHaveURL(/\/think\?conversation=[0-9a-f-]{36}$/);
      await expect(page.getByRole('main')).toBeVisible();
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
      if (name === 'Recall') await expect(page.getByRole('navigation', { name: 'Vault files' }).getByRole('link', { name: 'alpha.md' })).toBeVisible();
      if (name === 'Ground') {
        for (const heading of ['Quick Actions', 'Inspiration', 'Prompts', 'Current Goals', 'Recent captures', 'Recent conversations']) await expect(page.getByRole('heading', { level: 2, name: heading })).toBeVisible();
        await expect.poll(() => groundRequests.size).toBe(groundPaths.size);
      }
      await expect(page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name })).toHaveAttribute('aria-current', 'page');
      await page.keyboard.press('Tab');
      await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(page.locator(':focus')).toHaveCount(1);
      const results = await new AxeBuilder({ page }).analyze();
      expect(results.violations).toEqual([]);
      if (name === 'Think') {
        await expect(page.getByText('Think is unavailable.')).toBeVisible();
        await expect(page.getByRole('textbox', { name: 'Message' })).toBeEditable();
        const saved = await page.evaluate(() => ({ local: Object.keys(localStorage), session: Object.keys(sessionStorage), current: sessionStorage.getItem('memory-loop.think.current'), selected: new URL(location.href).searchParams.get('conversation') }));
        expect(saved.local).toEqual([]);
        expect(saved.session).toEqual(['memory-loop.think.current']);
        expect(saved.current).toBe(saved.selected);
      } else expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      if (viewport.width < 896) {
        const main = await page.getByRole('main').boundingBox();
        const nav = await page.getByRole('navigation', { name: 'Primary' }).boundingBox();
        expect(main).not.toBeNull();
        expect(nav).not.toBeNull();
        if (main && nav && name !== 'Recall') {
          await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
          const last = page.getByRole('main').locator('p').last();
          const lastBox = await last.boundingBox();
          const navBox = await page.getByRole('navigation', { name: 'Primary' }).boundingBox();
          if (lastBox && navBox) expect(lastBox.y).toBeGreaterThanOrEqual(navBox.y + navBox.height - 1);
        }
      }
      await Promise.all(responseChecks);
      if (name === 'Think') { expect(expectedResponses).toBe(1); expect(expectedConsoleErrors).toBe(1); }
      expect(failures).toEqual([]);
    });
  }
}
