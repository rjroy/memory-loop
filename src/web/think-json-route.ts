import { parseContentRequest } from '../../backend/think/content-transfer';

const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const base = '/api/think/conversations';
const decision = '[A-Za-z0-9_-]{1,128}';
const routes = [
  { operation: 'create', method: 'POST', pattern: new RegExp(`^${base}$`) },
  { operation: 'snapshot', method: 'GET', pattern: new RegExp(`^${base}/(${uuid})$`) },
  { operation: 'command', method: 'GET', pattern: new RegExp(`^${base}/(${uuid})/commands/(${uuid})$`) },
  { operation: 'content', method: 'GET', pattern: new RegExp(`^${base}/(${uuid})/content/(${uuid})$`) },
  { operation: 'send', method: 'POST', pattern: new RegExp(`^${base}/(${uuid})/messages$`) },
  { operation: 'stop', method: 'POST', pattern: new RegExp(`^${base}/(${uuid})/runs/(${uuid})/stop$`) },
  { operation: 'decisions', method: 'GET', pattern: new RegExp(`^${base}/(${uuid})/decisions$`) },
  { operation: 'decision', method: 'GET', pattern: new RegExp(`^${base}/(${uuid})/decisions/(${decision})$`) },
  { operation: 'reply', method: 'POST', pattern: new RegExp(`^${base}/(${uuid})/decisions/(${decision})/reply$`) },
] as const;

/** Classifies the target before either boundary applies its own method policy. */
export function classifyThinkJsonRoute(url: URL, method: string) {
  if (url.hash) return;
  for (const route of routes) {
    const match = route.pattern.exec(url.pathname);
    if (!match) continue;
    if (method === 'GET' && route.operation === 'content') {
      if (!parseContentRequest(match[1], match[2], url.searchParams)) return;
    } else if (url.search && !(method === 'GET' && route.operation === 'snapshot' &&
      [...url.searchParams.keys()].length === 1 && /^[A-Za-z0-9_-]{1,256}\.[a-f0-9]{64}$/.test(url.searchParams.get('cursor') ?? ''))) return;
    return { operation: route.operation, method: route.method, conversationId: match[1], resourceId: match[2] };
  }
}
