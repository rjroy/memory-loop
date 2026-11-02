import type { BrowserContext, Page } from '@playwright/test';
import type { VaultSearchContextRequest, VaultSearchContextResponse, VaultSearchRequest, VaultSearchResponse, VaultTreeResponse } from '../../backend/contract';
import { expect, test } from './recall-fixture';
import { fixtureDirectory, fixtureDirectoryId } from '../fixtures/directory';

const alpha = ['alpha-fixture.md'];
const beta = ['folder', 'beta-fixture.md'];
const version = 'fixture-search-version';
const coverage = { complete: true, filesSearched: 2, skippedFiles: { binary: 0, invalidEncoding: 0, unreadable: 0, changed: 0 }, skippedLines: 0, timedOut: false };
const filename: VaultSearchResponse = { mode: 'filename', counts: { matches: 1, files: 1 }, limited: false, coverage,
  hits: [{ id: beta, name: beta[1], path: beta.join('/'), field: 'name', positions: [0, 1], score: 1 }] };
const content: VaultSearchResponse = { mode: 'content', counts: { matches: 1, files: 1 }, limited: false, coverage,
  hits: [{ id: beta, name: beta[1], path: beta.join('/'), line: 4, version, score: 1,
    snippets: [{ text: 'Saved beta evidence', start: 0, end: 19, positions: [6, 7] }] }] };
const excerpt: VaultSearchContextResponse = { id: beta, name: beta[1], version, targetLine: 4, startLine: 1, truncated: false,
  lines: [1, 2, 3, 4, 5, 6, 7].map(number => ({ number, text: number === 4 ? 'Saved beta evidence' : `Source neighbor ${number}`, positions: number === 4 ? [6, 7] : [] })) };
const tree: VaultTreeResponse = { rootIdentity: 'fixture-root', entries: [
  { kind: 'note', name: alpha[0], id: alpha, identity: 'alpha-identity', version: 'alpha-version' },
  { kind: 'directory', name: 'folder', id: ['folder'], identity: 'folder-identity', version: 'folder-version', children: [
    { kind: 'note', name: beta[1], id: beta, identity: 'beta-identity', version: 'beta-version' },
  ] },
] };

async function installFixture(browser: BrowserContext) {
  const requests: VaultSearchContextRequest[] = [];
  await browser.route('**/api/vault/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === '/api/vault/tree' && request.method() === 'GET') {
      await route.fulfill({ json: tree });
    } else if (url.pathname === '/api/vault/directory' && request.method() === 'GET') {
      const id = fixtureDirectoryId(url);
      const listing = id && fixtureDirectory(tree, id);
      if (!listing) await route.fulfill({ status: id ? 404 : 400, json: { error: { code: id ? 'entry_unavailable' : 'invalid_request', message: 'Fixture directory unavailable' } } });
      else await route.fulfill({ json: listing });
    } else if (url.pathname === '/api/vault/note' && request.method() === 'GET') {
      const id: string[] = JSON.parse(url.searchParams.get('id') ?? '[]');
      await route.fulfill({ json: { name: id.at(-1), markdown: '# Fixture reader\n\nSaved formatted body.', revision: 'a'.repeat(64), editable: true } });
    } else if (url.pathname === '/api/vault/search' && request.method() === 'POST') {
      const body: VaultSearchRequest = request.postDataJSON();
      await route.fulfill({ json: body.mode === 'filename' ? filename : content });
    } else if (url.pathname === '/api/vault/search/context' && request.method() === 'POST') {
      const body: VaultSearchContextRequest = request.postDataJSON();
      requests.push(body);
      await route.fulfill({ json: excerpt });
    } else {
      throw new Error(`Unexpected fixture request: ${request.method()} ${url.pathname}`);
    }
  });
  const token = 'fixture_view_token_012345678901234567890123456789';
  await browser.route('**/api/think/views', route => route.fulfill({ status: 201, json: {
    viewToken: token, selectionRevision: 0, conversationId: null, expiresAt: new Date(Date.now() + 120_000).toISOString(),
  } }));
  await browser.route('**/api/think/selection', route => route.fulfill({ json: { selectionRevision: 0, conversationId: null, expiresAt: new Date(Date.now() + 120_000).toISOString() } }));
  return requests;
}

function files(page: Page) { return page.getByRole('navigation', { name: 'Vault files' }); }
function searchbox(page: Page) { return files(page).getByRole('searchbox'); }
function betaHit(page: Page) { return files(page).getByRole('link', { name: /beta-fixture\.md/i }); }

test('native filename and content links open the normal reader and a source excerpt', async ({ page, context, recallOrigin }) => {
  const requests = await installFixture(context);
  await page.goto(`${recallOrigin}/recall`);
  await searchbox(page).fill('be');
  await expect(betaHit(page)).toHaveAttribute('href', /.+/);
  await betaHit(page).click();
  await expect(page.getByRole('article', { name: 'beta-fixture.md' })).toContainText('Saved formatted body.');
  await files(page).getByText('Content', { exact: true }).click();
  await expect(betaHit(page)).toContainText('Saved beta evidence');
  await betaHit(page).click();
  await expect(page.getByText(/Source excerpt/i)).toBeVisible();
  await expect(page.getByText('Source neighbor 1')).toBeVisible();
  await expect(page.getByText('Source neighbor 7')).toBeVisible();
  expect(requests).toEqual([{ id: beta, version, line: 4, query: 'be' }]);
  await page.getByRole('button', { name: /Read formatted|Open full file/i }).click();
  await expect(page.getByRole('article', { name: 'beta-fixture.md' })).toContainText('Saved formatted body.');
});

test('a native modified click opens versioned context in another tab without discarding the local draft', async ({ page, context, recallOrigin }) => {
  const requests = await installFixture(context);
  await page.goto(`${recallOrigin}/recall?${new URLSearchParams({ file: JSON.stringify(alpha) })}`);
  await page.getByRole('button', { name: 'Edit' }).click();
  const editor = page.getByRole('textbox', { name: /markdown/i });
  await editor.fill('Draft stays in the original tab');
  await files(page).getByText('Content', { exact: true }).click();
  await searchbox(page).fill('be');
  await expect(betaHit(page)).toContainText('Saved beta evidence');
  const [newPage] = await Promise.all([
    context.waitForEvent('page'),
    betaHit(page).click({ modifiers: [process.platform === 'darwin' ? 'Meta' : 'Control'] }),
  ]);
  await expect(newPage.getByText(/Source excerpt/i)).toBeVisible();
  await expect(newPage.getByText('Saved beta evidence')).toBeVisible();
  await expect.poll(() => requests).toContainEqual({ id: beta, version, line: 4, query: 'be' });
  await expect(editor).toHaveValue('Draft stays in the original tab');
  await expect(page.getByText('Discard unsaved changes?')).toHaveCount(0);
});

test('mobile Files retains query and mode after selection and Escape clears before closing', async ({ page, context, recallOrigin }) => {
  await installFixture(context);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${recallOrigin}/recall`);
  await files(page).getByText('Content', { exact: true }).click();
  await searchbox(page).fill('be');
  await expect(betaHit(page)).toContainText('Saved beta evidence');
  await betaHit(page).click();
  await expect(page.getByText(/Source excerpt/i)).toBeVisible();
  await page.getByRole('button', { name: 'Expand files sidebar' }).click();
  await expect(searchbox(page)).toHaveValue('be');
  await expect(betaHit(page)).toContainText('Saved beta evidence');
  await searchbox(page).focus();
  await page.keyboard.press('Escape');
  await expect(searchbox(page)).toHaveValue('');
  await expect(files(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Expand files sidebar' })).toBeVisible();
});

test('reactivating the identical source result leaves Recall controls and formatted reading usable', async ({ page, context, recallOrigin }) => {
  await installFixture(context);
  const result: VaultSearchResponse = { mode: 'content', counts: { matches: 1, files: 1 }, limited: false, coverage,
    hits: [{ id: alpha, name: alpha[0], path: alpha[0], line: 3, version, score: 1,
      snippets: [{ text: 'Alpha fixture body.', start: 0, end: 19, positions: [0, 1, 2, 3, 4] }] }] };
  const source: VaultSearchContextResponse = { id: alpha, name: alpha[0], version, targetLine: 3, startLine: 1, truncated: false,
    lines: [{ number: 1, text: '# Alpha fixture', positions: [] }, { number: 2, text: '', positions: [] },
      { number: 3, text: 'Alpha fixture body.', positions: [0, 1, 2, 3, 4] }] };
  await context.route('**/api/vault/search', async route => {
    const body: VaultSearchRequest = route.request().postDataJSON();
    expect(body).toEqual({ mode: 'content', query: 'Alpha' });
    await route.fulfill({ json: result });
  });
  await context.route('**/api/vault/search/context', async route => {
    const body: VaultSearchContextRequest = route.request().postDataJSON();
    expect(body).toEqual({ id: alpha, version, line: 3, query: 'Alpha' });
    await route.fulfill({ json: source });
  });
  await page.goto(`${recallOrigin}/recall`);
  await files(page).getByText('Content', { exact: true }).click();
  await searchbox(page).fill('Alpha');
  const hit = files(page).getByRole('link', { name: /alpha-fixture\.md, line 3/i });
  await expect(hit).toBeVisible();
  const href = await hit.evaluate(link => (link as HTMLAnchorElement).href);
  await hit.click();
  await expect(page.getByRole('group', { name: 'Match, line 3' })).toContainText('Alpha fixture body.');
  expect(page.url()).toBe(href);
  expect(await hit.evaluate(link => (link as HTMLAnchorElement).href)).toBe(href);
  await hit.click();
  await expect(files(page).getByRole('button', { name: 'Vault actions' })).toBeEnabled();
  await expect(page.getByRole('group', { name: 'Match, line 3' })).toContainText('Alpha fixture body.');
  await expect(page.getByText('Opening file…')).toHaveCount(0);
  await page.getByRole('button', { name: 'Read formatted' }).click();
  await expect(page.getByRole('article', { name: 'alpha-fixture.md' })).toContainText('Saved formatted body.');
});

test('a pending Ground departure fences a same-turn file selection before Recall re-renders', async ({ page, context, recallOrigin }) => {
  await installFixture(context);
  await page.goto(`${recallOrigin}/recall`);
  await searchbox(page).fill('be');
  await expect(betaHit(page)).toBeVisible();

  // Dispatch both real link clicks in one browser task: the first establishes a
  // Next navigation intent, but React cannot yet publish its pending state.
  await page.evaluate(() => {
    const primary = document.querySelector('nav[aria-label="Primary"]');
    const files = document.querySelector('nav[aria-label="Vault files"]');
    const ground = [...(primary?.querySelectorAll('a') ?? [])].find(link => link.textContent?.trim() === 'Ground');
    const beta = [...(files?.querySelectorAll('a') ?? [])].find(link => link.textContent?.includes('beta-fixture.md'));
    if (!ground || !beta) throw new Error('Fixture navigation links missing');
    ground.click();
    beta.click();
  });

  await expect(page).toHaveURL(`${recallOrigin}/ground`);
  await expect(page.getByRole('heading', { name: 'Ground', level: 1 })).toBeVisible();
  await expect(page.getByRole('article', { name: 'beta-fixture.md' })).toHaveCount(0);
});

test('a late context response after leaving Recall cannot replace the Ground view', async ({ page, context, recallOrigin }) => {
  await installFixture(context);
  let release: () => void = () => { throw new Error('Context was not requested'); };
  const held = new Promise<void>(resolve => { release = resolve; });
  let requested: (body: VaultSearchContextRequest) => void = () => { throw new Error('Context request observer missing'); };
  const received = new Promise<VaultSearchContextRequest>(resolve => { requested = resolve; });
  let finishRoute: () => void = () => { throw new Error('Context route observer missing'); };
  const routeFinished = new Promise<void>(resolve => { finishRoute = resolve; });
  await context.route('**/api/vault/search/context', async route => {
    requested(route.request().postDataJSON() as VaultSearchContextRequest);
    await held;
    // A cancelled browser request may already have closed its route.
    try { await route.fulfill({ json: excerpt }); } catch { /* request cancelled */ }
    finally { finishRoute(); }
  });
  try {
    await page.goto(`${recallOrigin}/recall`);
    await files(page).getByText('Content', { exact: true }).click();
    await searchbox(page).fill('be');
    await betaHit(page).click();
    expect(await received).toEqual({ id: beta, version, line: 4, query: 'be' });
    await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Ground' }).click();
    await expect(page).toHaveURL(`${recallOrigin}/ground`);
    await expect(page.getByRole('heading', { name: 'Ground', level: 1 })).toBeVisible();
    release();
    await routeFinished;
    await expect(page).toHaveURL(`${recallOrigin}/ground`);
    await expect(page.getByText(/Source excerpt/i)).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: /markdown/i })).toHaveCount(0);
  } finally { release(); }
});
