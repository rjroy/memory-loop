import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import RecallView from '../../src/views/RecallView';
import { TestPresentation } from './fixtures/presentation';
import { alphaId, betaId, deferred, installVaultApi, installViewport, jsonResponse, noteLocation } from './fixtures/recall';

const revision = 'a'.repeat(64);
const nextRevision = 'b'.repeat(64);
const source = '# Original\n\nExact source.\n';
type Save = { id: readonly string[]; markdown: string; expectedRevision: string };
let saves: Save[];
let save: (body: Save) => Response | Promise<Response>;
let api: ReturnType<typeof installVaultApi>;

beforeEach(() => {
  installViewport(1440);
  saves = [];
  save = () => jsonResponse({ revision: nextRevision });
  api = installVaultApi({ note: id => jsonResponse({ name: id.at(-1), markdown: source, revision, editable: true }) });
  const read = api.getMockImplementation();
  if (!read) throw new Error('Missing test fetch implementation');
  api.mockImplementation(async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), window.location.origin);
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    if (url.origin === window.location.origin && url.pathname === '/api/vault/note' && method === 'POST') {
      const body: Save = JSON.parse(String(init?.body));
      saves.push(body);
      return save(body);
    }
    return read(input, init);
  });
});

function mount(path = noteLocation(alphaId)) {
  window.history.replaceState(null, '', path);
  return render(<TestPresentation><RecallView /></TestPresentation>);
}

async function edit(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByRole('article', { name: 'Alpha #1.md' });
  await user.click(screen.getByRole('button', { name: 'Edit' }));
  return screen.getByRole('textbox', { name: /markdown/i });
}

describe('Recall: explicit Markdown editing', () => {
  it('offers editing only after an eligible read, preserves exact source, and cancels unchanged without a write', async () => {
    const pending = deferred<Response>();
    api = installVaultApi({ note: () => pending.promise });
    const user = userEvent.setup();
    mount();
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    await act(async () => pending.resolve(jsonResponse({ name: 'Alpha #1.md', markdown: source, revision, editable: true })));
    const editor = await edit(user);
    expect(editor).toHaveValue(source);
    expect(editor).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('article', { name: 'Alpha #1.md' })).toHaveTextContent('Exact source.');
    expect(saves).toEqual([]);
  });

  it('uses exact dirty comparison and renders only the confirmed saved snapshot', async () => {
    const user = userEvent.setup();
    mount();
    const editor = await edit(user);
    fireEvent.change(editor, { target: { value: `${source} ` } });
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    fireEvent.change(editor, { target: { value: source } });
    expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    const draft = '# Saved heading\n\n**Saved body**\n';
    fireEvent.change(editor, { target: { value: draft } });
    expect(saves).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByRole('button', { name: 'Edit' });
    expect(saves).toEqual([{ id: alphaId, markdown: draft, expectedRevision: revision }]);
    expect(screen.getByRole('article', { name: 'Alpha #1.md' })).toHaveTextContent('Saved body');
    expect(screen.getByText(/Note saved\./)).toBeInTheDocument();
  });

  it('allows an empty eligible note to be edited', async () => {
    api = installVaultApi({ note: id => jsonResponse({ name: id.at(-1), markdown: '', revision, editable: true }) });
    const user = userEvent.setup();
    mount();
    const editor = await edit(user);
    expect(editor).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    fireEvent.change(editor, { target: { value: 'New content' } });
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });

  it('does not discard or navigate while a save is unresolved', async () => {
    const pending = deferred<Response>();
    save = () => pending.promise;
    const user = userEvent.setup();
    mount();
    const editor = await edit(user);
    fireEvent.change(editor, { target: { value: 'Pending draft' } });
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await user.click(within(screen.getByRole('navigation', { name: 'Vault files' })).getByRole('link', { name: 'Beta.md' }));
    expect(screen.getByText(/Saving… Please wait before leaving\./)).toBeInTheDocument();
    expect(editor).toHaveValue('Pending draft');
    expect(window.location.search).toBe(new URL(noteLocation(alphaId), window.location.origin).search);
    await act(async () => pending.resolve(jsonResponse({ revision: nextRevision })));
    await screen.findByRole('button', { name: 'Edit' });
    expect(saves).toHaveLength(1);
  });

  it('retains newer typing during a pending save and fences the next save with the acknowledged revision', async () => {
    const pending = deferred<Response>();
    save = () => pending.promise;
    const user = userEvent.setup();
    mount();
    const editor = await edit(user);
    fireEvent.change(editor, { target: { value: 'First snapshot' } });
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('button', { name: /Saving/ })).toBeDisabled();
    fireEvent.change(editor, { target: { value: 'First snapshot and newer text' } });
    await act(async () => pending.resolve(jsonResponse({ revision: nextRevision })));
    expect(editor).toHaveValue('First snapshot and newer text');
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    expect(screen.getByText(/Saved\. Newer changes are not saved yet\./)).toBeInTheDocument();
    expect(saves).toEqual([{ id: alphaId, markdown: 'First snapshot', expectedRevision: revision }]);
    save = () => jsonResponse({ revision: 'c'.repeat(64) });
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(saves).toHaveLength(2));
    expect(saves[1]).toEqual({ id: alphaId, markdown: 'First snapshot and newer text', expectedRevision: nextRevision });
  });

  it('holds a different file selection until an explicit discard and preserves the draft on keep editing', async () => {
    const user = userEvent.setup();
    mount();
    const editor = await edit(user);
    fireEvent.change(editor, { target: { value: 'Unfinished draft' } });
    const files = screen.getByRole('navigation', { name: 'Vault files' });
    await user.click(within(files).getByRole('link', { name: 'Beta.md' }));
    expect(screen.getByText('Discard unsaved changes?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Keep editing' })).toHaveFocus();
    expect(window.location.search).toBe(new URL(noteLocation(alphaId), window.location.origin).search);
    expect(api.mock.calls.filter(([input]) => {
      const url = new URL(input instanceof Request ? input.url : String(input), window.location.origin);
      return url.pathname === '/api/vault/note' && url.searchParams.get('id') === JSON.stringify(betaId);
    })).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(editor).toHaveValue('Unfinished draft');
    await user.click(within(files).getByRole('link', { name: 'Beta.md' }));
    await user.click(screen.getByRole('button', { name: 'Discard changes' }));
    await screen.findByRole('article', { name: 'Beta.md' });
    expect(window.location.search).toBe(new URL(noteLocation(betaId), window.location.origin).search);
    expect(saves).toEqual([]);
  });

  it.each([
    { label: 'known rejection', response: () => jsonResponse({ error: { code: 'invalid_request', message: 'fixture' } }, 400), copy: /Couldn't save this note\./ },
    { label: 'uncertain transport', response: () => Promise.reject(new TypeError('fixture transport')), copy: /Save not confirmed\./ },
    { label: 'uncertain daemon outcome', response: () => jsonResponse({ error: { code: 'note_save_uncertain', message: 'fixture' } }, 503), copy: /Save not confirmed\./ },
  ])('retains the draft and original revision after $label', async ({ response, copy }) => {
    save = response;
    const user = userEvent.setup();
    mount();
    const editor = await edit(user);
    fireEvent.change(editor, { target: { value: 'Retained draft' } });
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText(copy);
    expect(editor).toHaveValue('Retained draft');
    save = () => jsonResponse({ revision: nextRevision });
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(saves).toHaveLength(2));
    expect(saves[1]).toEqual({ id: alphaId, markdown: 'Retained draft', expectedRevision: revision });
  });

  it('retains a conflicted draft and requires confirmation before reloading the saved note', async () => {
    save = () => jsonResponse({ error: { code: 'note_conflict', message: 'fixture' } }, 409);
    const user = userEvent.setup();
    mount();
    const editor = await edit(user);
    fireEvent.change(editor, { target: { value: 'Conflicting draft' } });
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText(/This note has changed since you opened it\./);
    expect(editor).toHaveValue('Conflicting draft');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Reload saved note' }));
    expect(screen.getByText('Discard unsaved changes?')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(editor).toHaveValue('Conflicting draft');
  });
});
