import { expect, vi } from 'vitest';
import type { VaultErrorCode, VaultId, VaultTreeResponse } from '../../../backend/contract';

// All names/content here belong to the tests. Never read application config or disk.
export const alphaId = ['Test shelf & café', 'Alpha #1.md'] as const;
export const betaId = ['Test shelf & café', 'Beta.md'] as const;
export const rootId = ['Root.md'] as const;
export const vaultTree: VaultTreeResponse = {
  entries: [
    {
      kind: 'directory', name: 'Test shelf & café', id: ['Test shelf & café'],
      children: [
        { kind: 'note', name: 'Alpha #1.md', id: alphaId },
        { kind: 'note', name: 'Beta.md', id: betaId },
        { kind: 'directory', name: 'Empty test folder', id: ['Test shelf & café', 'Empty test folder'], children: [] },
      ],
    },
    { kind: 'note', name: 'Root.md', id: rootId },
  ],
};

export function noteLocation(id: VaultId): string {
  return `/recall?${new URLSearchParams({ file: JSON.stringify(id) })}`;
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

export function errorResponse(code: VaultErrorCode, status: number): Response {
  // Deliberately generic: the UI must distinguish structured codes, not this message.
  return jsonResponse({ error: { code, message: 'Controlled fixture failure.' } }, status);
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function requestUrl(input: RequestInfo | URL): URL {
  return new URL(input instanceof Request ? input.url : String(input), window.location.origin);
}

/** In-process fetch only; even malformed/unexpected calls can never reach a live daemon. */
export function installVaultApi(options: {
  tree?: () => Response | Promise<Response>;
  note?: (id: VaultId) => Response | Promise<Response>;
} = {}) {
  // Browser call signature only; Bun's extra static fetch.preconnect is not a UI API.
  const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async (input, init) => {
    const url = requestUrl(input);
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
    if (url.origin !== window.location.origin || method.toUpperCase() !== 'GET') {
      throw new Error('Unexpected non-local/read-only request in unit test');
    }
    if (url.pathname === '/api/vault/tree' && !url.search) {
      return options.tree?.() ?? jsonResponse(vaultTree);
    }
    if (url.pathname === '/api/vault/note' && url.searchParams.getAll('id').length === 1) {
      const id: unknown = JSON.parse(url.searchParams.get('id')!);
      if (!Array.isArray(id) || !id.length || !id.every(part => typeof part === 'string')) {
        throw new Error('Expected JSON component-array ID');
      }
      return options.note?.(id) ?? jsonResponse({ name: id.at(-1), markdown: `Fixture body for ${id.at(-1)}.` });
    }
    throw new Error('Unexpected endpoint in unit test');
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

export function expectOnlyVaultReads(fetchMock: ReturnType<typeof installVaultApi>) {
  for (const [input, init] of fetchMock.mock.calls) {
    const url = requestUrl(input);
    expect(url.origin).toBe(window.location.origin);
    expect((init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()).toBe('GET');
    expect(['/api/vault/tree', '/api/vault/note']).toContain(url.pathname);
    expect([...url.searchParams.keys()]).toEqual(url.pathname.endsWith('/note') ? ['id'] : []);
    if (url.pathname.endsWith('/note')) {
      const id: unknown = JSON.parse(url.searchParams.get('id')!);
      expect(Array.isArray(id) && id.length > 0 && id.every(part => typeof part === 'string')).toBe(true);
    }
  }
}

/** Width-media/control semantics only. jsdom does not prove layout or scroll geometry. */
export function installViewport(initialWidth: number) {
  let width = initialWidth;
  const queries: MediaQueryList[] = [];
  const evaluate = (query: string) => {
    const bounds = [...query.matchAll(/(min|max)-width\s*:\s*([\d.]+)(px|rem|em)/g)];
    return bounds.length > 0 && bounds.every(([, edge, value, unit]) => {
      const pixels = Number(value) * (unit === 'px' ? 1 : 16);
      return edge === 'min' ? width >= pixels : width <= pixels;
    });
  };
  vi.stubGlobal('innerWidth', width);
  vi.stubGlobal('matchMedia', vi.fn((media: string) => {
    const listeners = new Set<EventListenerOrEventListenerObject>();
    const list = {
      media,
      get matches() { return evaluate(media); },
      onchange: null,
      addEventListener: (type: string, listener: EventListenerOrEventListenerObject | null) => {
        if (type === 'change' && listener) listeners.add(listener);
      },
      removeEventListener: (_type: string, listener: EventListenerOrEventListenerObject | null) => {
        if (listener) listeners.delete(listener);
      },
      addListener: (listener: EventListener) => { listeners.add(listener); },
      removeListener: (listener: EventListener) => { listeners.delete(listener); },
      dispatchEvent: (event: Event) => {
        for (const listener of listeners) {
          if (typeof listener === 'function') listener.call(list, event);
          else listener.handleEvent(event);
        }
        list.onchange?.call(list, event as MediaQueryListEvent);
        return true;
      },
    } as MediaQueryList;
    queries.push(list);
    return list;
  }));
  return {
    resize(nextWidth: number) {
      const previous = queries.map(query => query.matches);
      width = nextWidth;
      vi.stubGlobal('innerWidth', width);
      queries.forEach((query, index) => {
        if (query.matches !== previous[index]) {
          const event = new Event('change');
          Object.defineProperties(event, { matches: { value: query.matches }, media: { value: query.media } });
          query.dispatchEvent(event);
        }
      });
      window.dispatchEvent(new Event('resize'));
    },
  };
}
