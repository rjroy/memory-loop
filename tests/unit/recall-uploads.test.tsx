import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import RecallView from '../../src/views/RecallView';
import { TestPresentation } from './fixtures/presentation';
import { alphaId, fixtureTree, installVaultApi, installViewport, jsonResponse, noteLocation, vaultTree } from './fixtures/recall';

type User = ReturnType<typeof userEvent.setup>;
const revision = 'a'.repeat(64);
const maxFileBytes = 100 * 1024 * 1024;
let empty: boolean;
let limit: number;
let attachmentNames: string[];
let requests: FixtureXHR[];

// This is a test-owned browser transport, not a replacement upload API. It gives
// the UI real XHR-style progress and delayed acknowledgement events. If the
// production browser adapter uses fetch instead, align this single boundary.
class FixtureProgress extends EventTarget {
  onprogress: ((event: ProgressEvent) => void) | null = null;
  emit(loaded: number, total: number) {
    const event = new ProgressEvent('progress', { lengthComputable: true, loaded, total });
    this.onprogress?.(event);
    this.dispatchEvent(event);
  }
}

class FixtureXHR extends EventTarget {
  upload = new FixtureProgress();
  method = '';
  url = '';
  body: Document | XMLHttpRequestBodyInit | null = null;
  status = 0;
  responseText = '';
  response: unknown = null;
  responseType: XMLHttpRequestResponseType = '';
  readyState = 0;
  timeout = 0;
  onload: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onabort: ((event: Event) => void) | null = null;
  ontimeout: ((event: Event) => void) | null = null;
  onloadend: ((event: Event) => void) | null = null;
  onreadystatechange: ((event: Event) => void) | null = null;
  open(method: string, url: string | URL) { this.method = method; this.url = String(url); this.readyState = 1; }
  setRequestHeader(_name: string, _value: string) { /* Not part of these UI assertions. */ }
  getResponseHeader(name: string) { return name.toLowerCase() === 'content-type' ? 'application/json' : null; }
  send(body: Document | XMLHttpRequestBodyInit | null = null) {
    const url = new URL(this.url, window.location.origin);
    if (url.origin !== window.location.origin || url.pathname !== '/api/vault/attachments' || this.method.toUpperCase() !== 'POST') {
      throw new Error('Unexpected upload fixture request');
    }
    this.body = body;
    requests.push(this);
  }
  private emit(type: 'load' | 'error' | 'abort' | 'timeout' | 'loadend' | 'readystatechange') {
    const event = new Event(type);
    this[`on${type}`]?.(event);
    this.dispatchEvent(event);
  }
  finish(status: number, value: unknown) {
    this.status = status;
    this.responseText = JSON.stringify(value);
    this.response = this.responseType === 'json' ? value : this.responseText;
    this.readyState = 4;
    this.emit('readystatechange');
    this.emit('load');
    this.emit('loadend');
  }
  fail() { this.emit('error'); this.emit('loadend'); }
  expire() { this.emit('timeout'); this.emit('loadend'); }
  abort() { this.emit('abort'); this.emit('loadend'); }
}

beforeEach(() => {
  installViewport(1440);
  empty = false;
  limit = maxFileBytes;
  attachmentNames = [];
  requests = [];
  vi.stubGlobal('XMLHttpRequest', FixtureXHR);
  const api = installVaultApi({
    tree: () => jsonResponse({ ...fixtureTree(empty ? [] : vaultTree.entries), entries: [
      ...(empty ? [] : vaultTree.entries),
      ...(attachmentNames.length ? [{ kind: 'directory', name: '06_Attachments', id: ['06_Attachments'],
        identity: 'attachments-identity', version: 'attachments-version', children: attachmentNames.map(name => ({
          kind: 'file', name, id: ['06_Attachments', name], identity: `identity:${name}`, version: `version:${name}`,
        })) }] : []),
    ] }),
    note: id => jsonResponse({ name: id.at(-1), markdown: '# Original note\n', revision, editable: true }),
  });
  const reads = api.getMockImplementation();
  if (!reads) throw new Error('Missing isolated fetch fixture');
  api.mockImplementation(async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), window.location.origin);
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    if (url.origin === window.location.origin && url.pathname === '/api/vault/attachments' && method === 'GET') {
      return jsonResponse({ maxFileBytes: limit });
    }
    return reads(input, init);
  });
});

function mount(path = noteLocation(alphaId)) {
  window.history.replaceState(null, '', path);
  return render(<TestPresentation><RecallView /></TestPresentation>);
}

async function openUpload(user: User) {
  await user.click(await screen.findByRole('button', { name: 'Vault actions' }));
  await user.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Upload files…' }));
  return screen.getByRole('dialog', { name: 'Upload files' });
}

async function choose(user: User, dialog: HTMLElement, files: File[]) {
  const input = dialog.querySelector('input[type="file"]');
  if (!(input instanceof HTMLInputElement)) throw new Error('Expected native file input');
  await user.upload(input, files);
  return input;
}

function confirmed(name: string, size: number) {
  attachmentNames.push(name);
  return { id: ['06_Attachments', name], name, size };
}

describe('Recall: attachment uploads', () => {
  it('offers a native multi-file picker in an empty vault and removes queued files without uploading', async () => {
    empty = true;
    const user = userEvent.setup();
    mount('/recall');
    const dialog = await openUpload(user);
    expect(within(dialog).getByText('Destination: 06_Attachments/')).toBeInTheDocument();
    const input = await choose(user, dialog, [new File(['hello'], 'note.txt', { type: 'text/plain' })]);
    expect(input.multiple).toBe(true);
    expect(input).not.toHaveAttribute('capture');
    expect(input).not.toHaveAttribute('accept');
    expect(within(dialog).queryByRole('button', { name: /take photo/i })).not.toBeInTheDocument();
    expect(requests).toHaveLength(0);
    await user.click(within(dialog).getByRole('button', { name: 'Remove note.txt' }));
    expect(within(dialog).queryByText('note.txt')).not.toBeInTheDocument();
    expect(requests).toHaveLength(0);
  });

  it('uses the advertised size limit to prevent an over-limit file from being submitted', async () => {
    empty = true;
    limit = 4;
    const user = userEvent.setup();
    mount('/recall');
    const dialog = await openUpload(user);
    await choose(user, dialog, [new File(['12345'], 'large.txt')]);
    expect(within(dialog).getByText('large.txt')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: /Upload .*file/ })).toBeDisabled();
    expect(requests).toHaveLength(0);
  });

  it('rejects a zero-byte file before dispatch with an explicit reason', async () => {
    const user = userEvent.setup();
    mount();
    const dialog = await openUpload(user);
    await choose(user, dialog, [new File([], 'empty.txt')]);
    expect(within(dialog).getByText('empty.txt')).toBeInTheDocument();
    expect(within(dialog).getByText('Empty files cannot be uploaded.')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: /Upload .*file/ })).toBeDisabled();
    expect(requests).toHaveLength(0);
  });

  it('uploads only nonempty files from a mixed selection and retains the empty-file reason', async () => {
    const user = userEvent.setup();
    mount();
    const dialog = await openUpload(user);
    const nonempty = new File(['content'], 'content.txt');
    await choose(user, dialog, [new File([], 'empty.txt'), nonempty]);
    expect(within(dialog).getByText('Empty files cannot be uploaded.')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Upload 1 file' }));
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0].body).toBe(nonempty);
    await act(async () => requests[0].finish(200, confirmed('content.txt', nonempty.size)));
    expect(await within(dialog).findByText('Uploaded')).toBeInTheDocument();
    expect(within(dialog).getByText('empty.txt')).toBeInTheDocument();
    expect(within(dialog).getByText('Empty files cannot be uploaded.')).toBeInTheDocument();
    expect(requests).toHaveLength(1);
  });

  it('uploads sequentially, sends the original files, and uses the confirmed collision name', async () => {
    const user = userEvent.setup();
    mount();
    const dialog = await openUpload(user);
    const first = new File(['first bytes'], 'photo.jpg', { type: 'image/jpeg' });
    const second = new File(['second bytes'], 'other.txt', { type: 'text/plain' });
    await choose(user, dialog, [first, second]);
    expect(requests).toHaveLength(0);
    await user.click(within(dialog).getByRole('button', { name: 'Upload 2 files' }));
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(new URL(requests[0].url, window.location.origin).searchParams.get('name')).toBe('photo.jpg');
    expect(requests[0].body).toBe(first);
    await act(async () => requests[0].finish(200, confirmed('photo (2).jpg', first.size)));
    await waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[1].body).toBe(second);
    expect(new URL(requests[1].url, window.location.origin).searchParams.get('name')).toBe('other.txt');
    await act(async () => requests[1].finish(200, confirmed('other.txt', second.size)));
    expect(await within(dialog).findByText('Saved as photo (2).jpg')).toBeInTheDocument();
    expect(within(dialog).getByText('photo.jpg')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: '06_Attachments' })).toBeInTheDocument();
    expect(requests).toHaveLength(2);
  });

  it('shows finishing rather than uploaded after all bytes transfer but before acknowledgement', async () => {
    const user = userEvent.setup();
    mount();
    const dialog = await openUpload(user);
    const file = new File(['fixture bytes'], 'pending.txt');
    await choose(user, dialog, [file]);
    await user.click(within(dialog).getByRole('button', { name: 'Upload 1 file' }));
    await waitFor(() => expect(requests).toHaveLength(1));
    await act(async () => requests[0].upload.emit(file.size, file.size));
    expect(await within(dialog).findByText('Finishing upload…')).toBeInTheDocument();
    expect(within(dialog).queryByText('Uploaded')).not.toBeInTheDocument();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(await within(dialog).findByText('Uploading… Please wait before closing.')).toBeInTheDocument();
    expect(requests).toHaveLength(1);
    await act(async () => requests[0].finish(200, confirmed('pending.txt', file.size)));
    expect(await within(dialog).findByText('Uploaded')).toBeInTheDocument();
  });

  it('retains a known failure and retries it only when explicitly requested', async () => {
    const user = userEvent.setup();
    mount();
    const dialog = await openUpload(user);
    const file = new File(['retry'], 'retry.txt');
    await choose(user, dialog, [file]);
    await user.click(within(dialog).getByRole('button', { name: 'Upload 1 file' }));
    await waitFor(() => expect(requests).toHaveLength(1));
    await act(async () => requests[0].finish(503, { error: { code: 'upload_unavailable', message: 'fixture' } }));
    expect(await within(dialog).findByText("Couldn't upload")).toBeInTheDocument();
    expect(within(dialog).getByText('retry.txt')).toBeInTheDocument();
    expect(requests).toHaveLength(1);
    await user.click(within(dialog).getByRole('button', { name: 'Retry failed' }));
    await waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[1].body).toBe(file);
    await act(async () => requests[1].finish(200, confirmed('retry.txt', file.size)));
    expect(await within(dialog).findByText('Uploaded')).toBeInTheDocument();
  });

  it.each([
    { status: 400, code: 'invalid_request', reason: "This file name couldn't be used. Choose a different file." },
    { status: 413, code: 'upload_too_large', reason: 'This file exceeds the server’s upload limit.' },
  ])('does not retry an unchanged file after a permanent $code rejection', async ({ status, code, reason }) => {
    const user = userEvent.setup();
    mount();
    const dialog = await openUpload(user);
    const rejected = new File(['fixture'], 'rejected.txt');
    await choose(user, dialog, [rejected]);
    await user.click(within(dialog).getByRole('button', { name: 'Upload 1 file' }));
    await waitFor(() => expect(requests).toHaveLength(1));
    await act(async () => requests[0].finish(status, { error: { code, message: 'fixture' } }));
    expect(await within(dialog).findByText(reason)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Remove rejected.txt' })).toBeEnabled();
    expect(within(dialog).getByRole('button', { name: 'Choose files…' })).toBeEnabled();
    const retry = within(dialog).queryByRole('button', { name: 'Retry failed' });
    if (retry) expect(retry).toBeDisabled();
    expect(requests).toHaveLength(1);

    const next = new File(['other'], 'other.txt');
    await choose(user, dialog, [next]);
    await user.click(within(dialog).getByRole('button', { name: 'Upload remaining' }));
    await waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[1].body).toBe(next);
    await act(async () => requests[1].finish(200, confirmed('other.txt', next.size)));
    expect(await within(dialog).findByText('Uploaded')).toBeInTheDocument();
    expect(within(dialog).getByText(reason)).toBeInTheDocument();
    expect(requests).toHaveLength(2);
  });

  it.each(['lost acknowledgement', 'uncertain response', 'XHR timeout'])('pauses a batch after %s without replaying the uncertain file', async name => {
    const user = userEvent.setup();
    mount();
    const dialog = await openUpload(user);
    const first = new File(['one'], 'one.txt');
    const second = new File(['two'], 'two.txt');
    await choose(user, dialog, [first, second]);
    await user.click(within(dialog).getByRole('button', { name: 'Upload 2 files' }));
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0].timeout).toBe(0);
    await act(async () => {
      if (name === 'lost acknowledgement') requests[0].fail();
      else if (name === 'XHR timeout') requests[0].expire();
      else requests[0].finish(503, { error: { code: 'upload_uncertain', message: 'fixture' } });
    });
    expect(await within(dialog).findByText('Upload not confirmed.')).toBeInTheDocument();
    expect(within(dialog).getByText('The file may have been saved. Check files before uploading it again.')).toBeInTheDocument();
    expect(requests).toHaveLength(1);
    window.dispatchEvent(new Event('online'));
    expect(requests).toHaveLength(1);
    await user.click(within(dialog).getByRole('button', { name: 'Upload remaining' }));
    await waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[1].body).toBe(second);
    await act(async () => requests[1].finish(200, confirmed('two.txt', second.size)));
    expect(requests).toHaveLength(2);
  });

  it('keeps a dirty note selected after upload and guards explicit Open file', async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByRole('article', { name: 'Alpha #1.md' });
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const editor = screen.getByRole('textbox', { name: /markdown/i });
    fireEvent.change(editor, { target: { value: 'Preserve my draft' } });
    const dialog = await openUpload(user);
    const file = new File(['fixture'], 'draft-attachment.txt');
    await choose(user, dialog, [file]);
    await user.click(within(dialog).getByRole('button', { name: 'Upload 1 file' }));
    await waitFor(() => expect(requests).toHaveLength(1));
    await act(async () => requests[0].finish(200, confirmed('draft-attachment.txt', file.size)));
    const open = await within(dialog).findByRole('button', { name: 'Open file' });
    expect(window.location.search).toBe(new URL(noteLocation(alphaId), window.location.origin).search);
    expect(editor).toHaveValue('Preserve my draft');
    expect(screen.queryByText('Discard unsaved changes?')).not.toBeInTheDocument();
    await user.click(open);
    expect(await screen.findByText('Discard unsaved changes?')).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Upload files' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(editor).toHaveValue('Preserve my draft');
    expect(window.location.search).toBe(new URL(noteLocation(alphaId), window.location.origin).search);
  });

  it('does not steal focus or navigate when an upload completes after the Recall view unmounts', async () => {
    const user = userEvent.setup();
    const view = mount();
    const dialog = await openUpload(user);
    const file = new File(['late'], 'late.txt');
    await choose(user, dialog, [file]);
    await user.click(within(dialog).getByRole('button', { name: 'Upload 1 file' }));
    await waitFor(() => expect(requests).toHaveLength(1));
    view.unmount();
    render(<button type="button">Other destination</button>);
    const destination = screen.getByRole('button', { name: 'Other destination' });
    destination.focus();
    const location = window.location.href;
    await act(async () => requests[0].finish(200, confirmed('late.txt', file.size)));
    expect(destination).toHaveFocus();
    expect(window.location.href).toBe(location);
    expect(requests).toHaveLength(1);
  });
});
