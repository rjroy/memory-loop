import AxeBuilder from '@axe-core/playwright';
import { expect, test } from './recall-fixture';

function noteUrl(origin: string, id: string[]): string {
  return `${origin}/recall?${new URLSearchParams({ file: JSON.stringify(id) })}`;
}

test('desktop Files is visible, toggleable, and note history survives direct entry and refresh', async ({ page, recallOrigin }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${recallOrigin}/recall`);
  const files = page.getByRole('navigation', { name: 'Vault files' });
  await expect(files).toBeVisible();
  await page.getByRole('button', { name: 'Hide files' }).click();
  await expect(files).toBeHidden();
  await page.getByRole('button', { name: 'Show files' }).click();
  await expect(files).toBeVisible();
  await files.getByRole('link', { name: 'alpha.md' }).click();
  await expect(page).toHaveURL(noteUrl(recallOrigin, ['alpha.md']));
  await expect(page.getByRole('article')).toContainText('Alpha fixture body.');
  await expect(page).toHaveTitle('alpha.md · Recall · Memory Loop');
  await page.reload();
  await expect(page.getByRole('article')).toContainText('Alpha fixture body.');
  await files.getByRole('button', { name: 'folder' }).click();
  await files.getByRole('link', { name: 'beta.md' }).click();
  await expect(page).toHaveURL(noteUrl(recallOrigin, ['folder', 'beta.md']));
  await expect(page.getByRole('article')).toContainText('Beta fixture body.');
  await page.goBack();
  await expect(page).toHaveURL(noteUrl(recallOrigin, ['alpha.md']));
  await expect(page.getByRole('article')).toContainText('Alpha fixture body.');
  await page.goForward();
  await expect(page.getByRole('article')).toContainText('Beta fixture body.');
  await expect(page.getByRole('heading', { level: 1, name: 'Recall' })).not.toBeFocused();
});

test('phone Files fills the workspace, selection reveals reader, and reopening restores focus without trapping navigation', async ({ page, recallOrigin }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${recallOrigin}/recall`);
  const files = page.getByRole('navigation', { name: 'Vault files' });
  const primary = page.getByRole('navigation', { name: 'Primary' });
  await expect(files).toBeVisible();
  await expect(primary.getByRole('link', { name: 'Capture' })).toBeVisible();
  const filesBox = await files.boundingBox();
  const navBox = await primary.boundingBox();
  expect(filesBox).not.toBeNull();
  expect(navBox).not.toBeNull();
  if (filesBox && navBox) {
    expect(filesBox.width).toBeGreaterThan(350);
    expect(filesBox.y + filesBox.height).toBeLessThanOrEqual(navBox.y + 1);
  }
  await files.getByRole('link', { name: 'alpha.md' }).click();
  await expect(files).toBeHidden();
  await expect(page.getByRole('article')).toContainText('Alpha fixture body.');
  await expect(page.locator(':focus')).toHaveText('alpha.md');
  await page.getByRole('button', { name: 'Open files' }).click();
  await expect(files).toBeVisible();
  await expect(files.getByRole('link', { name: 'alpha.md' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(files).toBeHidden();
  await expect(page.getByRole('button', { name: 'Open files' })).toBeFocused();
});

test('modified note link opens a new tab without changing the current phone mode', async ({ page, context, recallOrigin }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${recallOrigin}/recall`);
  const files = page.getByRole('navigation', { name: 'Vault files' });
  const newPage = context.waitForEvent('page');
  await files.getByRole('link', { name: 'alpha.md' }).click({ modifiers: ['Control'] });
  const tab = await newPage;
  await tab.waitForLoadState();
  await expect(tab).toHaveURL(noteUrl(recallOrigin, ['alpha.md']));
  await expect(page).toHaveURL(`${recallOrigin}/recall`);
  await expect(files).toBeVisible();
  await tab.close();
});

test('a late A response cannot replace the selected B document or move focus', async ({ page, recallOrigin }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  let releaseA: () => void = () => {};
  let startedA: () => void = () => {};
  let finishedA: () => void = () => {};
  const started = new Promise<void>(resolve => { startedA = resolve; });
  const finished = new Promise<void>(resolve => { finishedA = resolve; });
  const held = new Promise<void>(resolve => { releaseA = resolve; });
  await page.route('**/api/vault/note?*', async route => {
    const id = new URL(route.request().url()).searchParams.get('id');
    if (id === JSON.stringify(['alpha.md'])) {
      startedA();
      await held;
      try { await route.fulfill({ json: { name: 'alpha.md', markdown: 'Late alpha body' } }); }
      catch { /* A superseded request may be cancelled. */ }
      finally { finishedA(); }
    } else await route.continue();
  });
  try {
    await page.goto(`${recallOrigin}/recall`);
    const files = page.getByRole('navigation', { name: 'Vault files' });
    await files.getByRole('link', { name: 'alpha.md' }).click();
    await started;
    await files.getByRole('button', { name: 'folder' }).click();
    await files.getByRole('link', { name: 'beta.md' }).click();
    await expect(page.getByRole('article')).toContainText('Beta fixture body.');
    await expect(page.locator(':focus')).toHaveText('beta.md');
    releaseA();
    await finished;
    await expect(page.getByRole('article')).toContainText('Beta fixture body.');
    await expect(page.getByRole('article')).not.toContainText('Late alpha body');
    await expect(page.locator(':focus')).toHaveText('beta.md');
  } finally { releaseA(); }
});

test('hostile Markdown stays inert and sends no media or external requests', async ({ page, recallOrigin }) => {
  const external: string[] = [];
  const media: string[] = [];
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.origin !== recallOrigin) external.push(request.url());
    if (url.pathname.includes('local-sentinel.png') || url.pathname.includes('remote-sentinel')) media.push(request.url());
  });
  await page.goto(noteUrl(recallOrigin, ['danger.md']));
  const article = page.getByRole('article');
  await expect(article).toContainText('Source heading');
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  await expect(article.getByRole('heading', { level: 2, name: 'Source heading' })).toBeVisible();
  await expect(article.locator('img, script')).toHaveCount(0);
  await expect(article.locator('a[href^="javascript:"], a[href^="//"]')).toHaveCount(0);
  await expect(article.getByText('Image not shown: test image')).toBeVisible();
  await expect(article.getByRole('checkbox')).toBeDisabled();
  await expect(article.getByRole('link', { name: /web/ })).toHaveAttribute('target', '_blank');
  expect(await page.evaluate(() => Reflect.get(window, 'recallScriptRan'))).toBeUndefined();
  expect(external).toEqual([]);
  expect(media).toEqual([]);
});

for (const [code, heading] of [
  ['config_missing', 'Vault not configured'],
  ['config_invalid', 'Vault configuration is invalid'],
  ['vault_unavailable', 'Vault unavailable'],
] as const) {
  test(`shows ${code} as an honest structured error`, async ({ page, recallOrigin }) => {
    await page.route('**/api/vault/tree', route => route.fulfill({ status: 503, json: { error: { code, message: 'fixture internal detail' } } }));
    await page.goto(`${recallOrigin}/recall`);
    await expect(page.getByText(heading, { exact: true })).toBeVisible();
    await expect(page.getByText('fixture internal detail')).toHaveCount(0);
    await expect(page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Ground' })).toBeVisible();
  });
}

test('distinguishes empty tree, empty note, and transport failure', async ({ page, recallOrigin }) => {
  await page.route('**/api/vault/tree', route => route.fulfill({ json: { entries: [] } }));
  await page.goto(`${recallOrigin}/recall`);
  await expect(page.getByRole('heading', { name: 'No Markdown notes to show', exact: true })).toBeVisible();
  await page.unroute('**/api/vault/tree');
  await page.goto(noteUrl(recallOrigin, ['empty.md']));
  await expect(page.getByText('This note is empty.')).toBeVisible();
  await page.route('**/api/vault/tree', route => route.abort('failed'));
  await page.goto(`${recallOrigin}/recall`);
  await expect(page.getByRole('heading', { name: 'Vault service unavailable', exact: true })).toBeVisible();
});

test('direct unavailable and malformed note URLs do not show another note', async ({ page, recallOrigin }) => {
  await page.goto(noteUrl(recallOrigin, ['missing.md']));
  await expect(page.getByText('Note unavailable', { exact: true })).toBeVisible();
  await expect(page.getByRole('main')).not.toContainText('Alpha fixture body.');
  await page.goto(`${recallOrigin}/recall?file=${encodeURIComponent('["..","secret.md"]')}`);
  await expect(page.getByText('Note address is invalid', { exact: true })).toBeVisible();
  await expect(page.getByRole('main')).not.toContainText('Alpha fixture body.');
});

test('RECALL-UI-001: returning to Recall restores the selected reader scroll after its note reloads', async ({ page, recallOrigin }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(noteUrl(recallOrigin, ['danger.md']));
  await expect(page.getByRole('article')).toContainText('Paragraph 59');
  const reader = page.getByRole('region', { name: 'Note reader' });
  await reader.evaluate(element => new Promise<void>(resolve => {
    element.addEventListener('scroll', () => resolve(), { once: true });
    element.scrollTop = 1000;
  }));
  await expect.poll(() => reader.evaluate(element => element.scrollTop)).toBeGreaterThan(900);
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Capture' }).click();
  await expect(page).toHaveURL(`${recallOrigin}/capture`);
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Recall' }).click();
  await expect(page).toHaveURL(noteUrl(recallOrigin, ['danger.md']));
  await expect(page.getByRole('article')).toContainText('Paragraph 59');
  await expect.poll(() => reader.evaluate(element => element.scrollTop)).toBeGreaterThan(900);
});

test('RECALL-UI-002: Files restores its scroll only after delayed hierarchy content is ready', async ({ page, recallOrigin }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const entries = Array.from({ length: 100 }, (_, index) => {
    const name = `fixture-${String(index).padStart(3, '0')}.md`;
    return { kind: 'note', name, id: [name] };
  });
  let calls = 0;
  let releaseTree: () => void = () => {};
  let startTree: () => void = () => {};
  const loading = new Promise<void>(resolve => { startTree = resolve; });
  const held = new Promise<void>(resolve => { releaseTree = resolve; });
  await page.route('**/api/vault/tree', async route => {
    calls++;
    if (calls > 1) { startTree(); await held; }
    await route.fulfill({ json: { entries } }).catch(() => {});
  });
  try {
    await page.goto(`${recallOrigin}/recall`);
    const files = page.getByRole('navigation', { name: 'Vault files' });
    await expect(files.getByRole('link', { name: 'fixture-099.md' })).toBeAttached();
    await files.evaluate(element => new Promise<void>(resolve => {
      element.addEventListener('scroll', () => resolve(), { once: true });
      element.scrollTop = 1000;
    }));
    await expect.poll(() => files.evaluate(element => element.scrollTop)).toBeGreaterThan(900);
    await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Capture' }).click();
    await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Recall' }).click();
    await loading;
    await expect(files).toHaveAttribute('aria-busy', 'true');
    releaseTree();
    await expect(files.getByRole('link', { name: 'fixture-099.md' })).toBeAttached();
    await expect(files).toHaveAttribute('aria-busy', 'false');
    await expect.poll(() => files.evaluate(element => element.scrollTop)).toBeGreaterThan(900);
  } finally { releaseTree(); }
});

test('RECALL-UI-003: Skip to content does not close open mobile Files for a selected note', async ({ page, recallOrigin }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${recallOrigin}/recall`);
  const files = page.getByRole('navigation', { name: 'Vault files' });
  await files.getByRole('link', { name: 'alpha.md' }).click();
  await expect(page).toHaveURL(noteUrl(recallOrigin, ['alpha.md']));
  await expect(page.getByRole('article')).toContainText('Alpha fixture body.');
  await page.getByRole('button', { name: 'Open files' }).click();
  await expect(files).toBeVisible();
  const skip = page.getByRole('link', { name: 'Skip to content' });
  await skip.focus();
  await page.evaluate(() => {
    window.addEventListener('hashchange', () => {
      requestAnimationFrame(() => requestAnimationFrame(() => { document.body.dataset.testHashSettled = 'yes'; }));
    }, { once: true });
  });
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#main-content$/);
  await page.waitForFunction(() => document.body.dataset.testHashSettled === 'yes');
  await expect(files).toBeVisible();
  await expect(page.locator(':focus')).toHaveAttribute('id', 'main-content');
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 320, height: 568 }, { width: 844, height: 390 }]) {
  test(`Recall reading reflows and passes axe at ${viewport.width}×${viewport.height}`, async ({ page, recallOrigin }) => {
    await page.setViewportSize(viewport);
    await page.goto(noteUrl(recallOrigin, ['danger.md']));
    await expect(page.getByRole('article')).toContainText('Source heading');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
  });
}
