import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import RecallView from '../../src/views/RecallView';
import { TestPresentation } from './fixtures/presentation';
import { installVaultApi, installViewport, jsonResponse, noteLocation } from './fixtures/recall';

const revision = 'a'.repeat(64);
const alphaId = ['Alpha #1.md'] as const;
const textFiles = [
  { name: 'settings.json', text: '{\n  "name": "café",\n  "enabled": true\n}\n' },
  { name: 'example.ts', text: 'const value = "<script>";\n\tconsole.log(value);\n' },
  { name: 'LICENSE', text: 'First line\n\tIndented\nLast line  \n' },
] as const;
const files = [...textFiles.map(file => file.name), 'photo.png', 'clip.mp4', 'opaque.bin', 'unsafe.html'];
const genericEntry = (name: string) => ({ kind: 'file' as const, name, id: [name], identity: `identity:${name}`, version: `version:${name}` });
let entries: ReturnType<typeof genericEntry>[];
let movedEntries: ReturnType<typeof genericEntry>[];
let mutations: unknown[];
let metadataReads: string[];

// Provisional boundary only: metadata is classified by the daemon, not by the
// browser's filename heuristic. Keep route and response assumptions here until
// the reviewed metadata/content contract is available. All fetches are mocked.
function installMediaFixture() {
  const api = installVaultApi({
    tree: () => jsonResponse({ rootIdentity: 'fixture-root-identity', entries: [
      { kind: 'note', name: 'Alpha #1.md', id: alphaId, identity: 'note-identity', version: 'note-version' },
      ...entries,
      { kind: 'directory', name: 'Destination', id: ['Destination'], identity: 'destination-identity', version: 'destination-version', children: movedEntries },
    ] }),
    note: id => jsonResponse({ name: id.at(-1), markdown: '# Original Markdown\n', revision, editable: true }),
  });
  const reads = api.getMockImplementation();
  if (!reads) throw new Error('Missing test fetch implementation');
  api.mockImplementation(async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), window.location.origin);
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    if (url.origin === window.location.origin && url.pathname === '/api/vault/actions' && method === 'POST') {
      const body: unknown = JSON.parse(String(init?.body));
      mutations.push(body);
      if (typeof body === 'object' && body !== null && 'action' in body && body.action === 'delete' && 'id' in body) {
        entries = entries.filter(entry => JSON.stringify(entry.id) !== JSON.stringify(body.id));
        return jsonResponse({ id: body.id });
      }
      if (typeof body === 'object' && body !== null && 'action' in body && body.action === 'move' && 'id' in body) {
        const entry = entries.find(item => JSON.stringify(item.id) === JSON.stringify(body.id));
        if (!entry) throw new Error('Unknown move source');
        entries = entries.filter(item => item !== entry);
        const id = ['Destination', entry.name];
        movedEntries.push({ ...entry, id });
        return jsonResponse({ id });
      }
      throw new Error('Unexpected fixture action');
    }
    if (url.origin === window.location.origin && url.pathname === '/api/vault/file' && method === 'GET') {
      const id: unknown = JSON.parse(url.searchParams.get('id') ?? 'null');
      if (!Array.isArray(id) || id.length !== 1 || typeof id[0] !== 'string') throw new Error('Invalid fixture file ID');
      const name = id[0];
      metadataReads.push(name);
      const text = textFiles.find(file => file.name === name);
      if (text) return jsonResponse({ name, kind: 'text', text: text.text });
      if (name === 'photo.png') return jsonResponse({ name, kind: 'image', contentType: 'image/png' });
      if (name === 'clip.mp4') return jsonResponse({ name, kind: 'video', contentType: 'video/mp4' });
      if (name === 'opaque.bin' || name === 'unsafe.html') return jsonResponse({ name, kind: 'unsupported' });
      throw new Error('Unknown fixture file');
    }
    return reads(input, init);
  });
}

beforeEach(() => {
  installViewport(1440);
  entries = files.map(genericEntry);
  movedEntries = [];
  mutations = [];
  metadataReads = [];
  installMediaFixture();
});

function mount(path = '/recall') {
  window.history.replaceState(null, '', path);
  return render(<TestPresentation><RecallView /></TestPresentation>);
}

async function selectFile(user: ReturnType<typeof userEvent.setup>, name: string) {
  const filesNav = await screen.findByRole('navigation', { name: 'Vault files' });
  await user.click(await within(filesNav).findByRole('link', { name: accessibleName => accessibleName === name }));
}

function expectSafeDownload() {
  const download = screen.getByRole('link', { name: 'Download original' });
  const href = download.getAttribute('href');
  expect(href).toBeTruthy();
  expect(new URL(href ?? '', window.location.origin).origin).toBe(window.location.origin);
}

describe('Recall: direct file viewers', () => {
  it.each(textFiles)('displays $name as literal read-only UTF-8 text', async ({ name, text }) => {
    const user = userEvent.setup();
    const view = mount();
    await selectFile(user, name);
    await screen.findByText('Text · Read-only');
    await waitFor(() => expect(view.container.querySelector('pre')?.textContent).toBe(text));
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expectSafeDownload();
    expect(view.container.querySelector('script, iframe')).not.toBeInTheDocument();
  });

  it('presents an image and offers the original when decoding fails', async () => {
    const user = userEvent.setup();
    mount();
    await selectFile(user, 'photo.png');
    const image = await screen.findByRole('img', { name: 'photo.png' });
    expectSafeDownload();
    fireEvent.error(image);
    expect(await screen.findByText("This image can't be displayed in this browser.")).toBeInTheDocument();
    expectSafeDownload();
  });

  it('offers paused native video controls and a truthful codec-failure fallback', async () => {
    const user = userEvent.setup();
    const view = mount();
    await selectFile(user, 'clip.mp4');
    await screen.findByText('Video');
    const video = view.container.querySelector('video');
    expect(video).not.toBeNull();
    if (!video) throw new Error('Expected a native video element');
    expect(video.controls).toBe(true);
    expect(video.autoplay).toBe(false);
    expect(video.paused).toBe(true);
    fireEvent.error(video);
    expect(await screen.findByText("This video can't be played in this browser.")).toBeInTheDocument();
    expectSafeDownload();
  });

  it.each(['opaque.bin', 'unsafe.html'])('does not execute or render unsupported %s as a page', async name => {
    const user = userEvent.setup();
    const view = mount();
    await selectFile(user, name);
    expect(await screen.findByText('No preview is available for this file.')).toBeInTheDocument();
    expectSafeDownload();
    expect(view.container.querySelector('iframe, object, embed, script')).not.toBeInTheDocument();
  });

  it('holds a generic-file selection until the Markdown draft is explicitly discarded', async () => {
    const user = userEvent.setup();
    mount(noteLocation(alphaId));
    await screen.findByRole('article', { name: 'Alpha #1.md' });
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const editor = screen.getByRole('textbox', { name: /markdown/i });
    fireEvent.change(editor, { target: { value: 'Keep this draft' } });
    await selectFile(user, 'settings.json');
    expect(await screen.findByText('Discard unsaved changes?')).toBeInTheDocument();
    expect(metadataReads).not.toContain('settings.json');
    expect(window.location.search).toBe(new URL(noteLocation(alphaId), window.location.origin).search);
    await user.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(editor).toHaveValue('Keep this draft');
    await selectFile(user, 'settings.json');
    await user.click(screen.getByRole('button', { name: 'Discard changes' }));
    await screen.findByText('Text · Read-only');
    expect(window.location.search).toBe(new URL(noteLocation(['settings.json']), window.location.origin).search);
  });

  it('offers file actions for a generic file and deletes it only after confirmation', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', { name: 'Actions for opaque.bin' }));
    const menu = screen.getByRole('menu');
    expect(within(menu).getByRole('menuitem', { name: /Move/ })).toBeInTheDocument();
    await user.click(within(menu).getByRole('menuitem', { name: /Delete file/ }));
    expect(mutations).toHaveLength(0);
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Delete file' }));
    await waitFor(() => expect(mutations).toEqual([{ action: 'delete', kind: 'file', id: ['opaque.bin'], expectedVersion: 'version:opaque.bin' }]));
    await waitFor(() => expect(screen.queryByRole('link', { name: 'opaque.bin' })).not.toBeInTheDocument());
  });

  it('moves a generic file without changing its basename', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', { name: 'Actions for photo.png' }));
    await user.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: /Move/ }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('radio', { name: 'Destination' }));
    await user.click(within(dialog).getByRole('button', { name: 'Move file' }));
    await waitFor(() => expect(mutations).toEqual([{ action: 'move', kind: 'file', id: ['photo.png'], expectedVersion: 'version:photo.png',
      destinationParentId: ['Destination'], expectedDestinationIdentity: 'destination-identity' }]));
    expect(await screen.findByRole('link', { name: 'photo.png' })).toHaveAttribute('href', noteLocation(['Destination', 'photo.png']));
  });
});
