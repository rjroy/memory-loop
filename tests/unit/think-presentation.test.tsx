import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ThinkView from '../../src/views/ThinkView';
import type { ThinkPresentation, ThinkPresentationActions, ThinkPresentationState } from '../../src/think/types';
import type { BodyRef } from '../../backend/think/body-store';
import { TestPresentation } from './fixtures/presentation';

const identity = { conversationId: '11111111-1111-4111-8111-111111111111', epoch: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' };
const runId = '22222222-2222-4222-8222-222222222222';
const clientCommandId = '33333333-3333-4333-8333-333333333333';
const ref: BodyRef = { epoch: identity.epoch, contentId: 'fixture-content', generation: 'fixture-generation', through: 10, kind: 'canonical', sha256: 'a'.repeat(64),
  key: { conversationId: identity.conversationId, owner: { kind: 'original', clientCommandId, messageId: 'msg_fixture' } } };

function fixture(overrides: Partial<ThinkPresentationState> = {}) {
  const state: ThinkPresentationState = { identity, revision: 1, creation: 'ready', messages: [], backgroundActivity: [],
    draft: { text: 'fixture draft', version: 7 }, composer: { kind: 'send', eligible: true }, run: { state: 'none' },
    monitoring: 'following', questions: [], history: { state: 'complete' }, newChat: 'idle', rejectedSubmissions: [], ...overrides };
  const actions = { editDraft: vi.fn(), send: vi.fn(), stop: vi.fn(), requestNewChat: vi.fn(), cancelNewChat: vi.fn(), confirmNewChat: vi.fn(),
    checkConnection: vi.fn(), retryBody: vi.fn(), editQuestion: vi.fn(), replyQuestion: vi.fn(), recoverRejected: vi.fn() } satisfies ThinkPresentationActions;
  const presentation: ThinkPresentation = { state, actions };
  return { presentation, actions };
}
function show(presentation: ThinkPresentation) { return render(<TestPresentation><ThinkView presentation={presentation} /></TestPresentation>); }
afterEach(() => { vi.unstubAllGlobals(); window.history.replaceState(null, '', '/'); });

describe('Think presentation contract', () => {
  it.each(['busy', 'unavailable', 'resynchronizing'] as const)('keeps the draft editable when Send is %s', reason => {
    const { presentation, actions } = fixture({ composer: { kind: 'send', eligible: false, reason }, monitoring: reason === 'resynchronizing' ? 'resynchronizing' : 'unavailable' });
    show(presentation);
    const editor = screen.getByRole('textbox', { name: 'Message' });
    expect(editor).toBeEnabled();
    fireEvent.change(editor, { target: { value: 'new draft' } });
    expect(actions.editDraft).toHaveBeenCalledWith('new draft');
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  });

  it('uses the captured identity and draft version for deliberate Send without erasing the draft', () => {
    const { presentation, actions } = fixture();
    show(presentation);
    const editor = screen.getByRole('textbox', { name: 'Message' });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(actions.send).toHaveBeenCalledOnce();
    expect(actions.send).toHaveBeenCalledWith(identity, 7);
    expect(actions.editDraft).not.toHaveBeenCalled();
    expect(editor).toHaveValue('fixture draft');
  });

  it('sends eligible Enter and retains Ctrl/Cmd Enter shortcuts', () => {
    const { presentation, actions } = fixture();
    show(presentation);
    const editor = screen.getByRole('textbox', { name: 'Message' });
    fireEvent.keyDown(editor, { key: 'Enter' });
    fireEvent.keyDown(editor, { key: 'Enter', ctrlKey: true });
    fireEvent.keyDown(editor, { key: 'Enter', metaKey: true });
    expect(actions.send).toHaveBeenCalledTimes(3);
    expect(actions.send).toHaveBeenCalledWith(identity, 7);
    expect(screen.getByRole('button', { name: 'Send' })).toHaveAttribute('aria-keyshortcuts', 'Enter Control+Enter Meta+Enter');
    expect(actions.stop).not.toHaveBeenCalled();
  });

  it('inserts a newline for Shift+Enter without sending', async () => {
    const { presentation, actions } = fixture();
    show(presentation);
    const editor = screen.getByRole('textbox', { name: 'Message' });
    await userEvent.click(editor);
    await userEvent.keyboard('{Shift>}{Enter}{/Shift}');
    expect(actions.editDraft).toHaveBeenCalledWith('fixture draft\n');
    expect(actions.send).not.toHaveBeenCalled();
  });

  it('does not send repeated or composing Enter', () => {
    const { presentation, actions } = fixture();
    show(presentation);
    const editor = screen.getByRole('textbox', { name: 'Message' });
    fireEvent.keyDown(editor, { key: 'Enter', repeat: true });
    fireEvent.compositionStart(editor);
    fireEvent.keyDown(editor, { key: 'Enter' });
    fireEvent.compositionEnd(editor);
    fireEvent.keyDown(editor, { key: 'Enter', isComposing: true });
    fireEvent.keyDown(editor, { key: 'Enter', keyCode: 229 });
    expect(actions.send).not.toHaveBeenCalled();
  });

  it('only an explicit Stop targets the recorded run, never an editor shortcut', () => {
    const { presentation, actions } = fixture({ composer: { kind: 'stop', runId, state: 'available' }, run: { state: 'working', runId } });
    show(presentation);
    const editor = screen.getByRole('textbox', { name: 'Message' });
    expect(editor).toBeEnabled();
    fireEvent.keyDown(editor, { key: 'Enter', ctrlKey: true });
    fireEvent.keyDown(editor, { key: 'Enter' });
    expect(actions.stop).not.toHaveBeenCalled();
    expect(actions.send).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(actions.stop).toHaveBeenCalledExactlyOnceWith(identity, runId);
  });

  it('shows attributed safe Markdown without remote image embeds or routine logging controls', () => {
    const { presentation } = fixture({ messages: [
      { role: 'user', messageId: 'msg_user', displayOrder: 1, parts: [{ messageId: 'msg_user', ordinal: 0, closure: 'closed', capture: 'complete', content: { state: 'ready', ref, text: 'My question' } }] },
      { role: 'assistant', messageId: 'msg_ai', displayOrder: 2, activity: [], parts: [{ messageId: 'msg_ai', ordinal: 0, closure: 'closed', capture: 'complete', content: { state: 'ready', ref, text: '## Answer\n\n```js\nconst x = 1\n```\n\n| A | B |\n|---|---|\n| one | two |\n\n[Reference](https://example.test) ![remote](https://example.test/image.png)' } }] },
    ] });
    const { container } = show(presentation);
    expect(screen.getByText('My question')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Answer' })).toBeInTheDocument();
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByText('const x = 1')).toBeInTheDocument();
    const reference = screen.getByRole('link', { name: /^Reference\s*\(opens in a new tab\)$/ });
    expect(reference).toHaveAttribute('href', 'https://example.test');
    expect(reference).toHaveAttribute('target', '_blank');
    expect(reference).toHaveAttribute('rel', 'noopener noreferrer');
    expect(container.querySelector('img[src^="https://example.test"]')).toBeNull();
    expect(screen.queryByRole('button', { name: /retry logging/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/connected|saving|you can draft|keyboard hint/i)).not.toBeInTheDocument();
  });

  it('keeps Latest outside composer layout and preserves draft focus until explicit keyboard activation', async () => {
    const { presentation, actions } = fixture({ messages: [
      { role: 'assistant', messageId: 'msg_ai', displayOrder: 1, activity: [], parts: [{ messageId: 'msg_ai', ordinal: 0, closure: 'closed', capture: 'complete', content: { state: 'ready', ref, text: 'Controlled response' } }] },
    ] });
    const { container } = show(presentation);
    const reader = screen.getByRole('region', { name: 'Conversation' });
    reader.style.overflowY = 'auto'; // Test-owned pane scroll model, not jsdom layout.
    Object.defineProperties(reader, { scrollHeight: { value: 1000 }, clientHeight: { value: 300 } });
    reader.scrollTop = 700;
    fireEvent.scroll(reader);
    expect(screen.queryByRole('button', { name: 'Latest response' })).not.toBeInTheDocument();
    const editor = screen.getByRole('textbox', { name: 'Message' });
    const send = screen.getByRole('button', { name: 'Send' });
    const composeRow = container.querySelector('.think-compose-row')!;
    const composeChildren = [...composeRow.children];
    editor.focus();
    reader.scrollTop = 100;
    fireEvent.wheel(reader, { deltaY: -100 });
    fireEvent.scroll(reader);
    const latest = screen.getByRole('button', { name: 'Latest response' });
    expect(latest).toHaveClass('think-latest');
    expect(latest.parentElement).toHaveClass('think-compose-measure');
    expect(composeRow).not.toContainElement(latest);
    expect([...composeRow.children]).toEqual(composeChildren);
    expect(screen.getByRole('textbox', { name: 'Message' })).toBe(editor);
    expect(screen.getByRole('button', { name: 'Send' })).toBe(send);
    expect(editor).toHaveFocus();
    expect(editor).toHaveValue('fixture draft');
    fireEvent.change(editor, { target: { value: 'still writing' } });
    expect(actions.editDraft).toHaveBeenCalledExactlyOnceWith('still writing');
    latest.focus();
    await userEvent.keyboard('{Enter}');
    expect(reader.scrollTop).toBe(1000);
    expect(reader).toHaveFocus();
    expect(screen.queryByRole('button', { name: 'Latest response' })).not.toBeInTheDocument();
    expect([...composeRow.children]).toEqual(composeChildren);
    expect(actions.send).not.toHaveBeenCalled();
    expect(actions.stop).not.toHaveBeenCalled();
  });

  it('replies to the owned question with its exact identity, without permission approval controls', () => {
    const answer = { answer: 'fixture response' };
    const { presentation, actions } = fixture({ questions: [{ decisionId: 'form_fixture_question', detail: { state: 'ready', title: 'Fixture question', fields: [{ key: 'answer', type: 'string', title: 'Answer', required: true }] }, answer, reply: 'idle' }] });
    show(presentation);
    expect(screen.getByText('Fixture question')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /reply|answer/i }));
    expect(actions.replyQuestion).toHaveBeenCalledWith(identity, 'form_fixture_question', answer);
    expect(screen.queryByRole('button', { name: /approve|deny permission/i })).not.toBeInTheDocument();
  });

  it('surfaces a server-classified persistent transcript warning without a Retry logging control', () => {
    const { presentation } = fixture({ transcriptWarning: { current: { reason: 'conflict' }, otherCount: 0 } });
    show(presentation);
    expect(screen.getByText(/logging|transcript/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /retry logging/i })).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Message' })).toBeEnabled();
  });
});

it('default Think entrypoint requests the selected conversation snapshot without sending a command', async () => {
  window.history.replaceState(null, '', `/think?conversation=${identity.conversationId}`);
  const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ conversationId: identity.conversationId, epoch: identity.epoch, revision: 1, creation: 'ready', entries: [] }), { status: 200, headers: { 'content-type': 'application/json' } }));
  vi.stubGlobal('fetch', fetcher);
  render(<TestPresentation><ThinkView /></TestPresentation>);
  await waitFor(() => expect(fetcher).toHaveBeenCalled());
  const calls = fetcher.mock.calls;
  const requestUrl = (input: RequestInfo | URL) => new URL(input instanceof Request ? input.url : String(input), window.location.origin);
  expect(calls.some(([input]) => requestUrl(input).pathname === `/api/think/conversations/${identity.conversationId}`)).toBe(true);
  expect(calls.every(([input, init]) => requestUrl(input).origin === window.location.origin && (init?.method ?? (input instanceof Request ? input.method : 'GET')) === 'GET')).toBe(true);
  expect(calls.every(([input, init]) => !new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined)).has('authorization'))).toBe(true);
});
