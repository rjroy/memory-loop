import { isVaultId } from '../../backend/contract';
import type { CaptureItem, CapturesRead, GroundIssueCode, GroundQuestion, GroundQuote, GroundResourceData, QuickAction, ResourceRead } from '../../backend/ground-contract';

export type GroundRoute = 'quick-actions' | 'inspiration' | 'prompts' | 'goals' | 'recent-captures';
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const text = (value: unknown, max: number): value is string => typeof value === 'string' && !!value.trim() && new TextEncoder().encode(value).length <= max && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value);
const issueCode = (value: unknown): value is GroundIssueCode => value === 'invalid_utf8' || value === 'too_large' || value === 'invalid_format' || value === 'too_many_entries';
const safeResourceId = (value: unknown): value is string[] => isVaultId(value) && value.length >= 3 && value[0] === '03_Resources' && value[1] === 'Memory-Loop' && value[value.length - 1].endsWith('.md');

function date(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function action(value: unknown): QuickAction {
  if (!object(value) || typeof value.skill !== 'string' || !/^@[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value.skill) || value.id !== value.skill || !text(value.description, 1024)) throw new Error('invalid action');
  return { id: value.skill, skill: value.skill, description: value.description };
}
function question(value: unknown): GroundQuestion {
  if (!object(value) || !hash(value.id) || !text(value.text, 2048)) throw new Error('invalid question');
  return { id: value.id, text: value.text };
}
function quote(value: unknown): GroundQuote {
  if (!object(value) || !hash(value.id) || !text(value.text, 4096) || !text(value.attribution, 256) || !object(value.source) || !text(value.source.title, 512)) throw new Error('invalid quote');
  const source: GroundQuote['source'] = { title: value.source.title };
  if (value.source.url !== undefined) {
    if (typeof value.source.url !== 'string' || new TextEncoder().encode(value.source.url).length > 2048 || /[\x00-\x20\x7f]/.test(value.source.url)) throw new Error('invalid source');
    const url = new URL(value.source.url);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('invalid source');
    source.url = value.source.url;
  }
  return { id: value.id, text: value.text, attribution: value.attribution, source };
}
function capture(value: unknown): CaptureItem {
  if (!object(value) || !hash(value.id) || typeof value.localDateTime !== 'string' || !/^\d{4}-\d\d-\d\dT(?:[01]\d|2[0-3]):[0-5]\d$/.test(value.localDateTime) || !date(value.localDateTime.slice(0, 10)) || value.timeBasis !== 'recorded-local' ||
      typeof value.excerpt !== 'string' || Array.from(value.excerpt).length > 400 || /\r/.test(value.excerpt) || !isVaultId(value.noteId) || value.noteId.length !== 2 || value.noteId[0] !== '00_Inbox' || value.noteId[1] !== `${value.localDateTime.slice(0, 10)}.md`) throw new Error('invalid capture');
  return { id: value.id, localDateTime: value.localDateTime, timeBasis: 'recorded-local', excerpt: value.excerpt, noteId: [...value.noteId] };
}

/** Reconstruct only the public fields; never forward arbitrary upstream properties. */
export function projectGround(value: unknown, route: GroundRoute, status: number): ResourceRead<GroundResourceData[keyof GroundResourceData]> | CapturesRead {
  if (!object(value)) throw new Error('invalid response');
  if (value.state === 'unavailable' && status === 503 && (value.reason === 'configuration' || value.reason === 'io')) {
    if (route === 'recent-captures') return { state: 'unavailable', reason: value.reason };
    if (value.noteId !== undefined && !safeResourceId(value.noteId)) throw new Error('invalid note');
    return { state: 'unavailable', reason: value.reason, ...(value.noteId === undefined ? {} : { noteId: [...value.noteId] }) };
  }
  if (status !== 200) throw new Error('invalid status');
  if (route === 'recent-captures') {
    if (value.state === 'empty' || value.state === 'missing') return { state: value.state };
    if (value.state === 'malformed' && object(value.issue) && value.issue.code === 'source_coverage') return { state: 'malformed', issue: { code: 'source_coverage' } };
    if (value.state !== 'ready' || value.coverage !== 'complete' && value.coverage !== 'partial' || !Array.isArray(value.items) || value.items.length < 1 || value.items.length > 5) throw new Error('invalid captures');
    const items = value.items.map(capture);
    if (new Set(items.map(item => item.id)).size !== items.length || items.some((item, index) => index > 0 && item.localDateTime > items[index - 1].localDateTime)) throw new Error('invalid capture order');
    return { state: 'ready', coverage: value.coverage, items };
  }
  if (!safeResourceId(value.noteId)) throw new Error('invalid note');
  const noteId = [...value.noteId];
  if (value.state === 'empty' || value.state === 'missing') return { state: value.state, noteId };
  if (value.state === 'malformed' && object(value.issue) && issueCode(value.issue.code) && (value.issue.line === undefined || typeof value.issue.line === 'number' && Number.isSafeInteger(value.issue.line) && value.issue.line > 0)) {
    return { state: 'malformed', noteId, issue: { code: value.issue.code, ...(value.issue.line === undefined ? {} : { line: value.issue.line }) } };
  }
  if (value.state !== 'ready' || !hash(value.revision) || !object(value.data)) throw new Error('invalid resource');
  const revision = value.revision;
  if (route === 'goals' && typeof value.data.markdown === 'string' && value.data.markdown.trim() && new TextEncoder().encode(value.data.markdown).length <= 65536) return { state: 'ready', noteId, revision, data: { markdown: value.data.markdown } };
  if (route === 'prompts') return { state: 'ready', noteId, revision, data: { question: question(value.data.question) } };
  if (route === 'inspiration') return { state: 'ready', noteId, revision, data: { quote: quote(value.data.quote) } };
  if (route === 'quick-actions' && Array.isArray(value.data.actions) && value.data.actions.length > 0 && value.data.actions.length <= 50) {
    const actions = value.data.actions.map(action);
    if (new Set(actions.map(item => item.id)).size !== actions.length) throw new Error('duplicate actions');
    return { state: 'ready', noteId, revision, data: { actions } };
  }
  throw new Error('invalid resource');
}
