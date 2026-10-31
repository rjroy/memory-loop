import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useCallback, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import GroundView from '../../src/views/GroundView';
import ThinkView from '../../src/views/ThinkView';
import NextShell from '../../src/shell/NextShell';
import { PresentationContext, usePresentation, type NavigationType, type PresentationLocation } from '../../src/shell/presentation';

const oldId = '11111111-1111-4111-8111-111111111111';
const epoch = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const note = (name: string) => ['03_Resources', 'Memory-Loop', `${name}.md`];
const revision = 'b'.repeat(64);
const hash = 'c'.repeat(64);
const quote = 'Fictional fixture quotation';
const prompt = 'Fixture question for a new chat';
const original = '@fixture-skill';
const goals = '# Fixture goal\n\n- [ ] Fixture task\n\n<script>fixture unsafe html</script>\n\n![fixture remote image](https://example.test/fixture.png)';
const base = '/api/think/conversations';
const json = (value: unknown, status = 200) => Response.json(value, { status });
function deferred<T>() {
  let resolve: (value: T) => void = () => { throw new Error('uninitialized fixture'); };
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
class Watch extends EventTarget { close() {} }

/** Route only the fixture views while retaining the actual persistent NextShell. */
function TestRouter({ marker = 0, target }: { marker?: number; target?: string }) {
  const [location, setLocation] = useState<PresentationLocation>(() => ({ key: 'initial', pathname: window.location.pathname, search: window.location.search, hash: '' }));
  const navigate = useCallback((href: string, options?: { replace?: boolean }) => {
    if (options?.replace) window.history.replaceState(null, '', href); else window.history.pushState(null, '', href);
    setLocation({ key: crypto.randomUUID(), pathname: window.location.pathname, search: window.location.search, hash: window.location.hash });
  }, []);
  return <PresentationContext.Provider value={{ location, navigationType: 'INITIAL' as NavigationType, isNavigating: false, navigate,
    linkIntent: () => {}, rememberEntry: () => {}, registerRecallCapture: () => () => {}, registerHeading: () => () => {} }}>
    <NextShell><FixtureRoutes marker={marker} target={target} /></NextShell>
  </PresentationContext.Provider>;
}
function FixtureRoutes({ marker, target }: { marker: number; target?: string }) {
  const { location, navigate } = usePresentation();
  return <><span data-testid="fixture-rerender">{marker}</span>
    <button type="button" onClick={() => navigate('/ground')}>Fixture visit Ground</button>
    <button type="button" onClick={() => navigate(`/think?conversation=${oldId}`)}>Fixture visit old Think</button>
    {target && <button type="button" onClick={() => navigate(`/think?conversation=${target}`)}>Fixture visit prepared Think</button>}
    {location.pathname === '/ground' ? <GroundView /> : location.pathname === '/think' ? <ThinkView /> : null}
  </>;
}

function setup(options: { origin?: 'ground' | 'think'; delayedCreate?: boolean; failCreate?: boolean; overrides?: Record<string, () => Response> } = {}) {
  window.sessionStorage.clear();
  window.history.replaceState(null, '', options.origin === 'think' ? `/think?conversation=${oldId}` : '/ground');
  vi.stubGlobal('EventSource', Watch);
  const pending = deferred<Response>();
  const readCounts = new Map<string, number>();
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input), window.location.origin);
    const method = init?.method ?? 'GET';
    const path = url.pathname;
    if (path.startsWith('/api/ground/')) {
      const count = (readCounts.get(path) ?? 0) + 1;
      readCounts.set(path, count);
      const override = options.overrides?.[path];
      if (override) return override();
      if (path === '/api/ground/quick-actions') return json({ state: 'ready', noteId: note('quick-actions'), revision, data: { actions: [{ id: original, skill: original, description: 'Fixture skill description' }] } });
      if (path === '/api/ground/inspiration') return json({ state: 'ready', noteId: note('inspiration'), revision, data: { quote: { id: hash, text: count === 1 ? quote : 'Second fictional fixture quotation', attribution: 'Fixture author', source: { title: 'Fixture source' } } } });
      if (path === '/api/ground/prompts') return json({ state: 'ready', noteId: note('prompts'), revision, data: { question: { id: hash, text: count === 1 ? prompt : 'Second fixture question' } } });
      if (path === '/api/ground/goals') return json({ state: 'ready', noteId: note('goals'), revision, data: { markdown: goals } });
      if (path === '/api/ground/recent-captures') return json({ state: 'ready', coverage: 'complete', items: [{ id: hash, localDateTime: '2026-01-01T12:34', timeBasis: 'recorded-local', excerpt: 'Fixture capture excerpt', noteId: ['00_Inbox', '2026-01-01.md'] }] });
    }
    if (path === base && method === 'POST') {
      if (options.delayedCreate) return pending.promise;
      if (options.failCreate) throw new TypeError('fixture uncertain transport');
      const command: { conversationId: string; clientCommandId: string } = JSON.parse(String(init?.body));
      return json({ ...command, epoch, kind: 'create', state: 'ready' }, 202);
    }
    if (path.startsWith(`${base}/`) && path.endsWith('/decisions')) return json({ decisions: [] });
    const receipt = new RegExp(`^${base}/([^/]+)/commands/([^/]+)$`).exec(path);
    if (receipt && method === 'GET') return json({ conversationId: receipt[1], clientCommandId: receipt[2], epoch, kind: 'create', state: 'ready' });
    if (path.startsWith(`${base}/`) && method === 'GET') {
      const conversationId = path.slice(base.length + 1).split('/')[0];
      return json({ conversationId, epoch, revision: 1, creation: 'ready', sendEligibility: 'available', entries: [] });
    }
    throw new Error(`Unexpected fixture request: ${method} ${path}`);
  });
  vi.stubGlobal('fetch', fetcher);
  return { fetcher, readCounts, pending };
}
beforeEach(() => window.sessionStorage.clear());
afterEach(() => window.sessionStorage.clear());

describe('Ground cards and shell-owned prefill', () => {
  it('renders five real independent cards, safe Goals and Recall source links without conversation placeholders', async () => {
    const { fetcher } = setup();
    render(<TestRouter />);
    for (const name of ['Quick Actions', 'Inspiration', 'Prompts', 'Current Goals', 'Recent captures']) expect(await screen.findByRole('heading', { level: 2, name })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Recent conversations' })).not.toBeInTheDocument();
    expect(screen.getByText(quote)).toBeInTheDocument();
    expect(screen.getByText('Fixture author')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Fixture goal' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Fixture task' })).toBeDisabled();
    expect(document.querySelector('script')).toBeNull();
    expect(document.querySelector('img[src="https://example.test/fixture.png"]')).toBeNull();
    expect(screen.getByRole('link', { name: /Fixture capture excerpt/ })).toHaveAttribute('href', `/recall?${new URLSearchParams({ file: JSON.stringify(['00_Inbox', '2026-01-01.md']) })}`);
    expect(fetcher.mock.calls.filter(([input]) => String(input).startsWith('/api/ground/'))).toHaveLength(5);
  });

  it('keeps sibling empty, missing, malformed and failed reads local to their cards', async () => {
    setup({ overrides: {
      '/api/ground/quick-actions': () => json({ state: 'missing', noteId: note('quick-actions') }),
      '/api/ground/inspiration': () => json({ state: 'empty', noteId: note('inspiration') }),
      '/api/ground/prompts': () => json({ state: 'malformed', noteId: note('prompts'), issue: { code: 'invalid_format' } }),
      '/api/ground/goals': () => json({ state: 'unavailable', reason: 'io' }, 503),
    } });
    render(<TestRouter />);
    expect(await screen.findByText('Quick Actions file not found.')).toBeInTheDocument();
    expect(screen.getByText('No inspiration yet.')).toBeInTheDocument();
    expect(screen.getByText('Prompts couldn’t be read.')).toBeInTheDocument();
    expect(screen.getByText('Current Goals couldn’t be loaded.')).toBeInTheDocument();
    expect(screen.getByText('Fixture capture excerpt')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Capture' })).toBeInTheDocument();
  });

  it('keeps the selected quote and prompt through rerender and selects again on a new Ground visit', async () => {
    const { readCounts } = setup();
    const view = render(<TestRouter marker={0} />);
    expect(await screen.findByText(quote)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: new RegExp(prompt) })).toBeInTheDocument();
    view.rerender(<TestRouter marker={1} />);
    expect(screen.getByText(quote)).toBeInTheDocument();
    expect(readCounts.get('/api/ground/inspiration')).toBe(1);
    expect(readCounts.get('/api/ground/prompts')).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: 'Fixture visit old Think' }));
    fireEvent.click(screen.getByRole('button', { name: 'Fixture visit Ground' }));
    expect(await screen.findByText('Second fictional fixture quotation')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Second fixture question/ })).toBeInTheDocument();
    expect(readCounts.get('/api/ground/inspiration')).toBe(2);
    expect(readCounts.get('/api/ground/prompts')).toBe(2);
  });

  it.each([['Fixture skill description', original], [prompt, prompt]])('opens a fresh unsent Think draft from %s', async (label, prefill) => {
    const { fetcher } = setup();
    render(<TestRouter />);
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(label) }));
    const editor = await screen.findByRole('textbox', { name: 'Message' });
    await waitFor(() => expect(editor).toHaveValue(prefill));
    expect(window.location.pathname).toBe('/think');
    expect(window.location.search).toMatch(/^\?conversation=[0-9a-f-]+$/);
    expect(window.location.href).not.toContain(encodeURIComponent(prefill));
    expect(fetcher.mock.calls.filter(([input, init]) => String(input) === base && init?.method === 'POST')).toHaveLength(1);
    expect(fetcher.mock.calls.some(([input, init]) => init?.method === 'POST' && /\/(?:messages|stop)$/.test(String(input)))).toBe(false);
  });

  it.each(['existing fixture draft', '  \n '])('confirms a nonempty draft and Cancel keeps the old identity and text', async draft => {
    const { fetcher } = setup({ origin: 'think' });
    render(<TestRouter />);
    const editor = await screen.findByRole('textbox', { name: 'Message' });
    await waitFor(() => expect(window.location.search).toContain(oldId));
    fireEvent.change(editor, { target: { value: draft } });
    fireEvent.click(screen.getByRole('button', { name: 'Fixture visit Ground' }));
    const button = await screen.findByRole('button', { name: /Fixture skill description/ });
    fireEvent.click(button);
    expect(screen.getByText('Start a new chat? Your draft stays in the current chat.')).toBeInTheDocument();
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    expect(cancel).toHaveFocus();
    fireEvent.click(cancel);
    expect(button).toHaveFocus();
    expect(window.location.pathname).toBe('/ground');
    expect(fetcher.mock.calls.filter(([input, init]) => String(input) === base && init?.method === 'POST')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Fixture visit old Think' }));
    expect(await screen.findByRole('textbox', { name: 'Message' })).toHaveValue(draft);
    expect(window.location.search).toContain(oldId);
  });

  it('preserves the prior chat draft after confirming a fresh prefill', async () => {
    setup({ origin: 'think' });
    render(<TestRouter />);
    const editor = await screen.findByRole('textbox', { name: 'Message' });
    fireEvent.change(editor, { target: { value: 'prior chat draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'Fixture visit Ground' }));
    fireEvent.click(await screen.findByRole('button', { name: /Fixture skill description/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Start new chat' }));
    await waitFor(() => expect(window.location.pathname).toBe('/think'));
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue(original));
    expect(window.location.search).not.toContain(oldId);
    fireEvent.click(screen.getByRole('button', { name: 'Fixture visit old Think' }));
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('prior chat draft'));
  });

  it('fences delayed creation after later typing in the original chat without sending or redirecting', async () => {
    const { fetcher, pending } = setup({ origin: 'think', delayedCreate: true });
    const view = render(<TestRouter />);
    const editor = await screen.findByRole('textbox', { name: 'Message' });
    fireEvent.change(editor, { target: { value: 'original draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'Fixture visit Ground' }));
    fireEvent.click(await screen.findByRole('button', { name: /Fixture skill description/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Start new chat' }));
    await waitFor(() => expect(fetcher.mock.calls.some(([input, init]) => String(input) === base && init?.method === 'POST')).toBe(true));
    const create = fetcher.mock.calls.find(([input, init]) => String(input) === base && init?.method === 'POST');
    if (!create?.[1]?.body) throw new Error('Fixture expected create body');
    const command: { conversationId: string; clientCommandId: string } = JSON.parse(String(create[1].body));
    fireEvent.click(screen.getByRole('button', { name: 'Fixture visit old Think' }));
    const current = await screen.findByRole('textbox', { name: 'Message' });
    fireEvent.change(current, { target: { value: 'newer original draft' } });
    current.focus();
    pending.resolve(json({ ...command, epoch, kind: 'create', state: 'ready' }, 202));
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(window.location.search).toContain(oldId);
    expect(current).toHaveValue('newer original draft');
    expect(current).toHaveFocus();
    expect(fetcher.mock.calls.some(([input, init]) => init?.method === 'POST' && /\/(?:messages|stop)$/.test(String(input)))).toBe(false);
    view.rerender(<TestRouter target={command.conversationId} />);
    fireEvent.click(screen.getByRole('button', { name: 'Fixture visit prepared Think' }));
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue(original));
    fireEvent.click(screen.getByRole('button', { name: 'Fixture visit old Think' }));
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('newer original draft'));
  });

  it('checks an uncertain create using the same target and command without another create', async () => {
    const { fetcher } = setup({ failCreate: true });
    render(<TestRouter />);
    fireEvent.click(await screen.findByRole('button', { name: /Fixture skill description/ }));
    const check = await screen.findByRole('button', { name: 'Check chat' });
    const creates = fetcher.mock.calls.filter(([input, init]) => String(input) === base && init?.method === 'POST');
    expect(creates).toHaveLength(1);
    const command: { conversationId: string; clientCommandId: string } = JSON.parse(String(creates[0][1]?.body));
    fireEvent.click(check);
    await waitFor(() => expect(fetcher.mock.calls.some(([input, init]) => String(input) === `${base}/${command.conversationId}/commands/${command.clientCommandId}` && (init?.method ?? 'GET') === 'GET')).toBe(true));
    await waitFor(() => expect(window.location.search).toBe(`?conversation=${command.conversationId}`));
    expect(await screen.findByRole('textbox', { name: 'Message' })).toHaveValue(original);
    expect(fetcher.mock.calls.filter(([input, init]) => String(input) === base && init?.method === 'POST')).toHaveLength(1);
  });

  it('ignores repeated and competing activations while a create is pending', async () => {
    const { fetcher, pending } = setup({ delayedCreate: true });
    render(<TestRouter />);
    const skill = await screen.findByRole('button', { name: /Fixture skill description/ });
    const question = screen.getByRole('button', { name: new RegExp(prompt) });
    fireEvent.click(skill);
    await waitFor(() => expect(fetcher.mock.calls.filter(([input, init]) => String(input) === base && init?.method === 'POST')).toHaveLength(1));
    fireEvent.click(skill);
    fireEvent.click(question);
    const creates = fetcher.mock.calls.filter(([input, init]) => String(input) === base && init?.method === 'POST');
    expect(creates).toHaveLength(1);
    const command: { conversationId: string; clientCommandId: string } = JSON.parse(String(creates[0][1]?.body));
    pending.resolve(json({ ...command, epoch, kind: 'create', state: 'ready' }, 202));
    await waitFor(() => expect(window.location.search).toBe(`?conversation=${command.conversationId}`));
    expect(await screen.findByRole('textbox', { name: 'Message' })).toHaveValue(original);
    expect(fetcher.mock.calls.filter(([input, init]) => String(input) === base && init?.method === 'POST')).toHaveLength(1);
  });
});
