import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import GroundView from '../../src/views/GroundView';
import CaptureView from '../../src/views/CaptureView';
import ThinkView from '../../src/views/ThinkView';
import NotFoundView from '../../src/views/NotFoundView';
import { TestPresentation } from './fixtures/presentation';

beforeEach(() => window.sessionStorage.removeItem('memory-loop.think.current'));
afterEach(() => window.sessionStorage.removeItem('memory-loop.think.current'));

describe('shell component semantics', () => {
  it('shows ordered navigation and the real Ground card destinations', async () => {
    window.history.replaceState(null, '', '/ground');
    const hash = 'a'.repeat(64);
    const resource = (name: string, data: object) => ({ state: 'ready', noteId: ['03_Resources', 'Memory-Loop', `${name}.md`], revision: hash, data });
    const payloads: Record<string, object> = {
      '/api/ground/quick-actions': resource('quick-actions', { actions: [{ id: '@fixture', skill: '@fixture', description: 'Fixture action' }] }),
      '/api/ground/inspiration': resource('inspiration', { quote: { id: hash, text: 'Fictional fixture quote', attribution: 'Fixture author', source: { title: 'Fixture source' } } }),
      '/api/ground/prompts': resource('prompts', { question: { id: hash, text: 'Fixture question' } }),
      '/api/ground/goals': resource('goals', { markdown: 'Fixture goal' }),
      '/api/ground/recent-captures': { state: 'ready', coverage: 'complete', items: [{ id: hash, localDateTime: '2026-01-01T12:34', timeBasis: 'recorded-local', excerpt: 'Fixture capture', noteId: ['00_Inbox', '2026-01-01.md'] }] },
    };
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(input instanceof Request ? input.url : String(input), window.location.origin).pathname;
      if (!Object.hasOwn(payloads, path)) throw new Error(`Unexpected fixture request: ${path}`);
      return Response.json(payloads[path]);
    });
    vi.stubGlobal('fetch', fetcher);
    const historyLength = window.history.length;
    render(<TestPresentation><GroundView /></TestPresentation>);
    const nav = screen.getByRole('navigation', { name: 'Primary' });
    expect(within(nav).getAllByRole('link').map(link => [link.textContent?.trim(), link.getAttribute('href')])).toEqual([
      ['Ground', '/ground'], ['Capture', '/capture'], ['Think', '/think'], ['Recall', '/recall'],
    ]);
    expect(within(nav).getByRole('link', { name: 'Ground' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveAttribute('href', '#main-content');
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    const main = screen.getByRole('main');
    expect(within(main).getByRole('heading', { level: 1, name: 'Ground' })).toBeInTheDocument();
    for (const name of ['Quick Actions', 'Inspiration', 'Prompts', 'Current Goals', 'Recent captures']) expect(within(main).getByRole('heading', { level: 2, name })).toBeInTheDocument();
    expect(await within(main).findByRole('button', { name: /Fixture action/ })).toBeEnabled();
    expect(within(main).getByRole('button', { name: /Fixture question/ })).toBeEnabled();
    expect(within(main).getByRole('link', { name: /Fixture capture/ })).toHaveAttribute('href', `/recall?${new URLSearchParams({ file: JSON.stringify(['00_Inbox', '2026-01-01.md']) })}`);
    expect(within(main).queryByRole('heading', { name: 'Recent conversations' })).not.toBeInTheDocument();
    expect(within(main).queryByRole('button', { name: /resume|delete/i })).not.toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledTimes(5);
    expect(window.history.length).toBe(historyLength);
  });

  it('keeps shell navigation and accessible editor focus on the live Capture route', () => {
    window.history.replaceState(null, '', '/capture');
    const historyLength = window.history.length;
    render(<TestPresentation><CaptureView /></TestPresentation>);
    const nav = screen.getByRole('navigation', { name: 'Primary' });
    expect(within(nav).getAllByRole('link').map(link => [link.textContent?.trim(), link.getAttribute('href')])).toEqual([
      ['Ground', '/ground'], ['Capture', '/capture'], ['Think', '/think'], ['Recall', '/recall'],
    ]);
    expect(within(nav).getByRole('link', { name: 'Capture' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveAttribute('href', '#main-content');
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    const main = screen.getByRole('main');
    expect(within(main).getByRole('heading', { level: 1, name: 'Capture' })).toBeInTheDocument();
    const editor = within(main).getByRole('textbox', { name: 'Thought' });
    expect(editor).toBeEnabled();
    expect(editor).not.toHaveFocus();
    editor.focus();
    expect(editor).toHaveFocus();
    expect(window.history.length).toBe(historyLength);
  });

  it('keeps shell navigation and accessible message composition on the live Think route', () => {
    const current = '11111111-1111-4111-8111-111111111111';
    window.sessionStorage.setItem('memory-loop.think.current', '22222222-2222-4222-8222-222222222222');
    window.history.replaceState(null, '', `/think?conversation=${current}`);
    const historyLength = window.history.length;
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('fixture offline')));
    render(<TestPresentation><ThinkView /></TestPresentation>);
    const nav = screen.getByRole('navigation', { name: 'Primary' });
    expect(within(nav).getAllByRole('link').map(link => [link.textContent?.trim(), link.getAttribute('href')])).toEqual([
      ['Ground', '/ground'], ['Capture', '/capture'], ['Think', `/think?conversation=${current}`], ['Recall', '/recall'],
    ]);
    expect(within(nav).getByRole('link', { name: 'Think' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveAttribute('href', '#main-content');
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    const main = screen.getByRole('main');
    expect(within(main).getByRole('heading', { level: 1, name: 'Think' })).toBeInTheDocument();
    const editor = within(main).getByRole('textbox', { name: 'Message' });
    expect(editor).toBeEnabled();
    editor.focus();
    expect(editor).toHaveFocus();
    expect(window.history.length).toBe(historyLength);
  });

  it('offers an unknown-address recovery link without selecting a destination', () => {
    window.history.replaceState(null, '', '/missing');
    render(<TestPresentation><NotFoundView /></TestPresentation>);
    expect(screen.getByRole('heading', { level: 1, name: 'Page not found' })).toBeInTheDocument();
    expect(screen.getByText("This address doesn't match a Memory Loop view.")).toBeInTheDocument();
    expect(within(screen.getByRole('navigation', { name: 'Primary' })).queryByRole('link', { current: 'page' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to Ground' })).toHaveAttribute('href', '/ground');
  });
});
