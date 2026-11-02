import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it } from 'vitest';
import type { VaultSearchRequest, VaultSearchResponse } from '../../backend/contract';
import RecallView from '../../src/views/RecallView';
import { TestPresentation } from './fixtures/presentation';
import { alphaId, betaId, installVaultApi, installViewport, jsonResponse, noteLocation } from './fixtures/recall';

let searches: VaultSearchRequest[];
let saves: unknown[];

beforeEach(() => {
  installViewport(1440);
  searches = []; saves = [];
  const response: VaultSearchResponse = { mode: 'filename', counts: { matches: 1, files: 1 }, limited: false,
    coverage: { complete: true, filesSearched: 2, skippedFiles: { binary: 0, invalidEncoding: 0, unreadable: 0, changed: 0 }, skippedLines: 0, timedOut: false },
    hits: [{ id: betaId, name: 'Beta.md', path: betaId.join('/'), field: 'name', positions: [0, 1], score: 1 }] };
  const api = installVaultApi({ note: id => jsonResponse({ name: id.at(-1), markdown: '# Original\n', revision: 'a'.repeat(64), editable: true }) });
  const read = api.getMockImplementation();
  if (!read) throw new Error('Missing fixture fetch');
  api.mockImplementation(async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), window.location.origin);
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    if (url.origin === window.location.origin && url.pathname === '/api/vault/search' && method === 'POST') {
      const body: VaultSearchRequest = JSON.parse(String(init?.body));
      searches.push(body);
      return jsonResponse(response);
    }
    if (url.origin === window.location.origin && url.pathname === '/api/vault/note' && method === 'POST') {
      saves.push(JSON.parse(String(init?.body)));
      return jsonResponse({ revision: 'b'.repeat(64) });
    }
    return read(input, init);
  });
});

it('reruns the active query after a confirmed save without selecting a result', async () => {
  const user = userEvent.setup();
  window.history.replaceState(null, '', noteLocation(alphaId));
  render(<TestPresentation><RecallView /></TestPresentation>);
  await screen.findByRole('article', { name: 'Alpha #1.md' });
  const files = await screen.findByRole('navigation', { name: 'Vault files' });
  await user.type(within(files).getByRole('searchbox'), 'Be');
  await within(files).findByRole('link', { name: /Beta\.md/ });
  await waitFor(() => expect(searches.at(-1)).toEqual({ mode: 'filename', query: 'Be' }));
  const previousCount = searches.length;
  await user.click(screen.getByRole('button', { name: 'Edit' }));
  fireEvent.change(screen.getByRole('textbox', { name: /markdown/i }), { target: { value: '# Saved fixture\n' } });
  await user.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(saves).toHaveLength(1));
  await waitFor(() => expect(searches.length).toBeGreaterThan(previousCount));
  expect(searches.at(-1)).toEqual({ mode: 'filename', query: 'Be' });
  expect(JSON.parse(new URL(window.location.href).searchParams.get('file') ?? 'null')).toEqual(alphaId);
  expect(screen.getByRole('article', { name: 'Alpha #1.md' })).toHaveTextContent('Saved fixture');
  expect(within(files).getByRole('link', { name: /Beta\.md/ })).toBeInTheDocument();
});
