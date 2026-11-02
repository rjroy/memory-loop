import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import RecallView from '../../src/views/RecallView';
import { TestPresentation } from './fixtures/presentation';
import {
  alphaId, betaId, deferred, errorResponse, expectOnlyVaultReads, fixtureTree,
  installVaultApi, installViewport, jsonResponse, noteLocation, rootId, vaultTree,
} from './fixtures/recall';

let api: ReturnType<typeof installVaultApi>;

beforeEach(() => {
  installViewport(1440);
  api = installVaultApi();
});

afterEach(() => { expectOnlyVaultReads(api); });

function mount(path = '/recall') {
  window.history.replaceState(null, '', path);
  return render(<TestPresentation><RecallView /></TestPresentation>);
}

function primary() {
  return screen.getByRole('navigation', { name: 'Primary' });
}

function expectAppNavigation() {
  expect(within(primary()).getAllByRole('link').map(link => link.textContent?.trim()))
    .toEqual(['Ground', 'Capture', 'Think', 'Recall']);
  expect(within(primary()).getByRole('link', { name: 'Recall' })).toHaveAttribute('aria-current', 'page');
}

async function expandShelf(user: ReturnType<typeof userEvent.setup>) {
  const files = await screen.findByRole('navigation', { name: 'Vault files' });
  const folder = await within(files).findByRole('button', { name: 'Test shelf & café' });
  if (folder.getAttribute('aria-expanded') === 'false') await user.click(folder);
  return files;
}

function requestedNotes() {
  return api.mock.calls.flatMap(([input]) => {
    const url = new URL(input instanceof Request ? input.url : String(input), window.location.origin);
    return url.pathname === '/api/vault/note' ? [JSON.parse(url.searchParams.get('id')!)] : [];
  });
}

function selectedId() {
  const value = new URL(window.location.href).searchParams.get('file');
  return value === null ? null : JSON.parse(value);
}

describe('Recall: native file selection and reading', () => {
  it('provides icon-only sidebar controls with stable region semantics, focus and history', async () => {
    const user = userEvent.setup();
    mount();
    const files = await expandShelf(user);
    await user.click(within(files).getByRole('link', { name: 'Alpha #1.md' }));
    await screen.findByRole('article', { name: 'Alpha #1.md' });
    const push = vi.spyOn(window.history, 'pushState');
    const location = window.location.href;
    const collapse = within(files).getByRole('button', { name: 'Collapse files sidebar' });
    const filesHeading = within(files).getByRole('heading', { name: 'Files' });
    expect(filesHeading.parentElement).toContainElement(collapse);
    expect(collapse).toHaveAttribute('aria-expanded', 'true');
    expect(collapse).toHaveAttribute('aria-controls', files.id);
    expect(collapse.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    collapse.focus();
    await user.keyboard('{Enter}');
    const expand = screen.getByRole('button', { name: 'Expand files sidebar' });
    expect(expand).toHaveFocus();
    expect(expand).toHaveAttribute('aria-expanded', 'false');
    expect(expand).toHaveAttribute('aria-controls', files.id);
    expect(document.getElementById(files.id)).toBeInTheDocument();
    expect(expand.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    await user.keyboard(' ');
    expect(within(screen.getByRole('navigation', { name: 'Vault files' })).getByRole('link', { name: 'Alpha #1.md' })).toHaveFocus();
    expect(window.location.href).toBe(location);
    expect(push).not.toHaveBeenCalled();
  });

  it('loads a real hierarchy without choosing a note; folders disclose natively without note requests', async () => {
    const tree = deferred<Response>();
    api = installVaultApi({ tree: () => tree.promise });
    const user = userEvent.setup();
    mount();

    expect(screen.getByText('Loading files…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Collapse files sidebar' })).toHaveAttribute('aria-expanded', 'true');
    expectAppNavigation();
    expect(screen.queryByRole('tree')).not.toBeInTheDocument();
    expect(screen.queryByRole('treeitem')).not.toBeInTheDocument();
    expect(screen.queryByText('Navigation preview')).not.toBeInTheDocument();
    const initialFocus = document.activeElement;

    await act(async () => { tree.resolve(jsonResponse(vaultTree)); });
    const files = await screen.findByRole('navigation', { name: 'Vault files' });
    expect(document.activeElement).toBe(initialFocus);
    expect(screen.getByText('Choose a file')).toBeInTheDocument();
    expect(within(files).getByRole('link', { name: 'Root.md' })).toBeInTheDocument();
    expect(within(files).queryByRole('link', { name: 'Alpha #1.md' })).not.toBeInTheDocument();

    const folder = within(files).getByRole('button', { name: 'Test shelf & café' });
    expect(folder).toHaveAttribute('aria-expanded', 'false');
    folder.focus();
    await user.keyboard('{Enter}');
    expect(folder).toHaveAttribute('aria-expanded', 'true');
    const alpha = within(files).getByRole('link', { name: 'Alpha #1.md' });
    expect(JSON.parse(new URL(alpha.getAttribute('href')!, window.location.origin).searchParams.get('file')!)).toEqual(alphaId);
    await user.keyboard(' ');
    expect(folder).toHaveAttribute('aria-expanded', 'false');
    expect(within(files).queryByRole('link', { name: 'Alpha #1.md' })).not.toBeInTheDocument();
    expect(selectedId()).toBeNull();
    expect(requestedNotes()).toEqual([]);
  });

  it('clears the previous body, round-trips component IDs, focuses identity once and renders Markdown/GFM', async () => {
    const note = deferred<Response>();
    api = installVaultApi({ note: id => JSON.stringify(id) === JSON.stringify(alphaId)
      ? note.promise : jsonResponse({ name: 'Root.md', markdown: 'Previous fixture body.', revision: 'fixture-revision', editable: true }) });
    const user = userEvent.setup();
    mount();
    const files = await expandShelf(user);
    await user.click(within(files).getByRole('link', { name: 'Root.md' }));
    await screen.findByText('Previous fixture body.');
    const alpha = within(screen.getByRole('navigation', { name: 'Vault files' })).getByRole('link', { name: 'Alpha #1.md' });
    await user.click(alpha);

    expect(selectedId()).toEqual(alphaId);
    expect(requestedNotes()).toEqual([rootId, alphaId]);
    expect(screen.getByText('Opening file…')).toBeInTheDocument();
    expect(screen.queryByText('Previous fixture body.')).not.toBeInTheDocument();
    await waitFor(() => {
      expect(alpha).not.toHaveFocus();
      expect(document.activeElement).toHaveTextContent('Alpha #1.md');
    });
    const identityFocus = document.activeElement;

    await act(async () => { note.resolve(jsonResponse({ name: 'Alpha #1.md', markdown:
      '# Markdown test heading\n\nA **strong fixture** paragraph.\n\n| Key | Value |\n| --- | --- |\n| Test | Owned |\n\n- [x] Read-only task\n\n###### Deep source heading', revision: 'fixture-revision', editable: true })); });
    const article = await screen.findByRole('article', { name: 'Alpha #1.md' });
    expect(within(article).getByRole('heading', { level: 2, name: 'Markdown test heading' })).toBeInTheDocument();
    expect(within(article).getByRole('heading', { level: 6, name: 'Deep source heading' })).toBeInTheDocument();
    expect(within(article).getByText('strong fixture').tagName).toBe('STRONG');
    expect(within(article).getByRole('table')).toHaveTextContent('Owned');
    expect(within(article).getByRole('checkbox')).toBeChecked();
    expect(within(article).getByRole('checkbox')).toBeDisabled();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(document.activeElement).toBe(identityFocus);
    expect(document.title).toBe('Alpha #1.md · Recall · Memory Loop');
    expect(within(screen.getByRole('navigation', { name: 'Vault files' })).getByRole('link', { name: 'Alpha #1.md' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByText(/Test shelf & café\s*\/\s*Alpha #1\.md/)).toBeInTheDocument();
  });

  it('desktop toggles and keyboard pane-jump controls preserve the note and location', async () => {
    const user = userEvent.setup();
    mount();
    const files = await expandShelf(user);
    const alpha = within(files).getByRole('link', { name: 'Alpha #1.md' });
    await user.click(alpha);
    await screen.findByRole('article', { name: 'Alpha #1.md' });
    const push = vi.spyOn(window.history, 'pushState');
    const location = window.location.href;

    await user.click(screen.getByRole('button', { name: 'Collapse files sidebar' }));
    expect(screen.queryByRole('navigation', { name: 'Vault files' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Expand files sidebar' })).toHaveFocus();
    expect(screen.getByRole('article', { name: 'Alpha #1.md' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Expand files sidebar' }));
    const restored = await screen.findByRole('navigation', { name: 'Vault files' });
    expect(within(restored).getByRole('link', { name: 'Alpha #1.md' })).toHaveFocus();
    const skip = screen.getByText('Skip to file', { exact: true });
    expect(['A', 'BUTTON']).toContain(skip.tagName);
    await user.click(skip);
    expect(screen.getByRole('article', { name: 'Alpha #1.md' })).toHaveFocus();
    expect(within(restored).getByRole('link', { name: 'Alpha #1.md' })).not.toHaveFocus();
    const returnToFiles = screen.getByText('Return to files', { exact: true });
    expect(['A', 'BUTTON']).toContain(returnToFiles.tagName);
    await user.click(returnToFiles);
    expect(within(restored).getByRole('link', { name: 'Alpha #1.md' })).toHaveFocus();
    expect(window.location.href).toBe(location);
    expect(push).not.toHaveBeenCalled();
    expectAppNavigation();
  });

  it('narrow Files is non-modal, hides the reader, closes on selection and returns focus on close/Escape', async () => {
    installViewport(390);
    const note = deferred<Response>();
    api = installVaultApi({ note: () => note.promise });
    const user = userEvent.setup();
    mount();
    await expandShelf(user);
    expect(screen.getByRole('button', { name: 'Collapse files sidebar' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.querySelector('[aria-modal="true"]')).toBeNull();
    expectAppNavigation();
    await user.click(screen.getByRole('button', { name: 'Collapse files sidebar' }));
    expect(screen.queryByRole('navigation', { name: 'Vault files' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Expand files sidebar' })).toHaveFocus();
    expect(screen.getByText('Choose a file')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Expand files sidebar' }));
    expect(screen.getByRole('heading', { name: 'Files' })).toHaveFocus();
    await user.click(within(screen.getByRole('navigation', { name: 'Vault files' })).getByRole('link', { name: 'Alpha #1.md' }));
    expect(screen.queryByRole('navigation', { name: 'Vault files' })).not.toBeInTheDocument();
    expect(screen.getByText('Opening file…')).toBeInTheDocument();
    await act(async () => { note.resolve(jsonResponse({ name: 'Alpha #1.md', markdown: 'Phone fixture body.', revision: 'fixture-revision', editable: true })); });
    await screen.findByRole('article', { name: 'Alpha #1.md' });
    await user.click(screen.getByRole('button', { name: 'Expand files sidebar' }));
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
    expect(screen.queryByText('Phone fixture body.')).not.toBeInTheDocument();
    expect(within(screen.getByRole('navigation', { name: 'Vault files' })).getByRole('link', { name: 'Alpha #1.md' })).toHaveFocus();
    expectAppNavigation();
    await user.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: 'Expand files sidebar' })).toHaveFocus();
    expect(screen.getByRole('article', { name: 'Alpha #1.md' })).toBeInTheDocument();
  });

  it('keeps a selected note readable across width changes without stranding focus in hidden Files', async () => {
    const viewport = installViewport(1440);
    const user = userEvent.setup();
    mount();
    const files = await expandShelf(user);
    await user.click(within(files).getByRole('link', { name: 'Alpha #1.md' }));
    await screen.findByRole('article', { name: 'Alpha #1.md' });
    const location = window.location.href;
    await act(async () => { viewport.resize(390); });
    expect(screen.getByRole('button', { name: 'Expand files sidebar' })).toBeInTheDocument();
    expect(screen.getByRole('article', { name: 'Alpha #1.md' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Expand files sidebar' }));
    await act(async () => { viewport.resize(1440); });
    const current = within(screen.getByRole('navigation', { name: 'Vault files' })).getByRole('link', { name: 'Alpha #1.md' });
    expect(current).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Collapse files sidebar' })).toBeInTheDocument();
    expect(window.location.href).toBe(location);
  });

  it('opens a narrow direct-note URL in the reader, without hard-load autofocus, and reveals its ancestors on demand', async () => {
    installViewport(390);
    const user = userEvent.setup();
    mount(noteLocation(alphaId));
    await screen.findByRole('article', { name: 'Alpha #1.md' });
    expect(requestedNotes()).toEqual([alphaId]);
    expect(screen.queryByRole('navigation', { name: 'Vault files' })).not.toBeInTheDocument();
    expect(document.activeElement).toBe(document.body);
    expect(document.title).toBe('Alpha #1.md · Recall · Memory Loop');
    await user.click(screen.getByRole('button', { name: 'Expand files sidebar' }));
    const files = await screen.findByRole('navigation', { name: 'Vault files' });
    expect(within(files).getByRole('button', { name: 'Test shelf & café' })).toHaveAttribute('aria-expanded', 'true');
    expect(within(files).getByRole('link', { name: 'Alpha #1.md' })).toHaveFocus();
  });
});

describe('Recall: truthful failures and short-query recovery', () => {
  it('distinguishes the three 503 codes from an empty eligible tree and retries without editing config', async () => {
    const replies = [errorResponse('config_missing', 503), errorResponse('config_invalid', 503),
      errorResponse('vault_unavailable', 503), jsonResponse(fixtureTree([]))];
    api = installVaultApi({ tree: () => replies.shift()! });
    const user = userEvent.setup();
    mount();
    const push = vi.spyOn(window.history, 'pushState');
    await screen.findByText('Vault not configured');
    expectAppNavigation();
    expect(screen.queryByText('No files to show')).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Check again' }));
    await screen.findByText('Vault configuration is invalid');
    await user.click(screen.getByRole('button', { name: 'Check again' }));
    await screen.findByText('Vault unavailable');
    expect(screen.queryByText('No files to show')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByText('No files to show');
    expect(screen.getByText('Choose a file')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Vault files' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Vault actions' }));
    expect(screen.getByRole('menuitem', { name: /New file/ })).toBeEnabled();
    expect(requestedNotes()).toEqual([]);
    expect(push).not.toHaveBeenCalled();
  });

  it('keeps empty folders, unavailable notes and successful empty documents distinct; retry preserves the ID', async () => {
    let attempts = 0;
    api = installVaultApi({ note: () => ++attempts === 1 ? errorResponse('note_unavailable', 404)
      : jsonResponse({ name: 'Alpha #1.md', markdown: '', revision: 'fixture-revision', editable: true }) });
    const user = userEvent.setup();
    mount();
    const files = await expandShelf(user);
    await user.click(within(files).getByRole('button', { name: 'Empty test folder' }));
    expect(within(files).getByText('No items to show.')).toBeInTheDocument();
    expect(requestedNotes()).toEqual([]);
    await user.click(within(files).getByRole('link', { name: 'Alpha #1.md' }));
    await screen.findByText('Note unavailable');
    expect(screen.queryByText('This note is empty.')).not.toBeInTheDocument();
    expect(selectedId()).toEqual(alphaId);
    const push = vi.spyOn(window.history, 'pushState');
    await user.click(screen.getByRole('button', { name: 'Retry note' }));
    await screen.findByText('This note is empty.');
    expect(screen.getByRole('article', { name: 'Alpha #1.md' })).toBeInTheDocument();
    expect(screen.queryByText('No files to show')).not.toBeInTheDocument();
    expect(requestedNotes()).toEqual([alphaId, alphaId]);
    expect(push).not.toHaveBeenCalled();
    expectAppNavigation();
  });

  it.each([
    { name: 'malformed frontend JSON', path: '/recall?file=not-json', expectedRequests: [] },
    { name: 'backend invalid_request', path: noteLocation(['Invalid fixture.md']), expectedRequests: [['Invalid fixture.md']] },
  ])('handles $name without endlessly retrying a bad note address', async ({ path, expectedRequests }) => {
    api = installVaultApi({ note: () => errorResponse('invalid_request', 400) });
    mount(path);
    await screen.findByText('File address is invalid');
    expect(requestedNotes()).toEqual(expectedRequests);
    expect(screen.queryByRole('button', { name: /retry note/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/Fixture body for/)).not.toBeInTheDocument();
    expectAppNavigation();
  });

  it('treats SPA HTML and rejected fetch as transport failures, never empty-vault or guessed static-preview states', async () => {
    let attempts = 0;
    api = installVaultApi({ tree: () => {
      attempts++;
      if (attempts === 1) return new Response('<html>Static fixture fallback</html>', { headers: { 'Content-Type': 'text/html' } });
      if (attempts === 2) throw new TypeError('Controlled transport diagnostic');
      return jsonResponse(fixtureTree([]));
    } });
    const user = userEvent.setup();
    mount();
    await screen.findByText('Vault service unavailable');
    expect(screen.queryByText(/Vault access isn't enabled/)).not.toBeInTheDocument();
    expect(screen.queryByText('No files to show')).not.toBeInTheDocument();
    expect(screen.queryByText('Static fixture fallback')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => { expect(attempts).toBe(2); expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled(); });
    expect(screen.getByText('Vault service unavailable')).toBeInTheDocument();
    expect(screen.queryByText('Controlled transport diagnostic')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByText('No files to show');
  });

  it.each(['success', 'error'] as const)('ignores a late A %s after B succeeds, even if the transport ignores abort', async (late) => {
    const a = deferred<Response>();
    const b = deferred<Response>();
    // Deliberately ignore AbortSignal: stale-response protection must also guard commits.
    api = installVaultApi({ note: id => id.at(-1) === 'Alpha #1.md' ? a.promise : b.promise });
    const user = userEvent.setup();
    mount();
    const files = await expandShelf(user);
    await user.click(within(files).getByRole('link', { name: 'Alpha #1.md' }));
    await user.click(within(screen.getByRole('navigation', { name: 'Vault files' })).getByRole('link', { name: 'Beta.md' }));
    await waitFor(() => {
      expect(document.activeElement).toHaveTextContent('Beta.md');
      expect(within(screen.getByRole('navigation', { name: 'Vault files' })).getByRole('link', { name: 'Beta.md' })).not.toHaveFocus();
    });
    const focus = document.activeElement;
    await act(async () => { b.resolve(jsonResponse({ name: 'Beta.md', markdown: 'Current B fixture.', revision: 'fixture-revision', editable: true })); });
    await screen.findByText('Current B fixture.');
    await act(async () => { a.resolve(late === 'success'
      ? jsonResponse({ name: 'Alpha #1.md', markdown: 'Stale A fixture.', revision: 'fixture-revision', editable: true }) : errorResponse('note_unavailable', 404)); });
    expect(screen.getByRole('article', { name: 'Beta.md' })).toHaveTextContent('Current B fixture.');
    expect(screen.queryByText('Stale A fixture.')).not.toBeInTheDocument();
    expect(screen.queryByText('Note unavailable')).not.toBeInTheDocument();
    expect(selectedId()).toEqual(betaId);
    expect(document.title).toBe('Beta.md · Recall · Memory Loop');
    expect(document.activeElement).toBe(focus);
  });
});

describe('Recall: renderer and route boundaries', () => {
  it('renders hostile Markdown as inert content without media requests, unsafe links or editable tasks', async () => {
    const markdown = [
      '---', 'title: Not the filename', '---', '# Safe fixture heading', '',
      '<script>window.__recallFixtureExecuted = true</script>', '',
      '<img src="https://forbidden.invalid/raw.png" onerror="window.__recallFixtureExecuted = true">', '',
      '![fixture alt](https://forbidden.invalid/image.png)', '',
      '[unsafe](javascript:alert%281%29)', '[protocol relative](//forbidden.invalid/note)',
      '[relative note](Elsewhere.md)', '[heading reference](#safe-fixture-heading)',
      '[[Wiki fixture]]', '![[embed.png]]', '',
      '[secure web](https://example.invalid/reference)', '[plain web](http://example.invalid/reference)', '',
      '- [x] Immutable fixture task',
    ].join('\n');
    api = installVaultApi({ note: () => jsonResponse({ name: 'Alpha #1.md', markdown, revision: 'fixture-revision', editable: true }) });
    const writes = vi.spyOn(Storage.prototype, 'setItem');
    mount(noteLocation(alphaId));
    const article = await screen.findByRole('article', { name: 'Alpha #1.md' });
    expect(within(article).getByRole('heading', { level: 2, name: 'Safe fixture heading' })).toBeInTheDocument();
    expect(article).toHaveTextContent('title: Not the filename');
    expect(article).toHaveTextContent('<script>window.__recallFixtureExecuted = true</script>');
    expect(article).toHaveTextContent('Image not shown: fixture alt');
    expect(article).toHaveTextContent('[[Wiki fixture]]');
    expect(article).toHaveTextContent('![[embed.png]]');
    expect(article.querySelector('script, img, iframe, object, embed, video, audio, [src], [srcset], [onerror], [onclick]')).toBeNull();
    expect(Reflect.get(window, '__recallFixtureExecuted')).toBeUndefined();
    for (const label of ['unsafe', 'protocol relative', 'relative note', 'heading reference']) {
      expect(within(article).getByText(label)).toBeInTheDocument();
      expect(within(article).queryByRole('link', { name: label })).not.toBeInTheDocument();
    }
    expect(within(article).getAllByRole('link')).toHaveLength(2);
    for (const name of [/secure web/, /plain web/]) {
      const link = within(article).getByRole('link', { name });
      expect(link).toHaveAttribute('target', '_blank');
      expect(link.getAttribute('rel')?.split(/\s+/)).toEqual(expect.arrayContaining(['noopener', 'noreferrer']));
    }
    for (const link of article.querySelectorAll('a')) {
      expect(['https:', 'http:']).toContain(new URL(link.href).protocol);
    }
    expect(within(article).getByRole('checkbox')).toBeDisabled();
    expect(screen.queryByText('Formatting support')).not.toBeInTheDocument();
    const identity = document.getElementById('note-identity')!;
    const titlebar = identity.closest('header')!;
    expect(within(titlebar).getByRole('heading', { level: 1, name: 'Recall' })).toBeInTheDocument();
    expect(within(titlebar).getByText('Test shelf & café / Alpha #1.md')).toBeInTheDocument();
    expect(identity).toHaveAttribute('tabindex', '-1');
    expect(article).not.toContainElement(identity);
    expect(document.title).toBe('Alpha #1.md · Recall · Memory Loop');
    expect(writes).not.toHaveBeenCalled();
    expect(requestedNotes()).toEqual([alphaId]);
  });

});
