import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import RecallView from '../../src/views/RecallView';
import NextShell from '../../src/shell/NextShell';
import { PresentationContext } from '../../src/shell/presentation';
import type { Presentation } from '../../src/shell/presentation';
import { useRecallSession } from '../../src/recall/RecallSession';
import { TestPresentation } from './fixtures/presentation';
import { alphaId, deferred, fixtureTree, installVaultApi, installViewport, jsonResponse, noteLocation, vaultTree } from './fixtures/recall';

const revision = 'a'.repeat(64);
const source = '# Original\n';
type User = ReturnType<typeof userEvent.setup>;
type Mutation = { url: string; method: string; body: unknown };
let tree: { entries: Parameters<typeof fixtureTree>[0] };
let mutations: Mutation[];
let noteReads: string[][];
let respond: (mutation: Mutation) => Response | Promise<Response>;
let saves: { id: readonly string[]; markdown: string; expectedRevision: string }[];

// All requests are intercepted; no vault is accessed.
beforeEach(() => {
  installViewport(1440);
  tree = structuredClone(vaultTree);
  mutations = [];
  noteReads = [];
  saves = [];
  respond = () => jsonResponse({ id: ['fixture'], revision });
  const api = installVaultApi({
    tree: () => jsonResponse(fixtureTree(tree.entries)),
    note: id => {
      noteReads.push([...id]);
      return jsonResponse({ name: id.at(-1), markdown: id.at(-1) === 'New.md' ? '' : source, revision, editable: true });
    },
  });
  const reads = api.getMockImplementation();
  if (!reads) throw new Error('Missing fixture fetch');
  api.mockImplementation(async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), window.location.origin);
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    if (url.origin === window.location.origin && url.pathname === '/api/vault/note' && method === 'POST') {
      saves.push(JSON.parse(String(init?.body)));
      return jsonResponse({ revision: 'b'.repeat(64) });
    }
    if (url.origin === window.location.origin && url.pathname === '/api/vault/actions' && method === 'POST') {
      const mutation = { url: url.pathname, method, body: init?.body ? JSON.parse(String(init.body)) as unknown : null };
      mutations.push(mutation);
      return respond(mutation);
    }
    return reads(input, init);
  });
});

function mount(path = noteLocation(alphaId)) {
  window.history.replaceState(null, '', path);
  return render(<TestPresentation><RecallView /></TestPresentation>);
}

async function menu(user: User, target: string, action: RegExp) {
  await user.click(await screen.findByRole('button', { name: target }));
  await user.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: action }));
}

async function draft(user: User) {
  await screen.findByRole('article', { name: 'Alpha #1.md' });
  await user.click(screen.getByRole('button', { name: 'Edit' }));
  const editor = screen.getByRole('textbox', { name: /markdown/i });
  fireEvent.change(editor, { target: { value: 'Unfinished draft' } });
  return editor;
}

describe('Recall: file and folder actions', () => {
  it('keeps root actions available in an empty vault and opens the newly created blank Markdown file', async () => {
    tree = { entries: [] };
    respond = () => {
      tree = { entries: [{ kind: 'note', name: 'New.md', id: ['New.md'] }] };
      return jsonResponse({ id: ['New.md'], revision });
    };
    const user = userEvent.setup();
    mount('/recall');
    expect(await screen.findByText('No files to show', { exact: true })).toBeVisible();
    await menu(user, 'Vault actions', /New file/);
    expect(mutations).toHaveLength(0);
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText('File name'), 'New');
    expect(within(dialog).getByText('.md is added if omitted.')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Create file' }));
    await waitFor(() => expect(mutations).toHaveLength(1));
    expect(await screen.findByRole('textbox', { name: /markdown/i })).toHaveValue('');
    expect(noteReads).toContainEqual(['New.md']);
    expect(mutations[0].body).toEqual({ action: 'create-note', parentId: [], expectedParentIdentity: 'fixture-root-identity', name: 'New.md' });
    expect(window.location.search).toBe(new URL(noteLocation(['New.md']), window.location.origin).search);
  });

  it('creates a folder without abandoning an unrelated dirty draft', async () => {
    respond = () => {
      tree.entries.push({ kind: 'directory', name: 'New folder', id: ['New folder'], children: [] });
      return jsonResponse({ id: ['New folder'] });
    };
    const user = userEvent.setup();
    mount();
    const editor = await draft(user);
    await menu(user, 'Vault actions', /New folder/);
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText('Folder name'), 'New folder');
    await user.click(within(dialog).getByRole('button', { name: 'Create folder' }));
    await screen.findByRole('button', { name: 'New folder' });
    expect(mutations).toHaveLength(1);
    expect(mutations[0].body).toEqual({ action: 'create-directory', parentId: [], expectedParentIdentity: 'fixture-root-identity', name: 'New folder' });
    expect(screen.queryByText('Discard unsaved changes?')).not.toBeInTheDocument();
    expect(editor).toHaveValue('Unfinished draft');
  });

  it('opens the row menu by keyboard and context menu without selecting the row', async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByRole('article', { name: 'Alpha #1.md' });
    const row = screen.getByRole('link', { name: 'Beta.md' });
    row.focus();
    await user.keyboard('{Shift>}{F10}{/Shift}');
    expect(screen.getByRole('menuitem', { name: /Move/ })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    fireEvent.contextMenu(row);
    expect(screen.getByRole('menuitem', { name: /Delete file/ })).toBeInTheDocument();
    expect(window.location.search).toBe(new URL(noteLocation(alphaId), window.location.origin).search);
  });

  it('guards a dirty descendant before moving its folder and remaps selection after confirmation', async () => {
    const moved = ['Destination', 'Test shelf & café', 'Alpha #1.md'];
    tree.entries.push({ kind: 'directory', name: 'Destination', id: ['Destination'], children: [] });
    respond = () => {
      tree = { entries: [{ kind: 'directory', name: 'Destination', id: ['Destination'], children: [
        { kind: 'directory', name: 'Test shelf & café', id: ['Destination', 'Test shelf & café'], children: [
          { kind: 'note', name: 'Alpha #1.md', id: moved },
        ] },
      ] }] };
      return jsonResponse({ id: ['Destination', 'Test shelf & café'] });
    };
    const user = userEvent.setup();
    mount();
    const editor = await draft(user);
    await menu(user, 'Actions for Test shelf & café', /Move/);
    let dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Moves this folder and everything inside it.')).toBeInTheDocument();
    expect(within(dialog).queryByRole('textbox')).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('radio', { name: 'Test shelf & café' })).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('radio', { name: 'Destination' }));
    await user.click(within(dialog).getByRole('button', { name: 'Move folder' }));
    expect(await screen.findByText('Discard unsaved changes?')).toBeInTheDocument();
    expect(mutations).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(editor).toHaveValue('Unfinished draft');
    await menu(user, 'Actions for Test shelf & café', /Move/);
    dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('radio', { name: 'Destination' }));
    await user.click(within(dialog).getByRole('button', { name: 'Move folder' }));
    await user.click(await screen.findByRole('button', { name: 'Discard changes' }));
    await waitFor(() => expect(window.location.search).toBe(new URL(noteLocation(moved), window.location.origin).search));
    expect(mutations).toHaveLength(1);
    expect(mutations[0].body).toEqual({ action: 'move', kind: 'directory', id: ['Test shelf & café'],
      expectedVersion: `version:${JSON.stringify(['Test shelf & café'])}`, destinationParentId: ['Destination'],
      expectedDestinationIdentity: `identity:${JSON.stringify(['Destination'])}` });
  });

  it('moves an unrelated file without renaming it or disturbing the current draft', async () => {
    tree.entries.push({ kind: 'directory', name: 'Destination', id: ['Destination'], children: [] });
    respond = () => {
      tree = { entries: [
        { kind: 'directory', name: 'Test shelf & café', id: ['Test shelf & café'], children: [
          { kind: 'note', name: 'Alpha #1.md', id: alphaId },
        ] },
        { kind: 'directory', name: 'Destination', id: ['Destination'], children: [
          { kind: 'note', name: 'Beta.md', id: ['Destination', 'Beta.md'] },
        ] },
      ] };
      return jsonResponse({ id: ['Destination', 'Beta.md'] });
    };
    const user = userEvent.setup();
    mount();
    const editor = await draft(user);
    await menu(user, 'Actions for Beta.md', /Move/);
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).queryByRole('textbox')).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('radio', { name: 'Destination' }));
    await user.click(within(dialog).getByRole('button', { name: 'Move file' }));
    await waitFor(() => expect(mutations).toHaveLength(1));
    expect(mutations[0].body).toEqual({ action: 'move', kind: 'note', id: ['Test shelf & café', 'Beta.md'],
      expectedVersion: `version:${JSON.stringify(['Test shelf & café', 'Beta.md'])}`, destinationParentId: ['Destination'],
      expectedDestinationIdentity: `identity:${JSON.stringify(['Destination'])}` });
    expect(editor).toHaveValue('Unfinished draft');
    expect(screen.queryByText('Discard unsaved changes?')).not.toBeInTheDocument();
    expect(window.location.search).toBe(new URL(noteLocation(alphaId), window.location.origin).search);
    expect(await screen.findByRole('link', { name: 'Beta.md' })).toHaveAttribute('href', noteLocation(['Destination', 'Beta.md']));
  });

  it('holds creation that selects a new file until the dirty draft is discarded', async () => {
    const user = userEvent.setup();
    mount();
    const editor = await draft(user);
    await menu(user, 'Vault actions', /New file/);
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText('File name'), 'New.md');
    await user.click(within(dialog).getByRole('button', { name: 'Create file' }));
    expect(await screen.findByText('Discard unsaved changes?')).toBeInTheDocument();
    expect(mutations).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(editor).toHaveValue('Unfinished draft');
    expect(mutations).toHaveLength(0);
  });

  it('requires deletion confirmation and a separate dirty guard before deleting the selected file', async () => {
    respond = () => {
      tree = { entries: [{ kind: 'directory', name: 'Test shelf & café', id: ['Test shelf & café'], children: [] }] };
      return jsonResponse({ id: alphaId });
    };
    const user = userEvent.setup();
    mount();
    await draft(user);
    await menu(user, 'Actions for Alpha #1.md', /Delete file/);
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('This permanently deletes the file. There is no undo.')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus();
    await user.click(within(dialog).getByRole('button', { name: 'Delete file' }));
    expect(await screen.findByText('Discard unsaved changes?')).toBeInTheDocument();
    expect(mutations).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Discard changes' }));
    await waitFor(() => expect(window.location.search).toBe(''));
    expect(await screen.findByText('Choose a file')).toBeInTheDocument();
    expect(mutations).toHaveLength(1);
    expect(mutations[0].body).toEqual({ action: 'delete', kind: 'note', id: alphaId, expectedVersion: `version:${JSON.stringify(alphaId)}` });
  });

  it('does not treat an apparently empty folder as proof of actual emptiness', async () => {
    respond = () => jsonResponse({ error: { code: 'folder_not_empty', message: 'fixture' } }, 409);
    const user = userEvent.setup();
    mount();
    await screen.findByRole('article', { name: 'Alpha #1.md' });
    await menu(user, 'Actions for Empty test folder', /Delete empty folder/);
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Delete empty folder' }));
    expect(await screen.findByText("This folder isn't empty. Only empty folders can be deleted.")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Empty test folder' })).toBeInTheDocument();
    expect(mutations).toHaveLength(1);
    expect(mutations[0].body).toEqual({ action: 'delete', kind: 'directory', id: ['Test shelf & café', 'Empty test folder'],
      expectedVersion: `version:${JSON.stringify(['Test shelf & café', 'Empty test folder'])}` });
  });

  it('does not automatically retry an unconfirmed deletion', async () => {
    respond = () => Promise.reject(new TypeError('fixture transport'));
    const user = userEvent.setup();
    mount();
    await screen.findByRole('article', { name: 'Alpha #1.md' });
    await menu(user, 'Actions for Beta.md', /Delete file/);
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete file' }));
    expect(await screen.findByText('Deletion not confirmed. Refresh files to check what happened before trying again.')).toBeInTheDocument();
    expect(mutations).toHaveLength(1);
    window.dispatchEvent(new Event('online'));
    expect(mutations).toHaveLength(1);
  });

  it('keeps the acknowledged saved body and revision after a selected-file move is refused', async () => {
    respond = () => jsonResponse({ error: { code: 'entry_conflict', message: 'fixture' } }, 409);
    const user = userEvent.setup();
    mount();
    const editor = await draft(user);
    fireEvent.change(editor, { target: { value: '# Acknowledged body\n' } });
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('Note saved.');
    expect(screen.getByRole('article', { name: 'Alpha #1.md' })).toHaveTextContent('Acknowledged body');
    await menu(user, 'Actions for Alpha #1.md', /Move/);
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('radio', { name: 'Vault root' }));
    await user.click(within(dialog).getByRole('button', { name: 'Move file' }));
    await screen.findByText('This item has changed. Refresh files before trying again.');
    expect(mutations).toHaveLength(1);
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('article', { name: 'Alpha #1.md' })).toHaveTextContent('Acknowledged body');
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const reopened = screen.getByRole('textbox', { name: /markdown/i });
    expect(reopened).toHaveValue('# Acknowledged body\n');
    fireEvent.change(reopened, { target: { value: '# Next edit\n' } });
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(saves).toHaveLength(2));
    expect(saves[1]).toEqual({ id: alphaId, markdown: '# Next edit\n', expectedRevision: 'b'.repeat(64) });
  });

  it('does not let a late file creation supersede an already pending departure', async () => {
    const pending = deferred<Response>();
    respond = () => pending.promise;
    const navigate = vi.fn();
    let session: ReturnType<typeof useRecallSession> | undefined;
    function SessionProbe() { session = useRecallSession(); return null; }
    function Controlled({ navigating, departed }: { navigating: boolean; departed: boolean }) {
      const value: Presentation = {
        location: { key: departed ? 'departed' : 'initial', pathname: departed ? '/capture' : '/recall', search: '', hash: '' },
        navigationType: departed ? 'PUSH' : 'INITIAL', isNavigating: navigating, navigate,
        linkIntent: () => {}, rememberEntry: () => {}, registerRecallCapture: () => () => {}, registerHeading: () => () => {},
      };
      return <PresentationContext.Provider value={value}><NextShell><SessionProbe />
        {departed ? <button type="button">Capture destination</button> : <RecallView />}
      </NextShell></PresentationContext.Provider>;
    }
    window.history.replaceState(null, '', '/recall');
    const user = userEvent.setup();
    const view = render(<Controlled navigating={false} departed={false} />);
    await screen.findByRole('button', { name: 'Vault actions' });
    view.rerender(<Controlled navigating departed={false} />);
    const trigger = screen.getByRole('button', { name: 'Vault actions' });
    if (trigger.hasAttribute('disabled')) {
      expect(mutations).toHaveLength(0);
      expect(navigate).not.toHaveBeenCalled();
      return;
    }
    await menu(user, 'Vault actions', /New file/);
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText('File name'), 'New.md');
    const submit = within(dialog).getByRole('button', { name: 'Create file' });
    if (submit.hasAttribute('disabled')) {
      expect(mutations).toHaveLength(0);
      expect(navigate).not.toHaveBeenCalled();
      return;
    }
    await user.click(submit);
    await waitFor(() => expect(mutations).toHaveLength(1));
    view.rerender(<Controlled navigating={false} departed />);
    const destination = screen.getByRole('button', { name: 'Capture destination' });
    destination.focus();
    const previous = session?.editor.getSnapshot();
    await act(async () => { pending.resolve(jsonResponse({ id: ['New.md'], revision })); });
    expect(navigate).not.toHaveBeenCalled();
    expect(destination).toHaveFocus();
    expect(session?.editor.getSnapshot()).toEqual(previous);
  });
});
