import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import MarkdownDocument from '../../src/recall/MarkdownDocument';
import RecallView from '../../src/views/RecallView';
import { TestPresentation } from './fixtures/presentation';
import { deferred, installVaultApi, installViewport, jsonResponse, noteLocation } from './fixtures/recall';

const noteId = ['Notes', 'Page.md'];
const revision = 'a'.repeat(64);
const files = [
  ['Notes', 'local.png'], ['shared.png'], ['Media', 'unique.png'], ['Media', 'clip.mp4'],
  ['Media', 'duplicate.png'], ['Other', 'duplicate.png'], ['Media', 'opaque.bin'], ['Media', 'Photo'],
];
const entry = (id: string[]) => ({ kind: 'file', name: id[id.length - 1], id, identity: `identity:${id.join('/')}`, version: `version:${id.join('/')}` });
const directory = (name: string, children: unknown[]) => ({ kind: 'directory', name, id: [name], identity: `identity:${name}`, version: `version:${name}`, children });
const tree = { rootIdentity: 'fixture-root', entries: [
  directory('Notes', [{ kind: 'note', name: 'Page.md', id: noteId, identity: 'page-identity', version: 'page-version' }, entry(files[0])]),
  entry(files[1]),
  directory('Media', [entry(files[2]), entry(files[3]), entry(files[4]), entry(files[6]), entry(files[7])]),
  directory('Other', [entry(files[5]), { kind: 'note', name: 'Next.md', id: ['Other', 'Next.md'], identity: 'next-identity', version: 'next-version' }]),
] };
let markdown: string;
let metadataReads: string[][];
let treeReads: number;
let metadata: (id: string[]) => Response | Promise<Response>;

beforeEach(() => {
  installViewport(1440);
  markdown = '';
  metadataReads = [];
  treeReads = 0;
  metadata = id => {
    const name = id.at(-1);
    return jsonResponse(name === 'opaque.bin' ? { name, kind: 'unsupported' }
      : name === 'clip.mp4' ? { name, kind: 'video', contentType: 'video/mp4' }
        : { name, kind: 'image', contentType: 'image/png' });
  };
  const api = installVaultApi({
    tree: () => { treeReads++; return jsonResponse(tree); },
    note: id => jsonResponse({ name: id.at(-1), markdown: id.at(-1) === 'Next.md' ? '# Next document' : markdown, revision, editable: true }),
  });
  const reads = api.getMockImplementation();
  if (!reads) throw new Error('Missing isolated fetch fixture');
  api.mockImplementation(async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), window.location.origin);
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    if (url.origin === window.location.origin && url.pathname === '/api/vault/file' && method === 'GET') {
      const id: unknown = JSON.parse(url.searchParams.get('id') ?? 'null');
      if (!Array.isArray(id) || !id.length || !id.every(part => typeof part === 'string')) throw new Error('Invalid fixture ID');
      metadataReads.push(id);
      return metadata(id);
    }
    return reads(input, init);
  });
});

function mountNote(source: string) {
  markdown = source;
  window.history.replaceState(null, '', noteLocation(noteId));
  return render(<TestPresentation><RecallView /></TestPresentation>);
}

function expectContentId(element: Element, id: string[]) {
  const src = element.getAttribute('src');
  expect(src).toBeTruthy();
  const url = new URL(src ?? '', window.location.origin);
  expect(url.origin).toBe(window.location.origin);
  expect(url.pathname).toBe('/api/vault/content');
  expect(JSON.parse(url.searchParams.get('id') ?? 'null')).toEqual(id);
}

describe('Recall: local Markdown media embeds', () => {
  it.each([
    { name: 'inline image', source: '![[Photo]](local.png)' },
    { name: 'reference image', source: '![[Photo]][pic]\n\n[pic]: local.png' },
  ])('preserves CommonMark bracketed alt text for a standard $name', async ({ source }) => {
    mountNote(`${source}\n\n![[unique.png]]`);
    expectContentId(await screen.findByRole('img', { name: '[Photo]' }), ['Notes', 'local.png']);
    expectContentId(await screen.findByRole('img', { name: 'unique.png' }), ['Media', 'unique.png']);
    expect(screen.queryByText('Media not found: “Photo”.')).not.toBeInTheDocument();
    expect(metadataReads).not.toContainEqual(['Media', 'Photo']);
  });

  it('resolves Markdown relative paths and a unique Obsidian filename from the existing tree', async () => {
    mountNote('![Local photo](local.png)\n\n![Shared photo](../shared.png)\n\n![[unique.png]]\n\n![[/Media/clip.mp4]]');
    expectContentId(await screen.findByRole('img', { name: 'Local photo' }), ['Notes', 'local.png']);
    expectContentId(await screen.findByRole('img', { name: 'Shared photo' }), ['shared.png']);
    expectContentId(await screen.findByRole('img', { name: 'unique.png' }), ['Media', 'unique.png']);
    const article = screen.getByRole('article', { name: 'Page.md' });
    await waitFor(() => expect(article.querySelector('video')).not.toBeNull());
    const video = article.querySelector('video');
    if (!video) throw new Error('Expected embedded video');
    expectContentId(video.getAttribute('src') ? video : video.querySelector('source') ?? video, ['Media', 'clip.mp4']);
    expect(video.controls).toBe(true);
    expect(video.autoplay).toBe(false);
    expect(treeReads).toBe(1);
  });

  it('explains missing, ambiguous and unsupported targets without guessing a match', async () => {
    mountNote('![[missing.png]]\n\n![[duplicate.png]]\n\n![[/Media/opaque.bin]]');
    expect(await screen.findByText('Media not found: “missing.png”.')).toBeInTheDocument();
    expect(await screen.findByText('More than one file matches “duplicate.png”. Use a vault-relative path.')).toBeInTheDocument();
    expect(await screen.findByText('No preview is available for this file.')).toBeInTheDocument();
    expect(metadataReads).not.toContainEqual(['Media', 'duplicate.png']);
    expect(metadataReads).not.toContainEqual(['Other', 'duplicate.png']);
  });

  it('never loads remote, active or vault-escaping references', async () => {
    const view = mountNote('![Remote](https://remote.invalid/photo.png)\n\n![Data](data:image/png;base64,AA)\n\n![Script](javascript:alert)\n\n![Escape](../../outside.png)');
    await screen.findByText("Remote media isn't loaded.");
    const article = screen.getByRole('article', { name: 'Page.md' });
    expect(within(article).queryByRole('img')).not.toBeInTheDocument();
    expect(view.container.querySelector('iframe, object, embed, script')).not.toBeInTheDocument();
    expect(metadataReads).toEqual([]);
  });

  it('leaves code spans, fenced code and escaped embed syntax as literal source', async () => {
    mountNote('`![[unique.png]]`\n\n```md\n![Example](local.png)\n![[unique.png]]\n```\n\n\\![[unique.png]]');
    const article = await screen.findByRole('article', { name: 'Page.md' });
    expect(within(article).getAllByText('![[unique.png]]').length).toBeGreaterThanOrEqual(1);
    expect(within(article).getByLabelText('Code block')).toHaveTextContent('![Example](local.png)');
    expect(within(article).queryByRole('img')).not.toBeInTheDocument();
    expect(metadataReads).toEqual([]);
  });

  it('keeps the shared renderer without Recall context image-suppressed', () => {
    render(<MarkdownDocument markdown={'![Outside Recall](https://remote.invalid/image.png)\n\n![[unique.png]]'} />);
    expect(screen.getByText('Image not shown: Outside Recall')).toBeInTheDocument();
    expect(screen.getByText('![[unique.png]]')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(metadataReads).toEqual([]);
  });

  it('does not attach late embed metadata to a subsequently selected note', async () => {
    const pending = deferred<Response>();
    metadata = () => pending.promise;
    const user = userEvent.setup();
    mountNote('![Pending image](local.png)');
    await waitFor(() => expect(metadataReads).toContainEqual(['Notes', 'local.png']));
    const nav = screen.getByRole('navigation', { name: 'Vault files' });
    await user.click(within(nav).getByRole('button', { name: 'Other' }));
    await user.click(within(nav).getByRole('link', { name: 'Next.md' }));
    expect(await screen.findByRole('article', { name: 'Next.md' })).toHaveTextContent('Next document');
    await act(async () => pending.resolve(jsonResponse({ name: 'local.png', kind: 'image', contentType: 'image/png' })));
    expect(screen.queryByRole('img', { name: 'Pending image' })).not.toBeInTheDocument();
    expect(screen.getByRole('article', { name: 'Next.md' })).toHaveTextContent('Next document');
    expect(window.location.search).toBe(new URL(noteLocation(['Other', 'Next.md']), window.location.origin).search);
  });
});
