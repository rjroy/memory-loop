import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import type { VaultEntry, VaultId } from '../../backend/contract';
import RecallView from '../../src/views/RecallView';
import { TestPresentation } from './fixtures/presentation';
import { deferred, fixtureTree, installVaultApi, installViewport, jsonResponse, noteLocation } from './fixtures/recall';
import { fixtureDirectory } from '../fixtures/directory';

const makeTree = () => fixtureTree([
  { kind: 'directory', name: 'Shelf', id: ['Shelf'], children: [
    { kind: 'note', name: 'Alpha.md', id: ['Shelf', 'Alpha.md'] },
    { kind: 'note', name: 'Beta.md', id: ['Shelf', 'Beta.md'] },
  ] },
  { kind: 'directory', name: 'Destination', id: ['Destination'], children: [
    { kind: 'directory', name: 'Nested', id: ['Destination', 'Nested'], children: [] },
  ] },
  { kind: 'directory', name: 'Media', id: ['Media'], children: [] },
]);
const photo = { kind: 'file' as const, name: 'unique.png', id: ['Media', 'unique.png'], identity: 'photo-id', version: 'photo-version' };
let tree: { rootIdentity: string; entries: VaultEntry[] };
let directories: string[][];
let trees: number;
let text: string;
let interceptRoot: (() => Promise<Response>) | undefined;
let interceptShelf: (() => Promise<Response>) | undefined;

beforeEach(() => {
  installViewport(1440);
  tree = makeTree();
  const media = tree.entries.find(entry => entry.kind === 'directory' && entry.name === 'Media');
  if (!media || media.kind !== 'directory') throw new Error('Missing fixture directory');
  media.children.push(photo);
  directories = [];
  trees = 0;
  text = '# Fixture note';
  interceptRoot = undefined;
  interceptShelf = undefined;
  const api = installVaultApi({
    tree: () => { trees++; return jsonResponse(tree); },
    note: id => jsonResponse({ name: id.at(-1), markdown: text, revision: 'fixture-revision', editable: true }),
  });
  const fallback = api.getMockImplementation();
  if (!fallback) throw new Error('Missing isolated fetch fixture');
  api.mockImplementation(async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), window.location.origin);
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    if (url.pathname === '/api/vault/directory' && method === 'GET') {
      const value: unknown = JSON.parse(url.searchParams.get('id') ?? 'null');
      if (!Array.isArray(value) || !value.every(part => typeof part === 'string')) throw new Error('Invalid directory fixture ID');
      const id: string[] = value;
      directories.push(id);
      if (!id.length && interceptRoot) return interceptRoot();
      if (id.length === 1 && id[0] === 'Shelf' && interceptShelf) return interceptShelf();
      let entries = tree.entries;
      let directoryIdentity = tree.rootIdentity;
      for (const part of id) {
        const child = entries.find(entry => entry.name === part && entry.kind === 'directory');
        if (!child || child.kind !== 'directory') return jsonResponse({ error: { code: 'entry_unavailable', message: 'Unavailable' } }, 404);
        directoryIdentity = child.identity;
        entries = child.children;
      }
      return jsonResponse({ rootIdentity: tree.rootIdentity, directoryIdentity, id, entries: entries.map(entry => {
        if (entry.kind !== 'directory') return entry;
        const { children: _children, ...shallow } = entry;
        return shallow;
      }) });
    }
    if (url.pathname === '/api/vault/file' && method === 'GET') {
      return jsonResponse({ name: 'unique.png', kind: 'image', contentType: 'image/png' });
    }
    if (url.pathname === '/api/vault/actions' && method === 'POST') {
      const command: unknown = JSON.parse(String(init?.body));
      if (!command || typeof command !== 'object' || !('action' in command) || command.action !== 'create-directory' || !('name' in command) || command.name !== 'Created') throw new Error('Unexpected fixture mutation');
      tree.entries.push({ kind: 'directory', name: 'Created', id: ['Created'], identity: 'created-id', version: 'created-version', children: [] });
      return jsonResponse({ id: ['Created'] });
    }
    return fallback(input, init);
  });
});

function mount(id?: VaultId) {
  window.history.replaceState(null, '', id ? noteLocation(id) : '/recall');
  return render(<TestPresentation><RecallView /></TestPresentation>);
}

it('loads root only, fetches an expanded folder once and does not reload it for file selection', async () => {
  const user = userEvent.setup();
  mount();
  const shelf = await screen.findByRole('button', { name: 'Shelf' });
  expect(directories).toEqual([[]]);
  expect(trees).toBe(0);
  await user.click(shelf);
  const alpha = await screen.findByRole('link', { name: 'Alpha.md' });
  expect(directories).toEqual([[], ['Shelf']]);
  await user.click(alpha);
  await screen.findByRole('article', { name: 'Alpha.md' });
  await user.click(screen.getByRole('link', { name: 'Beta.md' }));
  await screen.findByRole('article', { name: 'Beta.md' });
  await user.click(shelf);
  await user.click(shelf);
  expect(await screen.findByRole('link', { name: 'Alpha.md' })).toBeInTheDocument();
  expect(directories).toEqual([[], ['Shelf']]);
  expect(trees).toBe(0);
});

it('loads ancestors of a direct file URL without scanning unrelated folders', async () => {
  mount(['Shelf', 'Alpha.md']);
  await screen.findByRole('article', { name: 'Alpha.md' });
  expect(await screen.findByRole('link', { name: 'Alpha.md' })).toHaveAttribute('aria-current', 'page');
  expect(directories).toEqual([[], ['Shelf']]);
  expect(trees).toBe(0);
});

it('rejects a root response containing a child from another parent', async () => {
  interceptRoot = async () => jsonResponse({ rootIdentity: 'root', directoryIdentity: 'root', id: [], entries: [
    { kind: 'note', name: 'Wrong.md', id: ['elsewhere', 'Wrong.md'], identity: 'id', version: 'version' },
  ] });
  mount();
  expect(await screen.findByText('Vault service unavailable')).toBeInTheDocument();
  expect(screen.queryByText('Wrong.md')).not.toBeInTheDocument();
  expect(trees).toBe(0);
});

it('reuses expanded listings across a Recall view remount after checking the root identity', async () => {
  const user = userEvent.setup();
  window.history.replaceState(null, '', '/recall');
  const view = render(<TestPresentation><RecallView /></TestPresentation>);
  await user.click(await screen.findByRole('button', { name: 'Shelf' }));
  await screen.findByRole('link', { name: 'Alpha.md' });
  view.rerender(<TestPresentation><div>Other view</div></TestPresentation>);
  expect(screen.getByText('Other view')).toBeInTheDocument();
  view.rerender(<TestPresentation><RecallView /></TestPresentation>);
  expect(await screen.findByRole('link', { name: 'Alpha.md' })).toBeInTheDocument();
  await waitFor(() => expect(directories.filter(id => !id.length)).toHaveLength(2));
  expect(directories.filter(id => JSON.stringify(id) === '["Shelf"]')).toHaveLength(1);
  expect(trees).toBe(0);
});

it('revalidates on window focus without blanking and discards old listings when vault identity changes', async () => {
  const user = userEvent.setup();
  mount();
  await user.click(await screen.findByRole('button', { name: 'Shelf' }));
  await screen.findByRole('link', { name: 'Alpha.md' });
  const root = deferred<Response>();
  interceptRoot = () => root.promise;
  fireEvent.focus(window);
  await waitFor(() => expect(directories.filter(id => !id.length)).toHaveLength(2));
  expect(screen.getByRole('link', { name: 'Alpha.md' })).toBeInTheDocument();
  tree = { rootIdentity: 'different-vault', entries: [{ kind: 'directory', name: 'Fresh', id: ['Fresh'], identity: 'fresh-id', version: 'fresh-version', children: [] }] };
  await act(async () => root.resolve(jsonResponse({ rootIdentity: tree.rootIdentity, directoryIdentity: tree.rootIdentity, id: [], entries: [{ kind: 'directory', name: 'Fresh', id: ['Fresh'], identity: 'fresh-id', version: 'fresh-version' }] })));
  expect(await screen.findByRole('button', { name: 'Fresh' })).toBeInTheDocument();
  expect(screen.queryByText('Alpha.md')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Shelf' })).not.toBeInTheDocument();
});

it('refreshes expanded folders on focus to reveal external changes without a full-tree read', async () => {
  const user = userEvent.setup();
  mount();
  await user.click(await screen.findByRole('button', { name: 'Shelf' }));
  await screen.findByRole('link', { name: 'Alpha.md' });
  const shelf = tree.entries.find(entry => entry.kind === 'directory' && entry.name === 'Shelf');
  if (!shelf || shelf.kind !== 'directory') throw new Error('Missing fixture shelf');
  shelf.children.push({ kind: 'note', name: 'External.md', id: ['Shelf', 'External.md'], identity: 'external-id', version: 'external-version' });
  fireEvent.focus(window);
  expect(screen.getByRole('link', { name: 'Alpha.md' })).toBeInTheDocument();
  expect(await screen.findByRole('link', { name: 'External.md' })).toBeInTheDocument();
  expect(directories.filter(id => JSON.stringify(id) === '["Shelf"]')).toHaveLength(2);
  expect(trees).toBe(0);
});

it('revalidates a cached collapsed folder only when reopened after focus', async () => {
  const user = userEvent.setup();
  mount();
  const button = await screen.findByRole('button', { name: 'Shelf' });
  await user.click(button);
  await screen.findByRole('link', { name: 'Alpha.md' });
  await user.click(button);
  const shelf = tree.entries.find(entry => entry.kind === 'directory' && entry.name === 'Shelf');
  if (!shelf || shelf.kind !== 'directory') throw new Error('Missing fixture shelf');
  shelf.children.push({ kind: 'note', name: 'External.md', id: ['Shelf', 'External.md'], identity: 'external-id', version: 'external-version' });
  const rootReply = deferred<Response>();
  interceptRoot = () => rootReply.promise;
  const shelfReply = deferred<Response>();
  interceptShelf = () => shelfReply.promise;
  fireEvent.focus(window);
  await waitFor(() => expect(directories).toEqual([[], ['Shelf'], []]));
  const root = fixtureDirectory(tree, []);
  if (!root) throw new Error('Missing fixture root');
  await act(async () => rootReply.resolve(jsonResponse(root)));
  expect(directories).toEqual([[], ['Shelf'], []]);
  await user.click(button);
  await waitFor(() => expect(directories).toEqual([[], ['Shelf'], [], ['Shelf']]));
  // Cached contents remain usable while the refreshed listing is in flight.
  expect(screen.getByRole('link', { name: 'Alpha.md' })).toBeInTheDocument();
  const listing = fixtureDirectory(tree, ['Shelf']);
  if (!listing) throw new Error('Missing fixture shelf');
  await act(async () => shelfReply.resolve(jsonResponse(listing)));
  expect(await screen.findByRole('link', { name: 'External.md' })).toBeInTheDocument();
  expect(trees).toBe(0);
});

it('reveals a directly selected desktop row when its ancestor listing arrives late', async () => {
  const pending = deferred<Response>();
  interceptShelf = () => pending.promise;
  const scrolled: HTMLElement[] = [];
  const previous = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView');
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn(function (this: HTMLElement) { scrolled.push(this); }) });
  try {
    mount(['Shelf', 'Alpha.md']);
    await screen.findByRole('article', { name: 'Alpha.md' });
    await waitFor(() => expect(directories).toContainEqual(['Shelf']));
    expect(screen.queryByRole('link', { name: 'Alpha.md' })).not.toBeInTheDocument();
    const listing = fixtureDirectory(tree, ['Shelf']);
    if (!listing) throw new Error('Missing fixture shelf');
    await act(async () => pending.resolve(jsonResponse(listing)));
    const row = await screen.findByRole('link', { name: 'Alpha.md' });
    await waitFor(() => expect(scrolled).toContain(row));
  } finally {
    if (previous) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', previous);
    else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
  }
});

it('focuses a selected mobile row after opening Files and its delayed ancestor arrives', async () => {
  installViewport(390);
  const pending = deferred<Response>();
  interceptShelf = () => pending.promise;
  const user = userEvent.setup();
  mount(['Shelf', 'Alpha.md']);
  await screen.findByRole('article', { name: 'Alpha.md' });
  await waitFor(() => expect(directories).toContainEqual(['Shelf']));
  await user.click(screen.getByRole('button', { name: 'Expand files sidebar' }));
  const listing = fixtureDirectory(tree, ['Shelf']);
  if (!listing) throw new Error('Missing fixture shelf');
  await act(async () => pending.resolve(jsonResponse(listing)));
  const row = await screen.findByRole('link', { name: 'Alpha.md' });
  await waitFor(() => expect(row).toHaveFocus());
});

it('does not steal focus when the user moves it while a selected row is loading', async () => {
  installViewport(390);
  const pending = deferred<Response>();
  interceptShelf = () => pending.promise;
  const user = userEvent.setup();
  mount(['Shelf', 'Alpha.md']);
  await screen.findByRole('article', { name: 'Alpha.md' });
  await waitFor(() => expect(directories).toContainEqual(['Shelf']));
  await user.click(screen.getByRole('button', { name: 'Expand files sidebar' }));
  const search = screen.getByRole('searchbox');
  await user.click(search);
  expect(search).toHaveFocus();
  const listing = fixtureDirectory(tree, ['Shelf']);
  if (!listing) throw new Error('Missing fixture shelf');
  await act(async () => pending.resolve(jsonResponse(listing)));
  await screen.findByRole('link', { name: 'Alpha.md' });
  expect(search).toHaveFocus();
});

it('refreshes the affected root after creating a folder without a whole-vault scan', async () => {
  const user = userEvent.setup();
  mount();
  await screen.findByRole('button', { name: 'Shelf' });
  await user.click(screen.getByRole('button', { name: 'Vault actions' }));
  await user.click(screen.getByRole('menuitem', { name: /New folder/ }));
  const dialog = screen.getByRole('dialog');
  await user.type(within(dialog).getByLabelText('Folder name'), 'Created');
  await user.click(within(dialog).getByRole('button', { name: 'Create folder' }));
  expect(await screen.findByRole('button', { name: 'Created' })).toBeInTheDocument();
  expect(directories.filter(id => !id.length).length).toBeGreaterThanOrEqual(2);
  expect(trees).toBe(0);
});

it('resolves a unique media name in an unopened folder using a complete view on demand', async () => {
  const user = userEvent.setup();
  text = '![[unique.png]]';
  mount();
  await user.click(await screen.findByRole('button', { name: 'Shelf' }));
  const alpha = await screen.findByRole('link', { name: 'Alpha.md' });
  expect(trees).toBe(0);
  await user.click(alpha);
  const image = await screen.findByRole('img', { name: 'unique.png' });
  const url = new URL(image.getAttribute('src') ?? '', window.location.origin);
  expect(JSON.parse(url.searchParams.get('id') ?? 'null')).toEqual(['Media', 'unique.png']);
  expect(trees).toBe(1);
  expect(directories).not.toContainEqual(['Media']);
});

it('obtains complete folder choices only when a move dialog needs them', async () => {
  const user = userEvent.setup();
  mount();
  await user.click(await screen.findByRole('button', { name: 'Shelf' }));
  await screen.findByRole('link', { name: 'Alpha.md' });
  expect(trees).toBe(0);
  await user.click(screen.getByRole('button', { name: 'Actions for Alpha.md' }));
  await user.click(screen.getByRole('menuitem', { name: /Move/ }));
  const dialog = await screen.findByRole('dialog');
  await user.click(await within(dialog).findByText('Folders in Destination'));
  expect(within(dialog).getByRole('radio', { name: 'Nested' })).toBeInTheDocument();
  expect(trees).toBe(1);
  expect(directories).not.toContainEqual(['Destination']);
});
