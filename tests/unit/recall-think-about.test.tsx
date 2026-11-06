import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useCallback, useRef, useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PresentationContext, usePresentation } from '../../src/shell/presentation';
import type { PresentationLocation } from '../../src/shell/presentation';
import NextShell from '../../src/shell/NextShell';
import { useThinkSession } from '../../src/think/presentation';
import RecallView from '../../src/views/RecallView';
import ThinkView from '../../src/views/ThinkView';
import { alphaId, installVaultApi, installViewport, jsonResponse, noteLocation } from './fixtures/recall';

const conversationId = '11111111-1111-4111-8111-111111111111';
const epoch = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const conversationPath = `/api/think/conversations/${conversationId}`;
class Watch extends EventTarget { close() {} }

function FixtureShell() {
  const [location, setLocation] = useState<PresentationLocation>(() => ({ key: 'initial', pathname: window.location.pathname, search: window.location.search, hash: '' }));
  const guard = useRef<((resume: () => void) => boolean) | null>(null);
  const navigate = useCallback((href: string, options?: { replace?: boolean }) => {
    const commit = () => {
      if (options?.replace) window.history.replaceState(null, '', href); else window.history.pushState(null, '', href);
      setLocation({ key: crypto.randomUUID(), pathname: window.location.pathname, search: window.location.search, hash: window.location.hash });
    };
    if (guard.current?.(commit) ?? true) commit();
  }, []);
  const registerNavigationGuard = useCallback((next: (resume: () => void) => boolean) => {
    guard.current = next;
    return () => { if (guard.current === next) guard.current = null; };
  }, []);
  return <PresentationContext.Provider value={{ location, navigationType: 'INITIAL', isNavigating: false, navigate, registerNavigationGuard,
    linkIntent: () => {}, rememberEntry: () => {}, registerRecallCapture: () => () => {}, registerHeading: () => () => {} }}>
    <NextShell><Routes /></NextShell>
  </PresentationContext.Provider>;
}

function Routes() {
  const { location, navigate } = usePresentation();
  const { state } = useThinkSession();
  const [showComposer, setShowComposer] = useState(false);
  return <>
    <button type="button" onClick={() => navigate(noteLocation(alphaId))}>Fixture visit Recall</button>
    <button type="button" onClick={() => navigate(`/think?conversation=${conversationId}`)}>Fixture visit Think</button>
    <button type="button" onClick={() => setShowComposer(true)}>Fixture mount Think</button>
    <output aria-label="Fixture conversation">{state.identity?.conversationId ?? 'none'}</output>
    <output aria-label="Fixture draft">{state.draft.text}</output>
    {location.pathname === '/recall' && <RecallView />}
    {(location.pathname === '/think' || showComposer) && <ThinkView />}
  </>;
}

let requests: Array<{ path: string; method: string }>;
beforeEach(() => {
  window.sessionStorage.clear();
  installViewport(1440);
  vi.stubGlobal('EventSource', Watch);
  requests = [];
  const api = installVaultApi();
  const reads = api.getMockImplementation();
  if (!reads) throw new Error('Missing fixture fetch');
  api.mockImplementation(async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), window.location.origin);
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    requests.push({ path: url.pathname, method });
    if (method === 'GET' && url.pathname === conversationPath) return jsonResponse({ conversationId, epoch, revision: 1, creation: 'ready', sendEligibility: 'available', entries: [] });
    if (method === 'GET' && url.pathname === `${conversationPath}/decisions`) return jsonResponse({ decisions: [] });
    return reads(input, init);
  });
});

function expectNoConversationCommands() {
  expect(requests.filter(({ path, method }) => path.startsWith('/api/think/conversations') && method !== 'GET')).toEqual([]);
}

describe('Recall Think About', () => {
  it.each([
    { target: 'Actions for Beta.md', path: 'Test shelf & café/Beta.md' },
    { target: 'Actions for Empty test folder', path: 'Test shelf & café/Empty test folder' },
  ])('adds the selected path for $target to the existing Think draft without changing conversation or sending', async ({ target, path }) => {
    window.history.replaceState(null, '', `/think?conversation=${conversationId}`);
    const user = userEvent.setup();
    render(<FixtureShell />);
    const textbox = await screen.findByRole('textbox', { name: 'Message' });
    fireEvent.change(textbox, { target: { value: 'Existing unsent draft  ' } });
    await user.click(screen.getByRole('button', { name: 'Fixture visit Recall' }));
    await screen.findByRole('article', { name: 'Alpha #1.md' });
    expect(screen.queryByRole('textbox', { name: 'Message' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: target }));
    expect(within(screen.getByRole('menu')).getAllByRole('menuitem')[0]).toHaveTextContent('Think About');
    const action = within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Think About' });
    if (target.includes('folder')) { action.focus(); await user.keyboard('{Enter}'); }
    else await user.click(action);
    expect(screen.getByLabelText('Fixture conversation')).toHaveTextContent(conversationId);
    expectNoConversationCommands();
    expect(window.location.pathname).toBe('/think');
    expect(window.location.search).toBe(`?conversation=${conversationId}`);
    const result = await screen.findByRole('textbox', { name: 'Message' });
    await waitFor(() => expect(result).toHaveValue(`Existing unsent draft  \n${path}`));
    expect(result).toHaveFocus();
    expect((result as HTMLTextAreaElement).selectionStart).toBe((result as HTMLTextAreaElement).value.length);
    expect((result as HTMLTextAreaElement).selectionEnd).toBe((result as HTMLTextAreaElement).value.length);
    expectNoConversationCommands();
  });

  it('can prepare a path before Think has ever mounted without creating a conversation or sending', async () => {
    window.history.replaceState(null, '', noteLocation(alphaId));
    const user = userEvent.setup();
    render(<FixtureShell />);
    await screen.findByRole('article', { name: 'Alpha #1.md' });
    expect(screen.queryByRole('textbox', { name: 'Message' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Actions for Beta.md' }));
    await user.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Think About' }));
    expect(screen.getByLabelText('Fixture conversation')).toHaveTextContent('none');
    expectNoConversationCommands();
    if (!screen.queryByRole('textbox', { name: 'Message' })) await user.click(screen.getByRole('button', { name: 'Fixture mount Think' }));
    expect(await screen.findByRole('textbox', { name: 'Message' })).toHaveValue('Test shelf & café/Beta.md');
    expectNoConversationCommands();
  });

  it('does not offer Think About for the vault background', async () => {
    window.history.replaceState(null, '', noteLocation(alphaId));
    const user = userEvent.setup();
    render(<FixtureShell />);
    await user.click(await screen.findByRole('button', { name: 'Vault actions' }));
    expect(within(screen.getByRole('menu')).queryByRole('menuitem', { name: 'Think About' })).not.toBeInTheDocument();
  });

  it('keeps the Think draft unchanged when a dirty Recall departure is cancelled', async () => {
    window.history.replaceState(null, '', `/think?conversation=${conversationId}`);
    const user = userEvent.setup();
    render(<FixtureShell />);
    fireEvent.change(await screen.findByRole('textbox', { name: 'Message' }), { target: { value: 'Unsent Think draft' } });
    await user.click(screen.getByRole('button', { name: 'Fixture visit Recall' }));
    await screen.findByRole('article', { name: 'Alpha #1.md' });
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByRole('textbox', { name: /markdown/i }), { target: { value: 'Unsaved Recall draft' } });
    await user.click(screen.getByRole('button', { name: 'Actions for Beta.md' }));
    await user.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Think About' }));
    await user.click(await screen.findByRole('button', { name: 'Keep editing' }));
    expect(window.location.pathname).toBe('/recall');
    expect(screen.getByLabelText('Fixture draft')).toHaveTextContent('Unsent Think draft');
    expect(screen.getByRole('textbox', { name: /markdown/i })).toHaveValue('Unsaved Recall draft');
    expectNoConversationCommands();
  });
});
