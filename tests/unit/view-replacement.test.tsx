import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TestPresentation } from './fixtures/presentation';

const conversationId = '11111111-1111-4111-8111-111111111111';
beforeEach(() => {
  window.sessionStorage.removeItem('memory-loop.think.current');
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const path = new URL(input instanceof Request ? input.url : String(input), window.location.origin).pathname;
    if (path === '/api/ground/recent-captures') return Response.json({ state: 'empty' });
    const ground = /^\/api\/ground\/(quick-actions|inspiration|prompts|goals)$/.exec(path);
    if (ground) return Response.json({ state: 'missing', noteId: ['03_Resources', 'Memory-Loop', `${ground[1]}.md`] });
    if (path.endsWith('/decisions')) return Response.json({ decisions: [] });
    if (path === `/api/think/conversations/${conversationId}`) return Response.json({ conversationId, epoch: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', revision: 1, creation: 'ready', sendEligibility: 'available', entries: [] });
    throw new Error(`Unexpected fixture request: ${path}`);
  }));
});
afterEach(() => window.sessionStorage.removeItem('memory-loop.think.current'));

it.each(['Ground', 'Capture', 'Think', 'Recall'])('renders a replacement %s view without changing shell destinations', name => {
  window.history.replaceState(null, '', name === 'Think' ? `/think?conversation=${conversationId}` : `/${name.toLowerCase()}`);
  render(<TestPresentation><h1>Replacement {name}</h1></TestPresentation>);
  expect(screen.getByRole('heading', { level: 1, name: `Replacement ${name}` })).toBeInTheDocument();
  const nav = screen.getByRole('navigation', { name: 'Primary' });
  for (const destination of ['Ground', 'Capture', 'Think', 'Recall']) {
    expect(within(nav).getByRole('link', { name: destination })).toHaveAttribute('href',
      destination === 'Think' && name === 'Think' ? `/think?conversation=${conversationId}` : `/${destination.toLowerCase()}`);
  }
});
