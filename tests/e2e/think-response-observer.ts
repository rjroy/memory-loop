type ObservedResponse = { status(): number; url(): string; request(): { method(): string }; json(): Promise<unknown> };
type ObservedConsole = { type(): string; location(): { url?: string }; text(): string };

// The create response is a separate barrier from the checks already in flight.
export function observeThinkResponses(enabled: boolean, allowedOrigin: string, failures: string[]) {
  let expectedResponses = 0;
  let expectedConsoleErrors = 0;
  let createResponseSeen = false;
  let signalCreateResponse: () => void = () => { throw new Error('Response barrier is not initialized'); };
  const createResponse = new Promise<void>(resolve => { signalCreateResponse = resolve; });
  const responseChecks: Promise<void>[] = [];
  return {
    onConsole(message: ObservedConsole) {
      if (message.type() !== 'error') return;
      const location = message.location().url;
      const url = location ? new URL(location, allowedOrigin) : undefined;
      if (enabled && url?.origin === allowedOrigin && url.pathname === '/api/think/conversations' && !url.search &&
          message.text() === 'Failed to load resource: the server responded with a status of 503 (Service Unavailable)') expectedConsoleErrors++;
      else failures.push(message.text());
    },
    onResponse(response: ObservedResponse) {
      if (!enabled) return;
      const url = new URL(response.url());
      const create = url.origin === allowedOrigin && url.pathname === '/api/think/conversations' && !url.search && response.request().method() === 'POST';
      if (!create && response.status() < 400) return;
      responseChecks.push((async () => {
        try {
          const value: unknown = await response.json();
          if (create && response.status() === 503 &&
              typeof value === 'object' && value !== null && 'error' in value && typeof value.error === 'object' && value.error !== null && 'code' in value.error && value.error.code === 'think_unavailable') { expectedResponses++; return; }
        } catch { /* Unexpected or unreadable error responses remain failures. */ }
        failures.push('Unexpected Think HTTP error response');
      })());
      if (create && !createResponseSeen) { createResponseSeen = true; signalCreateResponse(); }
    },
    async waitForResponses() {
      if (enabled) await createResponse;
      let checked = 0;
      while (checked < responseChecks.length) {
        const end = responseChecks.length;
        await Promise.all(responseChecks.slice(checked, end));
        checked = end;
      }
    },
    get createResponseSeen() { return createResponseSeen; },
    get expectedResponses() { return expectedResponses; },
    get expectedConsoleErrors() { return expectedConsoleErrors; },
  };
}
