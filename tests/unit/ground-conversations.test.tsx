import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useCallback, useRef, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import GroundView from '../../src/views/GroundView';
import ThinkView from '../../src/views/ThinkView';
import CaptureView from '../../src/views/CaptureView';
import NextShell from '../../src/shell/NextShell';
import { PresentationContext, usePresentation, type PresentationLocation } from '../../src/shell/presentation';
import { useThinkPresentation } from '../../src/think/presentation';

const oldId = '11111111-1111-4111-8111-111111111111';
const targetId = '22222222-2222-4222-8222-222222222222';
const epoch = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const nextEpoch = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const viewToken = 'fixture_view_token_012345678901234567890123456789';
const base = '/api/think/conversations';
const expiry = new Date(Date.now() + 120_000).toISOString();
const json = (value: unknown, status = 200) => Response.json(value, { status });
const note = (name: string) => ['03_Resources', 'Memory-Loop', `${name}.md`];
const digest = 'a'.repeat(64);
class Watch extends EventTarget { close() {} }
function deferred<T>() {
  let resolve: (value: T) => void = () => { throw new Error('Uninitialized fixture'); };
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

function Router() {
  const [location, setLocation] = useState<PresentationLocation>(() => ({ key: 'initial', pathname: window.location.pathname, search: window.location.search, hash: '' }));
  const generation = useRef(0);
  const navigate = useCallback((href: string, options?: { replace?: boolean }) => {
    generation.current++;
    if (options?.replace) window.history.replaceState(null, '', href); else window.history.pushState(null, '', href);
    setLocation({ key: crypto.randomUUID(), pathname: window.location.pathname, search: window.location.search, hash: window.location.hash });
  }, []);
  return <PresentationContext.Provider value={{ location, navigationType: 'INITIAL', isNavigating: false, navigate,
    navigationGeneration: () => generation.current, linkIntent: () => { generation.current++; }, rememberEntry: () => {}, registerRecallCapture: () => () => {}, registerHeading: () => () => {} }}>
    <NextShell><FixtureViews /></NextShell>
  </PresentationContext.Provider>;
}
function FixtureViews() {
  const { location, navigate, linkIntent } = usePresentation();
  const { state, actions } = useThinkPresentation();
  return <>
    <button onClick={() => navigate('/ground')}>Fixture Ground</button>
    <button onClick={() => navigate(`/think?conversation=${oldId}`)}>Fixture old Think</button>
    <button onClick={() => navigate(`/think?conversation=${targetId}`)}>Fixture target Think</button>
    <button onClick={() => navigate('/capture')}>Fixture Capture</button>
    <button onClick={() => navigate('/recall')}>Fixture Recall</button>
    <button onClick={() => linkIntent('/recall')}>Fixture navigation intent</button>
    <textarea aria-label="Fixture current draft" value={state.draft.text} onChange={event => actions.editDraft(event.target.value)} />
    <output aria-label="Fixture identity epoch">{state.identity?.epoch ?? ''}</output>
    {location.pathname === '/ground' ? <GroundView /> : location.pathname === '/think' ? <ThinkView /> : location.pathname === '/capture' ? <CaptureView /> : <p>Fixture other route</p>}
  </>;
}

const row = (conversationId: string, title: string | null, current = false, available = true) => ({ conversationId, title,
  lastActivityAt: '2026-11-01T12:00:00.000Z', state: available ? 'ready' : 'unavailable',
  resume: available ? { available: true } : { available: false, reason: 'unavailable' },
  delete: { available: false, ...(current ? { reason: 'current' } : {}) } });
type Options = { list?: object; listStatus?: number; failResume?: boolean; uncertainSelection?: boolean; holdSelection?: boolean; restarted?: boolean; failRenewal?: boolean };
function setup(options: Options = {}) {
  window.history.replaceState(null, '', `/think?conversation=${oldId}`);
  window.sessionStorage.clear(); window.localStorage.clear();
  vi.stubGlobal('EventSource', Watch);
  const pendingSelection = deferred<Response>();
  let selected: string | null = null;
  let selectionRevision = 0;
  let resumeId = '';
  let resumePosts = 0;
  let selectionPosts = 0;
  let readbacks = 0;
  let restart = false;
  const rows = [row(targetId, 'Second thread 🧭'), row(oldId, 'Current fixture', true), row('33333333-3333-4333-8333-333333333333', null, false, false)];
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input), window.location.origin);
    const method = init?.method ?? 'GET';
    const path = url.pathname;
    if (path === '/api/think/views' && method === 'POST') return json({ viewToken, selectionRevision: 0, conversationId: null, expiresAt: expiry }, 201);
    if (path === '/api/think/selection' && method === 'GET') { readbacks++; return json({ selectionRevision, conversationId: selected, expiresAt: expiry }); }
    if (path === '/api/think/selection' && method === 'POST') {
      selectionPosts++;
      const command: { viewToken: string; expectedRevision: number; conversationId: string | null } = JSON.parse(String(init?.body));
      if (command.viewToken !== viewToken || command.expectedRevision !== selectionRevision) return json({ error: { code: 'selection_conflict', message: 'Think selection has changed' } }, 409);
      if (command.conversationId !== selected) { selected = command.conversationId; selectionRevision++; }
      if (options.failRenewal && selectionPosts > 1 && command.conversationId === oldId) return json({ error: { code: 'lease_unavailable', message: 'Think view is unavailable' } }, 403);
      if (options.holdSelection && command.conversationId === targetId) return pendingSelection.promise;
      if (options.uncertainSelection && command.conversationId === targetId) throw new TypeError('fixture lost acknowledgement');
      return json({ selectionRevision, conversationId: selected, expiresAt: expiry });
    }
    if (path === '/api/ground/recent-conversations') return json(options.list ?? { state: 'ready', items: rows }, options.listStatus ?? 200);
    if (path === '/api/ground/quick-actions') return json({ state: 'ready', noteId: note('quick-actions'), revision: digest, data: { actions: [{ id: '@fixture', skill: '@fixture', description: 'Fixture action' }] } });
    if (path === '/api/ground/inspiration') return json({ state: 'ready', noteId: note('inspiration'), revision: digest, data: { quote: { id: digest, text: 'Fictional fixture quote', attribution: 'Fixture author', source: { title: 'Fixture source' } } } });
    if (path === '/api/ground/prompts') return json({ state: 'ready', noteId: note('prompts'), revision: digest, data: { question: { id: digest, text: 'Fixture question' } } });
    if (path === '/api/ground/goals') return json({ state: 'ready', noteId: note('goals'), revision: digest, data: { markdown: '# Fixture goal' } });
    if (path === '/api/ground/recent-captures') return json({ state: 'empty' });
    if (path.endsWith('/resume') && method === 'POST') {
      resumePosts++;
      const command: { clientCommandId: string } = JSON.parse(String(init?.body));
      resumeId = command.clientCommandId;
      if (options.restarted) restart = true;
      if (options.failResume) throw new TypeError('fixture lost resume acknowledgement');
      return json({ kind: 'resume', conversationId: path.split('/')[4], clientCommandId: resumeId, epoch: restart ? nextEpoch : epoch, state: 'ready' }, 202);
    }
    const receipt = new RegExp(`^${base}/([^/]+)/commands/([^/]+)$`).exec(path);
    if (receipt && method === 'GET') return json({ kind: 'resume', conversationId: receipt[1], clientCommandId: receipt[2], epoch: restart ? nextEpoch : epoch, state: 'ready' });
    if (path.endsWith('/decisions') && method === 'GET') return json({ decisions: [] });
    if (path.startsWith(`${base}/`) && method === 'GET') return json({ conversationId: path.slice(base.length + 1), epoch: restart ? nextEpoch : epoch, revision: 1, creation: 'ready', sendEligibility: 'available', entries: [] });
    throw new Error(`Unexpected fixture request: ${method} ${path}`);
  });
  vi.stubGlobal('fetch', fetcher);
  return { fetcher, pendingSelection, restartDaemon() { restart = true; }, changeLease(conversationId: string) { selected = conversationId; selectionRevision++; }, get selected() { return selected; }, get selectionRevision() { return selectionRevision; }, get resumePosts() { return resumePosts; }, get resumeId() { return resumeId; }, get selectionPosts() { return selectionPosts; }, get readbacks() { return readbacks; } };
}
const requests = (fetcher: ReturnType<typeof setup>['fetcher'], path: string, method: string) => fetcher.mock.calls.filter(([input, init]) => String(input) === path && (init?.method ?? 'GET') === method);
const noSendOrCreate = (fetcher: ReturnType<typeof setup>['fetcher']) => {
  expect(requests(fetcher, base, 'POST')).toHaveLength(0);
  expect(fetcher.mock.calls.filter(([input, init]) => init?.method === 'POST' && /\/(messages|stop)$/.test(String(input)))).toHaveLength(0);
};
async function toGround(draft = '') {
  const editor = await screen.findByRole('textbox', { name: 'Message' });
  if (draft) fireEvent.change(editor, { target: { value: draft } });
  fireEvent.click(screen.getByRole('button', { name: 'Fixture Ground' }));
  return await screen.findByRole('region', { name: 'Recent conversations' });
}
function resume(region: HTMLElement, title: string) {
  const item = within(region).getByText(title).closest('li');
  if (!item) throw new Error('Fixture conversation row missing');
  fireEvent.click(within(item).getByRole('link', { name: /resume/i }));
}
beforeEach(() => { window.sessionStorage.clear(); window.localStorage.clear(); });
afterEach(() => { vi.useRealTimers(); window.sessionStorage.clear(); window.localStorage.clear(); });

describe('Ground recent conversations and view ownership', () => {
  it('renders six independent cards and up to ten ordered conversations without Delete', async () => {
    const rows = Array.from({ length: 10 }, (_, i) => row(`11111111-1111-4111-8111-${String(i + 1).padStart(12, '0')}`, i === 0 ? 'Fixture 🧭 first' : i === 9 ? null : `Fixture ${i}`, i === 0, i !== 8));
    const fixture = setup({ list: { state: 'ready', items: rows } }); render(<Router />);
    const region = await toGround();
    for (const name of ['Quick Actions', 'Inspiration', 'Prompts', 'Current Goals', 'Recent captures', 'Recent conversations']) expect(screen.getByRole('heading', { level: 2, name })).toBeInTheDocument();
    const items = within(region).getAllByRole('listitem');
    expect(items).toHaveLength(10);
    expect(items[0]).toHaveTextContent('Fixture 🧭 first');
    expect(items[0]).toHaveTextContent('Current in Think');
    expect(items[9]).toHaveTextContent('Untitled conversation');
    for (let index = 1; index < 9; index++) expect(items[index]).toHaveTextContent(`Fixture ${index}`);
    expect(within(items[8]).queryByRole('link', { name: /resume/i })).not.toBeInTheDocument();
    expect(within(region).queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
    const listRequest = requests(fixture.fetcher, '/api/ground/recent-conversations', 'GET').at(-1);
    expect(new Headers(listRequest?.[1]?.headers).get('X-Memory-Loop-View')).toBe(viewToken);
  });

  it.each([
    [{ state: 'ready', items: [] }, 200, 'No recent conversations yet.'],
    [{ state: 'unavailable' }, 503, 'Recent conversations couldn’t be loaded.'],
  ])('keeps empty or unavailable list local to its card', async (list, listStatus, message) => {
    setup({ list, listStatus }); render(<Router />); const region = await toGround();
    expect(await within(region).findByText(message)).toBeInTheDocument();
    expect(screen.getByText('Fictional fixture quote')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Fixture Capture' })).toBeEnabled();
  });

  it.each(['unsent origin draft', ' \n '])('Cancel preserves a nonempty origin draft without Resume', async draft => {
    const fixture = setup(); render(<Router />); const region = await toGround(draft);
    resume(region, 'Second thread 🧭');
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(fixture.resumePosts).toBe(0); noSendOrCreate(fixture.fetcher);
    fireEvent.click(screen.getByRole('button', { name: 'Fixture old Think' }));
    expect(await screen.findByRole('textbox', { name: 'Message' })).toHaveValue(draft);
    expect(window.location.search).toContain(oldId);
  });

  it('resumes, verifies then CAS-selects the target while retaining both keyed drafts', async () => {
    const fixture = setup(); render(<Router />);
    fireEvent.click(screen.getByRole('button', { name: 'Fixture target Think' }));
    fireEvent.change(await screen.findByRole('textbox', { name: 'Message' }), { target: { value: 'target draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'Fixture old Think' }));
    const region = await toGround('old draft'); resume(region, 'Second thread 🧭');
    fireEvent.click(await screen.findByRole('button', { name: 'Open conversation' }));
    await waitFor(() => expect(window.location.search).toBe(`?conversation=${targetId}`));
    expect(await screen.findByRole('textbox', { name: 'Message' })).toHaveValue('target draft');
    expect(fixture.resumePosts).toBe(1);
    const resumeCall = requests(fixture.fetcher, `${base}/${targetId}/resume`, 'POST')[0];
    const resumeIndex = fixture.fetcher.mock.calls.indexOf(resumeCall);
    const selectCall = fixture.fetcher.mock.calls.find(([input, init], index) => index > resumeIndex && String(input) === '/api/think/selection' && init?.method === 'POST' && JSON.parse(String(init.body)).conversationId === targetId);
    expect(resumeCall).toBeDefined(); expect(selectCall).toBeDefined();
    if (!resumeCall || !selectCall) throw new Error('Fixture expected Resume and selection calls');
    expect(resumeIndex).toBeLessThan(fixture.fetcher.mock.calls.indexOf(selectCall));
    expect(fixture.selected).toBe(targetId); noSendOrCreate(fixture.fetcher);
    fireEvent.click(screen.getByRole('button', { name: 'Fixture old Think' }));
    expect(await screen.findByRole('textbox', { name: 'Message' })).toHaveValue('old draft');
  });

  it('reconciles an uncertain Resume with the same receipt, never another Resume POST', async () => {
    const fixture = setup({ failResume: true }); render(<Router />); const region = await toGround();
    resume(region, 'Second thread 🧭');
    fireEvent.click(await screen.findByRole('button', { name: 'Check chat' }));
    await waitFor(() => expect(requests(fixture.fetcher, `${base}/${targetId}/commands/${fixture.resumeId}`, 'GET')).toHaveLength(1));
    await waitFor(() => expect(window.location.search).toBe(`?conversation=${targetId}`));
    expect(fixture.resumePosts).toBe(1); noSendOrCreate(fixture.fetcher);
  });

  it('reads the same view after lost CAS response without repeating the selection POST', async () => {
    const fixture = setup({ uncertainSelection: true }); render(<Router />); const region = await toGround();
    resume(region, 'Second thread 🧭');
    await waitFor(() => expect(fixture.readbacks).toBeGreaterThan(0));
    const read = requests(fixture.fetcher, '/api/think/selection', 'GET').at(-1);
    expect(new Headers(read?.[1]?.headers).get('X-Memory-Loop-View')).toBe(viewToken);
    await waitFor(() => expect(window.location.search).toBe(`?conversation=${targetId}`));
    const targetSelections = requests(fixture.fetcher, '/api/think/selection', 'POST').filter(([, init]) => JSON.parse(String(init?.body)).conversationId === targetId);
    expect(targetSelections).toHaveLength(1); noSendOrCreate(fixture.fetcher);
  });

  it('explicitly reauthorizes the same conversation after a daemon epoch change without losing its draft', async () => {
    const fixture = setup({ restarted: true }); render(<Router />);
    const region = await toGround('draft across restart');
    await waitFor(() => expect(screen.getByLabelText('Fixture identity epoch')).toHaveTextContent(epoch));
    fixture.restartDaemon();
    resume(region, 'Current fixture');
    await waitFor(() => expect(requests(fixture.fetcher, `${base}/${oldId}/resume`, 'POST')).toHaveLength(1));
    await waitFor(() => expect(window.location.search).toBe(`?conversation=${oldId}`));
    expect(await screen.findByRole('textbox', { name: 'Message' })).toHaveValue('draft across restart');
    await waitFor(() => expect(screen.getByLabelText('Fixture identity epoch')).toHaveTextContent(nextEpoch));
    noSendOrCreate(fixture.fetcher);
  });

  it.each(['new typing', 'navigation intent'])('fences %s during delayed selection and preserves the newer origin', async change => {
    const fixture = setup({ holdSelection: true }); render(<Router />); const region = await toGround('original draft');
    resume(region, 'Second thread 🧭'); fireEvent.click(await screen.findByRole('button', { name: 'Open conversation' }));
    await waitFor(() => expect(fixture.selected).toBe(targetId));
    if (change === 'new typing') fireEvent.change(screen.getByRole('textbox', { name: 'Fixture current draft' }), { target: { value: 'newer origin draft' } });
    else fireEvent.click(screen.getByRole('button', { name: 'Fixture navigation intent' }));
    await act(async () => { fixture.pendingSelection.resolve(json({ selectionRevision: fixture.selectionRevision, conversationId: targetId, expiresAt: expiry })); await Promise.resolve(); });
    expect(window.location.pathname).toBe('/ground');
    expect(window.sessionStorage.getItem('memory-loop.think.current')).toBe(oldId);
    expect(screen.getByRole('textbox', { name: 'Fixture current draft' })).toHaveValue(change === 'new typing' ? 'newer origin draft' : 'original draft');
    noSendOrCreate(fixture.fetcher);
  });

  it('does not roll back a newer view revision after an obsolete CAS acknowledgement', async () => {
    const fixture = setup({ holdSelection: true }); render(<Router />); const region = await toGround('original draft');
    resume(region, 'Second thread 🧭'); fireEvent.click(await screen.findByRole('button', { name: 'Open conversation' }));
    await waitFor(() => expect(fixture.selected).toBe(targetId));
    const earlierRevision = fixture.selectionRevision;
    const beforeReadbacks = fixture.readbacks;
    const beforeCompletion = fixture.fetcher.mock.calls.length;
    const newer = '33333333-3333-4333-8333-333333333333';
    fixture.changeLease(newer);
    fireEvent.click(screen.getByRole('button', { name: 'Fixture navigation intent' }));
    await act(async () => { fixture.pendingSelection.resolve(json({ selectionRevision: earlierRevision, conversationId: targetId, expiresAt: expiry })); await Promise.resolve(); });
    await waitFor(() => expect(fixture.readbacks).toBeGreaterThan(beforeReadbacks));
    await waitFor(() => expect(screen.getByText('Chat prepared. Open it without changing your other draft?')).toBeInTheDocument());
    expect(window.location.pathname).toBe('/ground');
    expect(fixture.selected).toBe(newer);
    expect(fixture.selectionRevision).toBe(earlierRevision + 1);
    expect(fixture.fetcher.mock.calls.slice(beforeCompletion).filter(([input, init]) => String(input) === '/api/think/selection' && init?.method === 'POST')).toHaveLength(0);
    noSendOrCreate(fixture.fetcher);
  });

  it('restores the prior binding only when an obsolete CAS still owns its exact revision', async () => {
    const fixture = setup({ holdSelection: true }); render(<Router />); const region = await toGround('original draft');
    resume(region, 'Second thread 🧭'); fireEvent.click(await screen.findByRole('button', { name: 'Open conversation' }));
    await waitFor(() => expect(fixture.selected).toBe(targetId));
    const ownedRevision = fixture.selectionRevision;
    const beforeReadbacks = fixture.readbacks;
    fireEvent.change(screen.getByRole('textbox', { name: 'Fixture current draft' }), { target: { value: 'newer draft' } });
    await act(async () => { fixture.pendingSelection.resolve(json({ selectionRevision: ownedRevision, conversationId: targetId, expiresAt: expiry })); await Promise.resolve(); });
    await waitFor(() => expect(fixture.selected).toBe(oldId));
    expect(fixture.readbacks).toBeGreaterThan(beforeReadbacks);
    expect(fixture.selectionRevision).toBe(ownedRevision + 1);
    const restore = requests(fixture.fetcher, '/api/think/selection', 'POST').at(-1);
    expect(JSON.parse(String(restore?.[1]?.body))).toEqual({ viewToken, expectedRevision: ownedRevision, conversationId: oldId });
    expect(window.location.pathname).toBe('/ground');
    expect(window.sessionStorage.getItem('memory-loop.think.current')).toBe(oldId);
    expect(screen.getByRole('textbox', { name: 'Fixture current draft' })).toHaveValue('newer draft');
    noSendOrCreate(fixture.fetcher);
  });

  it('renews the same selected view while away from Think without storing its token', async () => {
    const fixture = setup(); render(<Router />); await screen.findByRole('textbox', { name: 'Message' });
    fireEvent.click(screen.getByRole('button', { name: 'Fixture Ground' }));
    await waitFor(() => expect(fixture.selected).toBe(oldId));
    const revisionBefore = fixture.selectionRevision;
    fireEvent.click(screen.getByRole('button', { name: 'Fixture Capture' }));
    vi.useFakeTimers();
    await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
    expect(fixture.selectionPosts).toBeGreaterThanOrEqual(2);
    expect(fixture.selected).toBe(oldId); expect(fixture.selectionRevision).toBe(revisionBefore);
    expect(JSON.stringify({ url: window.location.href, local: { ...localStorage }, session: { ...sessionStorage } })).not.toContain(viewToken);
  });

  it('blocks Think mutation after failed renewal while Capture stays editable', async () => {
    const fixture = setup({ failRenewal: true }); render(<Router />); await screen.findByRole('textbox', { name: 'Message' });
    fireEvent.click(screen.getByRole('button', { name: 'Fixture Ground' }));
    await waitFor(() => expect(fixture.selected).toBe(oldId));
    fireEvent.click(screen.getByRole('button', { name: 'Fixture Capture' }));
    fireEvent.change(await screen.findByRole('textbox', { name: 'Thought' }), { target: { value: 'capture still editable' } });
    vi.useFakeTimers();
    await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
    expect(fixture.selectionPosts).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole('textbox', { name: 'Thought' })).toHaveValue('capture still editable');
    fireEvent.click(screen.getByRole('button', { name: 'Fixture old Think' }));
    const editor = screen.getByRole('textbox', { name: 'Message' });
    fireEvent.change(editor, { target: { value: 'do not send without lease' } });
    fireEvent.click(screen.getByRole('button', { name: /^Send$/ }));
    noSendOrCreate(fixture.fetcher);
  });
});
