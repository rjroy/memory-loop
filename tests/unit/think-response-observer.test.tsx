import { describe, expect, it } from 'vitest';
import { observeThinkResponses } from '../e2e/think-response-observer';

const origin = 'http://127.0.0.1:4567';
function response(status: number, code: string, path = '/api/think/conversations') {
  return { status: () => status, url: () => `${origin}${path}`, request: () => ({ method: () => 'POST' }), json: async () => ({ error: { code } }) };
}

describe('Think accessibility response observation', () => {
  it('waits for a response event and its body even when observation completes first', async () => {
    const failures: string[] = [];
    const observer = observeThinkResponses(true, origin, failures);
    let finished = false;
    const completion = observer.waitForResponses().then(() => { finished = true; });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(finished).toBe(false);
    let releaseBody: (value: unknown) => void = () => { throw new Error('Body gate is not initialized'); };
    const body = new Promise<unknown>(resolve => { releaseBody = resolve; });
    observer.onResponse({ ...response(503, 'think_unavailable'), json: () => body });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(finished).toBe(false);
    releaseBody({ error: { code: 'think_unavailable' } });
    await completion;
    expect(observer.expectedResponses).toBe(1);
    expect(failures).toEqual([]);
  });

  it.each([
    [200, 'think_unavailable', '/api/think/conversations'],
    [500, 'think_unavailable', '/api/think/conversations'],
    [503, 'wrong_code', '/api/think/conversations'],
    [503, 'think_unavailable', '/api/unrelated'],
  ])('records unexpected HTTP errors: %s %s %s', async (status, code, path) => {
    const failures: string[] = [];
    const observer = observeThinkResponses(true, origin, failures);
    if (path === '/api/unrelated') observer.onResponse(response(503, 'think_unavailable'));
    observer.onResponse(response(status, code, path));
    await observer.waitForResponses();
    expect(observer.expectedResponses).toBe(path === '/api/unrelated' ? 1 : 0);
    expect(failures).toEqual(['Unexpected Think HTTP error response']);
  });

  it('counts duplicate expected responses', async () => {
    const failures: string[] = [];
    const observer = observeThinkResponses(true, origin, failures);
    observer.onResponse(response(503, 'think_unavailable'));
    observer.onResponse(response(503, 'think_unavailable'));
    await observer.waitForResponses();
    expect(observer.expectedResponses).toBe(2);
    expect(failures).toEqual([]);
  });

  it.each(['think_unavailable', 'wrong_code'])('waits for a response body observed during an earlier body check: %s', async code => {
    const failures: string[] = [];
    const observer = observeThinkResponses(true, origin, failures);
    let releaseFirst: (value: unknown) => void = () => { throw new Error('First body gate is not initialized'); };
    let releaseSecond: (value: unknown) => void = () => { throw new Error('Second body gate is not initialized'); };
    const firstBody = new Promise<unknown>(resolve => { releaseFirst = resolve; });
    const secondBody = new Promise<unknown>(resolve => { releaseSecond = resolve; });
    observer.onResponse({ ...response(503, 'think_unavailable'), json: () => firstBody });
    let finished = false;
    const completion = observer.waitForResponses().then(() => { finished = true; });
    await Promise.resolve();
    observer.onResponse({ ...response(503, code), json: () => secondBody });
    releaseFirst({ error: { code: 'think_unavailable' } });
    try {
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(finished).toBe(false);
    } finally { releaseSecond({ error: { code } }); }
    await completion;
    expect(observer.expectedResponses).toBe(code === 'think_unavailable' ? 2 : 1);
    expect(failures).toEqual(code === 'think_unavailable' ? [] : ['Unexpected Think HTTP error response']);
  });

  it('records unrelated console errors instead of allowing them', () => {
    const failures: string[] = [];
    const observer = observeThinkResponses(true, origin, failures);
    observer.onConsole({ type: () => 'error', location: () => ({ url: `${origin}/other` }), text: () => 'unexpected console error' });
    expect(failures).toEqual(['unexpected console error']);
    expect(observer.expectedConsoleErrors).toBe(0);
  });

  it('counts only the exact expected console error and retains duplicates', () => {
    const failures: string[] = [];
    const observer = observeThinkResponses(true, origin, failures);
    const message = { type: () => 'error', location: () => ({ url: `${origin}/api/think/conversations` }), text: () => 'Failed to load resource: the server responded with a status of 503 (Service Unavailable)' };
    observer.onConsole(message);
    observer.onConsole(message);
    observer.onConsole({ ...message, location: () => ({ url: 'http://other.invalid/api/think/conversations' }) });
    expect(observer.expectedConsoleErrors).toBe(2);
    expect(failures).toEqual([message.text()]);
  });
});
