import AxeBuilder from '@axe-core/playwright';
import { expect, test } from './recall-fixture';
import { observeThinkResponses } from './think-response-observer';

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  for (const name of ['Ground', 'Capture', 'Think', 'Recall']) {
    test(`${name} is accessible at ${viewport.width}px without external services or storage`, async ({ page, baseURL }) => {
      if (!baseURL) throw new Error('The test preview origin is not configured');
      const allowedOrigin = new URL(baseURL).origin;
      await page.setViewportSize(viewport);
      const failures: string[] = [];
      const failedRequests: string[] = [];
      const groundRequests = new Set<string>();
      const groundPaths = new Set(['quick-actions', 'inspiration', 'prompts', 'goals', 'recent-captures', 'recent-conversations'].map(path => `/api/ground/${path}`));
      const responseObserver = observeThinkResponses(name === 'Think', allowedOrigin, failures);
      page.on('pageerror', error => failures.push(error.message));
      page.on('console', message => responseObserver.onConsole(message));
      page.on('response', response => responseObserver.onResponse(response));
      page.on('requestfailed', request => {
        const url = new URL(request.url());
        const detail = `${request.method()} ${url.pathname} ${request.failure()?.errorText ?? 'unknown'}`;
        failedRequests.push(detail);
        if (name === 'Think' && url.origin === allowedOrigin && url.pathname === '/api/think/conversations' && !url.search && request.method() === 'POST') failures.push(`Request failed: ${detail}`);
      });
      page.on('request', request => {
        const url = new URL(request.url());
        const groundRead = name === 'Ground' && groundPaths.has(url.pathname) && !url.search && request.method() === 'GET';
        const viewMetadata = !url.search && (url.pathname === '/api/think/views' && request.method() === 'POST' || url.pathname === '/api/think/selection' && ['GET', 'POST'].includes(request.method()));
        if (groundRead) groundRequests.add(url.pathname);
        if (url.origin !== allowedOrigin || (name !== 'Recall' && url.pathname.startsWith('/api/') && !groundRead && !viewMetadata && !(name === 'Think' && (url.pathname === '/api/think/conversations' || url.pathname.startsWith('/api/think/conversations/'))))) failures.push(request.url());
      });
      if (name === 'Think') await page.route('**/api/think/conversations', async route => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.origin !== allowedOrigin || url.pathname !== '/api/think/conversations' || url.search || request.method() !== 'POST') { await route.continue(); return; }
        await route.fulfill({ status: 503, json: { error: { code: 'think_unavailable', message: 'Think service is unavailable' } } });
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
      if (name === 'Think') {
        try { await expect.poll(() => responseObserver.createResponseSeen, { message: 'Expected Think create response was not observed' }).toBe(true); }
        catch (error) { throw new Error(`Think create response missing; failed requests: ${JSON.stringify(failedRequests)}`, { cause: error }); }
      }
      await responseObserver.waitForResponses();
      if (name === 'Think') {
        expect(responseObserver.expectedResponses).toBe(1);
        await expect.poll(() => responseObserver.expectedConsoleErrors > 0, { message: 'Expected Think create console error was not observed' }).toBe(true);
        expect(responseObserver.expectedConsoleErrors).toBe(1);
      }
      expect(failures).toEqual([]);
    });
  }
}
