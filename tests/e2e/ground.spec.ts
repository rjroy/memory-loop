import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from './recall-fixture';

const resources = ['quick-actions.md', 'inspiration.md', 'prompts.md', 'goals.md'] as const;
const inboxFile = '2098-01-02.md';

test.beforeEach(async ({ captureVault }) => {
  const directory = join(captureVault, '03_Resources', 'Memory-Loop');
  await mkdir(directory, { recursive: true });
  await mkdir(join(captureVault, '00_Inbox'), { recursive: true });
  await Promise.all([
    writeFile(join(directory, resources[0]), '## @fixture-skill\nA fictional fixture action.\n'),
    writeFile(join(directory, resources[1]), '## Quote\n> Fictional fixture quotation.\n\nAttribution: Fixture author\nSource: Fixture publication\n'),
    writeFile(join(directory, resources[2]), '## Question\nWhat is a fixture question?\n'),
    writeFile(join(directory, resources[3]), '# Fixture goal\n\n- [ ] Fixture task\n\n<script>window.groundFixtureScriptRan = true</script>\n\n![fixture image](https://example.invalid/ground-fixture.png)\n'),
    writeFile(join(captureVault, '00_Inbox', inboxFile), '- [08:00] Oldest fixture capture\n- [09:00] Fixture capture two\n- [10:00] Fixture capture three\n- [10:15] Fixture capture four\n- [10:20] Fixture capture five\n- [10:30] Fictional fixture capture\n  continued fixture text\n'),
  ]);
});

test.afterEach(async ({ captureVault }) => {
  await Promise.all([
    ...resources.map(name => rm(join(captureVault, '03_Resources', 'Memory-Loop', name), { force: true })),
    rm(join(captureVault, '00_Inbox', inboxFile), { force: true }),
  ]);
});

test('real Ground resources render safely and a capture opens its source in Recall', async ({ page }) => {
  const externalRequests: string[] = [];
  page.on('request', request => { if (request.url().includes('ground-fixture.png')) externalRequests.push(request.url()); });
  await page.goto('/ground');
  for (const name of ['Quick Actions', 'Inspiration', 'Prompts', 'Current Goals', 'Recent captures']) {
    await expect(page.getByRole('heading', { level: 2, name })).toBeVisible();
  }
  await expect(page.getByRole('button', { name: /A fictional fixture action.*@fixture-skill/ })).toBeVisible();
  await expect(page.getByText('Fictional fixture quotation.')).toBeVisible();
  await expect(page.getByText('Fixture author')).toBeVisible();
  await expect(page.getByText('Fixture publication')).toBeVisible();
  await expect(page.getByRole('button', { name: 'What is a fixture question?' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 3, name: 'Fixture goal' })).toBeVisible();
  await expect(page.getByRole('checkbox')).toBeDisabled();
  expect(await page.evaluate(() => 'groundFixtureScriptRan' in window)).toBe(false);
  expect(externalRequests).toEqual([]);
  await expect(page.getByRole('heading', { name: 'Recent conversations' })).toHaveCount(0);
  const captures = page.getByRole('region', { name: 'Recent captures' }).getByRole('link');
  await expect(captures).toHaveCount(5);
  expect(await captures.allTextContents()).toEqual(expect.arrayContaining([
    expect.stringContaining('Fictional fixture capture'), expect.stringContaining('Fixture capture two'),
  ]));
  await expect(captures.first()).toContainText('Fictional fixture capture');
  for (const href of await captures.evaluateAll(links => links.map(link => (link as HTMLAnchorElement).href))) {
    expect(JSON.parse(new URL(href).searchParams.get('file') ?? 'null')).toEqual(['00_Inbox', inboxFile]);
  }
  const capture = page.getByRole('link', { name: /Fictional fixture capture/ });
  await expect(capture).toContainText('continued fixture text');
  await capture.click();
  await expect(page).toHaveURL(new RegExp(`/recall\\?file=`));
  expect(JSON.parse(new URL(page.url()).searchParams.get('file') ?? 'null')).toEqual(['00_Inbox', inboxFile]);
  await expect(page.getByRole('article')).toContainText('Fictional fixture capture');
});

test('missing and malformed cards remain independent of healthy resources', async ({ page, captureVault }) => {
  const directory = join(captureVault, '03_Resources', 'Memory-Loop');
  await rm(join(directory, 'quick-actions.md'));
  await writeFile(join(directory, 'prompts.md'), '## Question\nFixture prompt\n\nUnexpected extra paragraph\n');
  await page.goto('/ground');
  await expect(page.getByText('Quick Actions file not found.')).toBeVisible();
  await expect(page.getByText('Prompts couldn’t be read.')).toBeVisible();
  await expect(page.getByText('Fictional fixture quotation.')).toBeVisible();
  await expect(page.getByRole('heading', { level: 3, name: 'Fixture goal' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Fictional fixture capture/ })).toBeVisible();
  await writeFile(join(directory, 'quick-actions.md'), '## @fixture-skill\nA fictional fixture action.\n');
  await page.getByRole('region', { name: 'Quick Actions' }).getByRole('button', { name: 'Check again' }).click();
  await expect(page.getByRole('button', { name: /A fictional fixture action.*@fixture-skill/ })).toBeVisible();
  await expect(page.getByText('Prompts couldn’t be read.')).toBeVisible();
});

test('keyboard confirmation keeps focused Cancel in view at 200% text on a small viewport', async ({ page }) => {
  const conversationId = '11111111-1111-4111-8111-111111111111';
  const epoch = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  await page.addInitScript(({ conversationId, epoch }) => {
    class FixtureWatch extends EventTarget {
      constructor() {
        super();
        queueMicrotask(() => this.dispatchEvent(new MessageEvent('snapshot', { data: JSON.stringify({ conversationId, epoch, revision: 1, creation: 'ready', sendEligibility: 'available', entries: [] }) })));
      }
      close() {}
    }
    Object.defineProperty(window, 'EventSource', { value: FixtureWatch });
  }, { conversationId, epoch });
  const unexpectedRequests: string[] = [];
  await page.route('**/api/think/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const base = `/api/think/conversations/${conversationId}`;
    if (request.method() === 'GET' && url.pathname === base) {
      await route.fulfill({ json: { conversationId, epoch, revision: 1, creation: 'ready', sendEligibility: 'available', entries: [] } });
    } else if (request.method() === 'GET' && url.pathname === `${base}/decisions`) {
      await route.fulfill({ json: { decisions: [] } });
    } else {
      unexpectedRequests.push(`${request.method()} ${url.pathname}`);
      await route.abort();
    }
  });
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto(`/think?conversation=${conversationId}`);
  await page.addStyleTag({ content: ':root { font-size: 200% !important; }' });
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe('32px');
  const editor = page.getByRole('textbox', { name: 'Message' });
  await editor.fill('Fixture unsent draft');
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled();
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Ground' }).click();
  const action = page.getByRole('button', { name: /A fictional fixture action.*@fixture-skill/ });
  await expect(action).toBeVisible();
  await action.focus();
  await expect(action).toBeFocused();
  await page.keyboard.press('Enter');
  const confirmation = page.getByRole('group', { name: 'Start new chat' });
  await expect(confirmation).toContainText('Your draft stays in the current chat.');
  const cancel = confirmation.getByRole('button', { name: 'Cancel' });
  await expect(cancel).toBeFocused();
  expect(unexpectedRequests).toEqual([]);
  await expect.poll(() => cancel.evaluate(element => {
    const rect = element.getBoundingClientRect();
    const height = window.visualViewport?.height ?? window.innerHeight;
    return { top: rect.top >= 0, bottom: rect.bottom <= height };
  })).toEqual({ top: true, bottom: true });
});
