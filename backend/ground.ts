import { createHash, randomInt } from 'node:crypto';
import { constants } from 'node:fs';
import { open, readdir, stat } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { isVaultComponent } from './contract';
import type { CaptureItem, CapturesRead, GroundResource, GroundResourceData, ResourceRead } from './ground-contract';
import { parseGroundCollection, weightedSelection } from './ground-parsers';

const directoryFlags = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;
const fileFlags = constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW;
const rootPath = (handle: FileHandle, name?: string) => `/proc/self/fd/${handle.fd}${name === undefined ? '' : `/${name}`}`;
const hash = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex');
const missing = (error: unknown) => typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const defaults: Record<GroundResource, string> = {
  quickActions: '03_Resources/Memory-Loop/quick-actions.md', inspiration: '03_Resources/Memory-Loop/inspiration.md',
  prompts: '03_Resources/Memory-Loop/prompts.md', goals: '03_Resources/Memory-Loop/goals.md',
};
const kinds = Object.keys(defaults) as GroundResource[];

function resourcePaths(config: unknown): Record<GroundResource, string[] | undefined> {
  const invalid = Object.fromEntries(kinds.map(kind => [kind, undefined])) as Record<GroundResource, undefined>;
  if (config !== undefined && (!record(config) || Object.keys(config).some(key => key !== 'resources' && key !== 'generation'))) return invalid;
  const raw = record(config) ? config.resources : undefined;
  if (raw !== undefined && (!record(raw) || Object.keys(raw).some(key => !kinds.includes(key as GroundResource)))) return invalid;
  const paths = Object.fromEntries(kinds.map(kind => {
    const value = record(raw) && Object.hasOwn(raw, kind) ? raw[kind] : defaults[kind];
    if (typeof value !== 'string') return [kind, undefined];
    const parts = value.split('/');
    return [kind, parts.length >= 3 && parts[0] === '03_Resources' && parts[1] === 'Memory-Loop' && parts.every(isVaultComponent) && parts.at(-1)?.endsWith('.md') ? parts : undefined];
  })) as Record<GroundResource, string[] | undefined>;
  const duplicates = kinds.filter(kind => paths[kind] && kinds.some(other => other !== kind && paths[other]?.join('/') === paths[kind]?.join('/')));
  for (const kind of duplicates) paths[kind] = undefined;
  return paths;
}

async function readFile(root: FileHandle, components: readonly string[], limit: number): Promise<Uint8Array> {
  const handles: FileHandle[] = [];
  try {
    let parent = root;
    for (const component of components.slice(0, -1)) { parent = await open(rootPath(parent, component), directoryFlags); handles.push(parent); }
    const file = await open(rootPath(parent, components[components.length - 1]), fileFlags);
    handles.push(file);
    const info = await file.stat();
    if (!info.isFile() || info.nlink !== 1) throw new Error('unsafe file');
    const buffer = Buffer.alloc(limit + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const result = await file.read(buffer, offset, buffer.length - offset, offset);
      if (!result.bytesRead) break;
      offset += result.bytesRead;
    }
    return buffer.subarray(0, offset);
  } finally { for (const handle of handles.reverse()) await handle.close(); }
}

export interface GroundReader {
  resource(kind: GroundResource): Promise<ResourceRead<GroundResourceData[GroundResource]>>;
  captures(): Promise<CapturesRead>;
  close(): Promise<void>;
}

export async function openGround(root: string, config?: unknown, draw: (max: number) => number = randomInt): Promise<GroundReader> {
  const pinned = await open(root, directoryFlags);
  try {
    const actual = await pinned.stat();
    const viaProc = await stat(rootPath(pinned));
    if (!actual.isDirectory() || actual.dev !== viaProc.dev || actual.ino !== viaProc.ino) throw new Error('descriptor unavailable');
  } catch (error) { await pinned.close(); throw error; }
  const paths = resourcePaths(config);
  return {
    async resource(kind) {
      const noteId = paths[kind];
      if (!noteId) return { state: 'unavailable', reason: 'configuration' };
      let bytes: Uint8Array;
      try { bytes = await readFile(pinned, noteId, 65536); }
      catch (error) { return missing(error) ? { state: 'missing', noteId } : { state: 'unavailable', reason: 'io', noteId }; }
      if (bytes.length > 65536) return { state: 'malformed', noteId, issue: { code: 'too_large' } };
      let text: string;
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
      catch { return { state: 'malformed', noteId, issue: { code: 'invalid_utf8' } }; }
      const revision = hash(bytes);
      if (kind === 'goals') return text.trim() ? { state: 'ready', noteId, revision, data: { markdown: text } } : { state: 'empty', noteId };
      if (kind === 'quickActions') {
        const parsed = parseGroundCollection(kind, text);
        return parsed.state === 'ready' ? { state: 'ready', noteId, revision, data: { actions: parsed.items } } : { ...parsed, noteId };
      }
      if (kind === 'inspiration') {
        const parsed = parseGroundCollection(kind, text);
        if (parsed.state !== 'ready') return { ...parsed, noteId };
        const quote = weightedSelection(parsed.items, draw);
        if (!quote) throw new Error('Missing selected quote');
        return { state: 'ready', noteId, revision, data: { quote } };
      }
      const parsed = parseGroundCollection(kind, text);
      if (parsed.state !== 'ready') return { ...parsed, noteId };
      const question = weightedSelection(parsed.items, draw);
      if (!question) throw new Error('Missing selected question');
      return { state: 'ready', noteId, revision, data: { question } };
    },
    async captures() { return recentCaptures(pinned); },
    async close() { await pinned.close(); },
  };
}

async function recentCaptures(root: FileHandle): Promise<CapturesRead> {
  let inbox: FileHandle;
  try { inbox = await open(rootPath(root, '00_Inbox'), directoryFlags); }
  catch (error) { return missing(error) ? { state: 'missing' } : { state: 'unavailable', reason: 'io' }; }
  try {
    const names = (await readdir(rootPath(inbox))).filter(name => {
      if (!/^\d{4}-\d{2}-\d{2}\.md$/.test(name)) return false;
      const date = name.slice(0, 10);
      const parsed = new Date(`${date}T00:00:00Z`);
      return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
    }).sort().reverse();
    const items: Array<CaptureItem & { offset: number }> = [];
    let remaining = 8 * 1024 * 1024;
    let partial = false;
    for (const name of names) {
      if (items.length >= 5 && name.slice(0, 10) < items[4].localDateTime.slice(0, 10)) break;
      let bytes: Uint8Array;
      try { bytes = await readFile(inbox, [name], remaining); }
      catch { partial = true; continue; }
      if (bytes.length > remaining) { partial = true; break; }
      remaining -= bytes.length;
      let text: string;
      try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
      catch { partial = true; continue; }
      const lines = text.match(/[^\n]*(?:\n|$)/g)?.filter(line => line.length) ?? [];
      let offset = 0;
      let current: { offset: number; time: string; text: string[]; raw: string } | undefined;
      const finish = () => {
        if (!current) return;
        const noteId = ['00_Inbox', name];
        const entryDigest = hash(current.raw);
        items.push({ id: hash(JSON.stringify([noteId, current.offset, entryDigest])), localDateTime: `${name.slice(0, 10)}T${current.time}`, timeBasis: 'recorded-local', excerpt: Array.from(current.text.join('\n')).slice(0, 400).join(''), noteId, offset: current.offset });
        current = undefined;
      };
      for (const raw of lines) {
        const line = raw.replace(/\r?\n$/, '');
        const match = /^- \[(\d{2}):(\d{2})\] (.*)$/.exec(line);
        if (match && Number(match[1]) < 24 && Number(match[2]) < 60) {
          finish(); current = { offset, time: `${match[1]}:${match[2]}`, text: [match[3]], raw };
        } else if (current && line.startsWith('  ')) { current.text.push(line.slice(2)); current.raw += raw; }
        else { finish(); if (/^- \[\d{2}:\d{2}\]/.test(line)) partial = true; }
        offset += Buffer.byteLength(raw);
      }
      finish();
      items.sort((a, b) => b.localDateTime.localeCompare(a.localDateTime) || b.offset - a.offset);
      if (items.length > 5) items.length = 5;
    }
    if (!items.length) return partial ? { state: 'malformed', issue: { code: 'source_coverage' } } : { state: 'empty' };
    return { state: 'ready', coverage: partial ? 'partial' : 'complete', items: items.map(({ offset: _offset, ...item }) => item) };
  } catch { return { state: 'unavailable', reason: 'io' }; }
  finally { await inbox.close(); }
}
