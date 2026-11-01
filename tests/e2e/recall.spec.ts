import AxeBuilder from '@axe-core/playwright';
import { expect, fixtureToken, test } from './recall-fixture';

function noteUrl(origin: string, id: string[]): string {
  return `${origin}/recall?${new URLSearchParams({ file: JSON.stringify(id) })}`;
}

test('fixture service credential never reaches browser HTML, RSC, assets, requests or storage', async ({ page, recallOrigin }) => {
  const observed: Promise<string>[] = [];
  const requestHeaders: string[] = [];
  page.on('request', request => { requestHeaders.push(JSON.stringify(request.headers())); });
  page.on('response', response => {
    const type = response.headers()['content-type'] ?? '';
    if (/text\/|json|javascript|component/i.test(type)) {
      observed.push(response.text().catch(() => ''));
    }
  });
  await page.goto(`${recallOrigin}/recall`);
  await page.getByRole('navigation', { name: 'Vault files' }).getByRole('link', { name: 'alpha.md' }).click();
  await expect(page.getByRole('article')).toContainText('Alpha fixture body.');
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Capture' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Capture' })).toBeVisible();
  const browserState = await page.evaluate(() => JSON.stringify({ html: document.documentElement.outerHTML, local: { ...localStorage }, session: { ...sessionStorage } }));
  expect([browserState, ...requestHeaders, ...await Promise.all(observed)].join('\n')).not.toContain(fixtureToken);
});

test('44W-T1: Files controls and primary destinations remain operable at 200% text in short landscape', async ({ page, recallOrigin }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto(noteUrl(recallOrigin, ['alpha.md']));
  await expect(page.getByRole('article')).toContainText('Alpha fixture body.');
  await page.addStyleTag({ content: ':root { font-size: 200% !important; }' });
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe('32px');
  const expand = page.getByRole('button', { name: 'Expand files sidebar' });
  const isUnobscured = (element: Element) => {
    const box = element.getBoundingClientRect();
    const x = box.left + box.width / 2;
    const y = box.top + box.height / 2;
    if (box.width <= 0 || box.height <= 0 || x < 0 || x >= innerWidth || y < 0 || y >= innerHeight) return false;
    const hit = document.elementFromPoint(x, y);
    return !!hit && element.contains(hit);
  };
  for (let index = 0; index < 16 && !(await expand.evaluate(element => element === document.activeElement)); index++) {
    await page.keyboard.press('Tab');
  }
  await expect(expand).toBeFocused();
  await expect.poll(() => expand.evaluate(isUnobscured)).toBe(true);
  await page.keyboard.press('Enter');
  const collapse = page.getByRole('button', { name: 'Collapse files sidebar' });
  await expect(collapse).toBeVisible();
  await collapse.focus();
  await expect(collapse).toBeFocused();
  await expect.poll(() => collapse.evaluate(isUnobscured)).toBe(true);
  const nav = page.getByRole('navigation', { name: 'Primary' });
  for (const name of ['Ground', 'Capture', 'Think', 'Recall']) {
    const link = nav.getByRole('link', { name });
    await link.scrollIntoViewIfNeeded();
    await expect(link).toBeVisible();
    await expect.poll(() => link.evaluate(isUnobscured)).toBe(true);
  }
  await collapse.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('article')).toContainText('Alpha fixture body.');
});

test('MS4-R1: reopened Files reveals the focused current row below its sticky header', async ({ page, recallOrigin }) => {
  const entries = Array.from({ length: 100 }, (_, index) => {
    const name = `fixture-${String(index).padStart(3, '0')}.md`;
    return { kind: 'note', name, id: [name] };
  });
  await page.route('**/api/vault/tree', route => route.fulfill({ json: { entries } }));
  await page.route('**/api/vault/note?*', route => route.fulfill({ json: { name: 'fixture-030.md', markdown: '# Fixture note', revision: 'fixture-revision', editable: true } }));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${recallOrigin}/recall`);
  const files = page.getByRole('navigation', { name: 'Vault files' });
  const current = files.getByRole('link', { name: 'fixture-030.md' });
  await current.click();
  await expect(page.getByRole('article')).toContainText('Fixture note');
  await files.evaluate(element => new Promise<void>(resolve => {
    element.addEventListener('scroll', () => resolve(), { once: true });
    element.scrollTop = element.scrollHeight;
  }));
  await files.getByRole('button', { name: 'Collapse files sidebar' }).click();
  await page.getByRole('button', { name: 'Expand files sidebar' }).click();
  await expect(current).toBeFocused();
  await expect.poll(() => current.evaluate(element => {
    const pane = element.closest('nav');
    const header = pane?.querySelector('header');
    if (!pane || !header) return false;
    const row = element.getBoundingClientRect();
    const headerBox = header.getBoundingClientRect();
    const hit = document.elementFromPoint(row.left + row.width / 2, row.top + row.height / 2);
    return row.top >= headerBox.bottom - 1 && row.bottom <= pane.getBoundingClientRect().bottom + 1 && !!hit && element.contains(hit);
  })).toBe(true);
});

test('MS4-R2: widening a focused mobile expand control transfers focus to the visible desktop collapse control', async ({ page, recallOrigin }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${recallOrigin}/recall`);
  const files = page.getByRole('navigation', { name: 'Vault files' });
  await files.getByRole('link', { name: 'alpha.md' }).click();
  await expect(page.getByRole('article')).toContainText('Alpha fixture body.');
  await page.setViewportSize({ width: 390, height: 844 });
  const expand = page.getByRole('button', { name: 'Expand files sidebar' });
  await expect(expand).toBeVisible();
  await expand.focus();
  await expect(expand).toBeFocused();
  await page.setViewportSize({ width: 1440, height: 900 });
  const collapse = page.getByRole('button', { name: 'Collapse files sidebar' });
  await expect(collapse).toBeVisible();
  await expect(collapse).toBeFocused();
});

test('MS4-R3: re-entry preserves the reading anchor after sidebar collapse changes layout', async ({ page, recallOrigin }) => {
  const markdown = ['# Anchor fixture', ...Array.from({ length: 60 }, (_, index) =>
    `Paragraph ${index}: ${'fixture prose '.repeat(12)}`)].join('\n\n');
  await page.route('**/api/vault/note?*', route => route.fulfill({ json: { name: 'danger.md', markdown, revision: 'fixture-revision', editable: true } }));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(noteUrl(recallOrigin, ['danger.md']));
  const article = page.getByRole('article');
  await expect(article).toContainText('Paragraph 59');
  const reader = page.getByRole('region', { name: 'Note reader' });
  await reader.evaluate(element => new Promise<void>(resolve => {
    element.addEventListener('scroll', () => resolve(), { once: true });
    element.scrollTop = 1000;
  }));
  await expect.poll(() => reader.evaluate(element => element.scrollTop)).toBeGreaterThan(900);
  await page.getByRole('button', { name: 'Collapse files sidebar' }).click();
  await expect(page.getByRole('button', { name: 'Expand files sidebar' })).toBeVisible();
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const anchor = await article.evaluate(element => {
    const reader = element.closest('section');
    if (!reader) throw new Error('Missing reader');
    const view = reader.getBoundingClientRect();
    const paragraphs = [...element.querySelectorAll('p')];
    const index = paragraphs.findIndex(paragraph => {
      const box = paragraph.getBoundingClientRect();
      return paragraph.textContent?.startsWith('Paragraph ') && box.top >= view.top + 80 && box.bottom <= view.bottom - 40;
    });
    if (index < 0) throw new Error('No fully visible fixture paragraph');
    return { index, y: paragraphs[index].getBoundingClientRect().top };
  });
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Capture' }).click();
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Recall' }).click();
  await expect(page).toHaveURL(noteUrl(recallOrigin, ['danger.md']));
  await expect(article).toContainText('Paragraph 59');
  await expect.poll(async () => Math.abs(await article.locator('p').nth(anchor.index).evaluate(element => element.getBoundingClientRect().top) - anchor.y)).toBeLessThanOrEqual(2);
});

for (const scenario of [
  { width: 1440, height: 900, collapsed: false, helper: 'Skip to note', before: 'Collapse files sidebar' },
  { width: 1440, height: 900, collapsed: true, helper: 'Return to files', before: 'Expand files sidebar' },
  { width: 390, height: 844, collapsed: true, helper: 'Return to files', before: 'Expand files sidebar' },
] as const) {
  test(`MS4-V1: focused ${scenario.helper} remains unobscured at ${scenario.width}px`, async ({ page, recallOrigin }) => {
    await page.setViewportSize({ width: scenario.width, height: scenario.height });
    await page.goto(noteUrl(recallOrigin, ['alpha.md']));
    await expect(page.getByRole('article')).toContainText('Alpha fixture body.');
    if (scenario.collapsed && scenario.width >= 896) await page.getByRole('button', { name: 'Collapse files sidebar' }).click();
    await page.getByRole('button', { name: scenario.before }).focus();
    await page.keyboard.press('Tab');
    const helper = page.getByRole('button', { name: scenario.helper });
    await expect(helper).toBeFocused();
    await expect.poll(() => helper.evaluate(element => {
      const box = element.getBoundingClientRect();
      if (box.width < 1 || box.height < 1 || box.left < 0 || box.top < 0 || box.right > innerWidth || box.bottom > innerHeight) return false;
      return [[.25, .5], [.5, .5], [.75, .5]].every(([x, y]) => {
        const hit = document.elementFromPoint(box.left + box.width * x, box.top + box.height * y);
        return !!hit && element.contains(hit);
      });
    })).toBe(true);
  });
}

test('53H-R1: Skip to note moves keyboard traversal past Files into the reader', async ({ page, recallOrigin }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(noteUrl(recallOrigin, ['danger.md']));
  const files = page.getByRole('navigation', { name: 'Vault files' });
  const reader = page.getByRole('region', { name: 'Note reader' });
  await expect(files).toBeVisible();
  await expect(reader.getByRole('article')).toContainText('Source heading');
  const link = reader.getByRole('link', { name: 'web (opens in a new tab)', exact: true });
  await expect(link).toBeVisible();
  const skip = files.getByRole('button', { name: 'Skip to note' });
  await skip.focus();
  await expect(skip).toBeFocused();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  await expect(link).toBeFocused();
  await expect(files.getByRole('button', { name: 'Collapse files sidebar' })).not.toBeFocused();
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test(`sidebar chevrons occupy the Files and reader headers at ${viewport.width}px`, async ({ page, recallOrigin }) => {
    await page.setViewportSize(viewport);
    await page.goto(`${recallOrigin}/recall`);
    const files = page.getByRole('navigation', { name: 'Vault files' });
    await files.getByRole('link', { name: 'alpha.md' }).click();
    await expect(page.getByRole('article')).toContainText('Alpha fixture body.');
    if (viewport.width < 896) await page.getByRole('button', { name: 'Expand files sidebar' }).click();
    const collapse = files.getByRole('button', { name: 'Collapse files sidebar' });
    const heading = files.getByRole('heading', { name: 'Files' });
    await expect(collapse).toHaveAttribute('aria-expanded', 'true');
    const regionId = await files.getAttribute('id');
    expect(regionId).toBeTruthy();
    await expect(collapse).toHaveAttribute('aria-controls', regionId ?? '');
    await expect(collapse.locator('svg')).toHaveAttribute('aria-hidden', 'true');
    const collapseBox = await collapse.boundingBox();
    const headingBox = await heading.boundingBox();
    const filesBox = await files.boundingBox();
    expect(collapseBox).not.toBeNull();
    expect(headingBox).not.toBeNull();
    expect(filesBox).not.toBeNull();
    if (collapseBox && headingBox && filesBox) {
      expect(collapseBox.width).toBeGreaterThanOrEqual(44);
      expect(collapseBox.height).toBeGreaterThanOrEqual(44);
      expect(collapseBox.x).toBeGreaterThan(headingBox.x);
      expect(collapseBox.x + collapseBox.width / 2).toBeGreaterThan(filesBox.x + filesBox.width / 2);
      expect(Math.abs((collapseBox.y + collapseBox.height / 2) - (headingBox.y + headingBox.height / 2))).toBeLessThanOrEqual(44);
    }
    const icon = await collapse.locator('svg').boundingBox();
    expect(icon).not.toBeNull();
    if (icon) { expect(icon.width).toBe(20); expect(icon.height).toBe(20); }
    await collapse.hover();
    const tooltip = page.getByRole('tooltip');
    await expect(tooltip).toHaveText('Collapse files sidebar');
    await expect(tooltip).toBeVisible();
    await tooltip.hover();
    await expect(tooltip).toBeVisible();
    await collapse.focus();
    await page.mouse.move(0, 0);
    await expect(tooltip).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(tooltip).toBeHidden();
    await expect(collapse).toBeFocused();
    await expect(files).toBeVisible();
    const location = page.url();
    const historyLength = await page.evaluate(() => history.length);
    await page.keyboard.press('Enter');
    await expect(files).toBeHidden();
    const expand = page.getByRole('button', { name: 'Expand files sidebar' });
    await expect(expand).toBeFocused();
    await expect(expand).toHaveAttribute('aria-expanded', 'false');
    await expect(expand).toHaveAttribute('aria-controls', regionId ?? '');
    await expect(expand.locator('svg')).toHaveAttribute('aria-hidden', 'true');
    const expandBox = await expand.boundingBox();
    const readerBox = await page.getByRole('region', { name: 'Note reader' }).boundingBox();
    expect(expandBox).not.toBeNull();
    expect(readerBox).not.toBeNull();
    if (expandBox && readerBox) {
      expect(expandBox.width).toBeGreaterThanOrEqual(44);
      expect(expandBox.height).toBeGreaterThanOrEqual(44);
      expect(expandBox.x).toBeLessThan(readerBox.x + readerBox.width / 2);
      expect(expandBox.y).toBeLessThanOrEqual(readerBox.y + 80);
    }
    await expect(page.getByText(/^(Show|Hide|Open|Close) files$/)).toHaveCount(0);
    await page.keyboard.press('Space');
    await expect(files.getByRole('link', { name: 'alpha.md' })).toBeFocused();
    expect(page.url()).toBe(location);
    expect(await page.evaluate(() => history.length)).toBe(historyLength);
  });
}

test('desktop Files is visible, toggleable, and note history survives direct entry and refresh', async ({ page, recallOrigin }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${recallOrigin}/recall`);
  const files = page.getByRole('navigation', { name: 'Vault files' });
  await expect(files).toBeVisible();
  await page.getByRole('button', { name: 'Collapse files sidebar' }).click();
  await expect(files).toBeHidden();
  await page.getByRole('button', { name: 'Expand files sidebar' }).click();
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
    expect(filesBox.y).toBeGreaterThanOrEqual(navBox.y + navBox.height - 1);
  }
  await files.getByRole('link', { name: 'alpha.md' }).click();
  await expect(files).toBeHidden();
  await expect(page.getByRole('article')).toContainText('Alpha fixture body.');
  await expect(page.locator(':focus')).toHaveText('alpha.md');
  await page.getByRole('button', { name: 'Expand files sidebar' }).click();
  await expect(files).toBeVisible();
  await expect(files.getByRole('link', { name: 'alpha.md' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(files).toBeHidden();
  await expect(page.getByRole('button', { name: 'Expand files sidebar' })).toBeFocused();
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
      try { await route.fulfill({ json: { name: 'alpha.md', markdown: 'Late alpha body', revision: 'fixture-revision', editable: true } }); }
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
  await page.getByRole('button', { name: 'Expand files sidebar' }).click();
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

test('HN-001: native Skip entry reconciles with note selection on Back and Forward without reload', async ({ page, recallOrigin }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${recallOrigin}/recall`);
  const files = page.getByRole('navigation', { name: 'Vault files' });
  await files.getByRole('link', { name: 'alpha.md' }).click();
  await expect(page.getByRole('article')).toContainText('Alpha fixture body.');
  await page.getByRole('button', { name: 'Expand files sidebar' }).click();
  await expect(files).toBeVisible();
  const initialLength = await page.evaluate(() => { Object.assign(window, { __fixtureNavigationMarker: 'retained' }); return history.length; });
  await page.getByRole('link', { name: 'Skip to content' }).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(`${noteUrl(recallOrigin, ['alpha.md'])}#main-content`);
  await expect(files).toBeVisible();
  await expect(page.locator(':focus')).toHaveAttribute('id', 'main-content');
  await files.getByRole('button', { name: 'folder' }).click();
  await files.getByRole('link', { name: 'beta.md' }).click();
  await expect(page.getByRole('article')).toContainText('Beta fixture body.');
  await expect.poll(() => page.evaluate(() => history.length)).toBe(initialLength + 2);
  await page.goBack();
  await expect(page).toHaveURL(`${noteUrl(recallOrigin, ['alpha.md'])}#main-content`);
  await expect(files).toBeVisible();
  await expect(files.getByRole('link', { name: 'alpha.md' })).toHaveAttribute('aria-current', 'page');
  await files.getByRole('button', { name: 'Collapse files sidebar' }).click();
  await expect(page.getByRole('article')).toContainText('Alpha fixture body.');
  await page.goForward();
  await expect(page).toHaveURL(noteUrl(recallOrigin, ['folder', 'beta.md']));
  await expect(page.getByRole('article')).toContainText('Beta fixture body.');
  expect(await page.evaluate(() => Reflect.get(window, '__fixtureNavigationMarker'))).toBe('retained');
});

test('HN2-R1: Back from Capture restores the native Skip entry Files snapshot after Recall remounts', async ({ page, recallOrigin }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${recallOrigin}/recall`);
  const files = page.getByRole('navigation', { name: 'Vault files' });
  await files.getByRole('link', { name: 'alpha.md' }).click();
  await expect(page.getByRole('article')).toContainText('Alpha fixture body.');
  await page.getByRole('button', { name: 'Expand files sidebar' }).click();
  await expect(files).toBeVisible();
  await page.evaluate(() => { Object.assign(window, { __hn2Retained: true }); });
  await page.getByRole('link', { name: 'Skip to content' }).focus();
  await page.keyboard.press('Enter');
  const fragment = `${noteUrl(recallOrigin, ['alpha.md'])}#main-content`;
  await expect(page).toHaveURL(fragment);
  await expect(page.locator(':focus')).toHaveAttribute('id', 'main-content');
  const key = await page.evaluate(() => {
    const navigation = Reflect.get(window, 'navigation') as { currentEntry: { key: string } } | undefined;
    if (!navigation?.currentEntry) throw new Error('Navigation API is required for this browser');
    return navigation.currentEntry.key;
  });
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Capture' }).click();
  await expect(page).toHaveURL(`${recallOrigin}/capture`);
  await expect(page.getByRole('heading', { level: 1, name: 'Capture' })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(fragment);
  await expect.poll(() => page.evaluate(() => {
    const navigation = Reflect.get(window, 'navigation') as { currentEntry: { key: string } } | undefined;
    return navigation?.currentEntry.key;
  })).toBe(key);
  await expect(files).toBeVisible();
  await expect(files.getByRole('link', { name: 'alpha.md' })).toHaveAttribute('aria-current', 'page');
  expect(await page.evaluate(() => Reflect.get(window, '__hn2Retained'))).toBe(true);
  await files.getByRole('button', { name: 'Collapse files sidebar' }).click();
  await expect(page.getByRole('button', { name: 'Expand files sidebar' })).toBeFocused();
  await expect(page.getByRole('article')).toContainText('Alpha fixture body.');
});

test('HN-001: selection during native Skip preserves the outgoing Files snapshot on Back', async ({ page, recallOrigin }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${recallOrigin}/recall`);
  const files = page.getByRole('navigation', { name: 'Vault files' });
  await files.getByRole('button', { name: 'folder', exact: true }).click();
  await files.getByRole('link', { name: 'alpha.md' }).click();
  await expect(page.getByRole('article')).toContainText('Alpha fixture body.');
  await page.getByRole('button', { name: 'Expand files sidebar' }).click();
  await expect(files).toBeVisible();
  const length = await page.evaluate(() => {
    Object.assign(window, { __hnRetained: true });
    window.addEventListener('popstate', () => {
      if (location.hash !== '#main-content') return;
      const beta = [...document.querySelectorAll<HTMLElement>('.file-link')].find(element => element.textContent === 'beta.md');
      beta?.click();
    }, { once: true });
    return history.length;
  });
  await page.getByRole('link', { name: 'Skip to content' }).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(noteUrl(recallOrigin, ['folder', 'beta.md']));
  await expect(page.getByRole('article')).toContainText('Beta fixture body.');
  await expect.poll(() => page.evaluate(() => history.length)).toBe(length + 2);
  await page.goBack();
  await expect(page).toHaveURL(`${noteUrl(recallOrigin, ['alpha.md'])}#main-content`);
  await expect(files).toBeVisible();
  await expect(files.getByRole('link', { name: 'alpha.md' })).toHaveAttribute('aria-current', 'page');
  await files.getByRole('button', { name: 'Collapse files sidebar' }).click();
  await expect(page.getByRole('article')).toContainText('Alpha fixture body.');
  await page.goForward();
  await expect(page).toHaveURL(noteUrl(recallOrigin, ['folder', 'beta.md']));
  await expect(page.getByRole('article')).toContainText('Beta fixture body.');
  expect(await page.evaluate(() => Reflect.get(window, '__hnRetained'))).toBe(true);
});

test('HN-001: Back before native fragment repair commits retains that entry for Forward', async ({ page, recallOrigin }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${recallOrigin}/recall`);
  const files = page.getByRole('navigation', { name: 'Vault files' });
  await files.getByRole('link', { name: 'alpha.md' }).click();
  await expect(page.getByRole('article')).toContainText('Alpha fixture body.');
  await page.getByRole('button', { name: 'Expand files sidebar' }).click();
  const length = await page.evaluate(() => {
    Object.assign(window, { __hnRetained: true, __hnBackTriggered: false });
    window.addEventListener('popstate', () => {
      if (location.hash === '#main-content') {
        Reflect.set(window, '__hnBackTriggered', true);
        history.back();
      }
    }, { once: true });
    return history.length;
  });
  await page.getByRole('link', { name: 'Skip to content' }).focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => Reflect.get(window, '__hnBackTriggered'))).toBe(true);
  await expect(page).toHaveURL(noteUrl(recallOrigin, ['alpha.md']));
  await page.goForward();
  await expect(page).toHaveURL(`${noteUrl(recallOrigin, ['alpha.md'])}#main-content`);
  await expect(files).toBeVisible();
  await expect(files.getByRole('link', { name: 'alpha.md' })).toHaveAttribute('aria-current', 'page');
  await expect.poll(() => page.evaluate(() => history.length)).toBe(length + 1);
  expect(await page.evaluate(() => Reflect.get(window, '__hnRetained'))).toBe(true);
});

test('HN-001: rapid later app navigation wins over a superseded native repair', async ({ page, recallOrigin }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${recallOrigin}/recall`);
  await page.getByRole('navigation', { name: 'Vault files' }).getByRole('link', { name: 'alpha.md' }).click();
  await expect(page.getByRole('article')).toContainText('Alpha fixture body.');
  await page.getByRole('button', { name: 'Expand files sidebar' }).click();
  await page.evaluate(() => {
    Object.assign(window, { __hnRetained: true });
    window.addEventListener('popstate', () => {
      if (location.hash !== '#main-content') return;
      document.querySelector<HTMLElement>('nav[aria-label="Primary"] a[href="/capture"]')?.click();
      document.querySelector<HTMLElement>('nav[aria-label="Primary"] a[href^="/think"]')?.click();
    }, { once: true });
  });
  await page.getByRole('link', { name: 'Skip to content' }).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/think\?conversation=[0-9a-f-]{36}$/);
  const thinkUrl = page.url();
  await expect(page.getByRole('heading', { level: 1, name: 'Think' })).toBeVisible();
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(page).toHaveURL(thinkUrl);
  await expect(page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Think' })).toHaveAttribute('aria-current', 'page');
  expect(await page.evaluate(() => Reflect.get(window, '__hnRetained'))).toBe(true);
});

test('HN-001: a new identical fragment entry has its own snapshot and does not refetch the note', async ({ page, recallOrigin }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let noteRequests = 0;
  page.on('request', request => { if (new URL(request.url()).pathname === '/api/vault/note') noteRequests++; });
  await page.goto(`${recallOrigin}/recall`);
  const files = page.getByRole('navigation', { name: 'Vault files' });
  await files.getByRole('link', { name: 'alpha.md' }).click();
  await expect(page.getByRole('article')).toContainText('Alpha fixture body.');
  await page.getByRole('button', { name: 'Expand files sidebar' }).click();
  const requestsBefore = noteRequests;
  await page.getByRole('link', { name: 'Skip to content' }).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(`${noteUrl(recallOrigin, ['alpha.md'])}#main-content`);
  const oldKey = await page.evaluate(() => {
    const navigation = Reflect.get(window, 'navigation') as { currentEntry: { key: string } } | undefined;
    if (!navigation?.currentEntry) throw new Error('Navigation API is required for this browser');
    return navigation.currentEntry.key;
  });
  await page.goBack();
  await expect(page).toHaveURL(noteUrl(recallOrigin, ['alpha.md']));
  await expect(files).toBeVisible();
  await files.getByRole('button', { name: 'Collapse files sidebar' }).click();
  await expect(page.getByRole('article')).toContainText('Alpha fixture body.');
  await page.getByRole('link', { name: 'Skip to content' }).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(`${noteUrl(recallOrigin, ['alpha.md'])}#main-content`);
  const newKey = await page.evaluate(() => {
    const navigation = Reflect.get(window, 'navigation') as { currentEntry: { key: string } } | undefined;
    if (!navigation?.currentEntry) throw new Error('Navigation API is required for this browser');
    return navigation.currentEntry.key;
  });
  expect(newKey).not.toBe(oldKey);
  await expect(files).toBeHidden();
  await expect(page.locator(':focus')).toHaveAttribute('id', 'main-content');
  await page.goBack();
  await expect(page).toHaveURL(noteUrl(recallOrigin, ['alpha.md']));
  await page.goForward();
  await expect(page).toHaveURL(`${noteUrl(recallOrigin, ['alpha.md'])}#main-content`);
  await expect(files).toBeHidden();
  await expect(page.getByRole('article')).toContainText('Alpha fixture body.');
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  expect(noteRequests).toBe(requestsBefore);
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
