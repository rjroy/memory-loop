import type { Stats, Dir } from 'node:fs';
import { opendir } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { setImmediate as yieldImmediate } from 'node:timers/promises';
import { fileTypeFromBuffer } from 'file-type';
import fuzzysort from 'fuzzysort';
import {
  isVaultComponent, normalizeSearchQuery, parseVaultSearchContextRequest, parseVaultSearchRequest,
  type VaultId, type VaultContentHit, type VaultFilenameHit, type VaultSearchCoverage,
  type VaultSearchRequest, type VaultSearchResponse, type VaultSearchSnippet,
  type VaultSearchContextRequest, type VaultSearchContextResponse, type VaultSearchContextLine,
} from './contract';

export interface VaultSearchHooks {
  onSearchFileOpened?: (id: VaultId, file: FileHandle) => Promise<void>;
  onSearchChunk?: (id: VaultId) => Promise<void>;
  searchNow?: () => number;
}
interface SearchBoundary {
  directoryPath: (id: VaultId) => Promise<string>;
  openRegular: (id: VaultId) => Promise<{ file: FileHandle }>;
  version: (stats: Stats) => string;
}

export class VaultSearchError extends Error {
  constructor(readonly code: 'invalid_request' | 'search_unavailable' | 'search_context_changed') {
    super(code);
  }
}
class ScanDeadline extends Error {}
class ScanAborted extends Error {}
class InvalidEncoding extends Error {}
class BinaryFile extends Error {}
class ChangedFile extends Error {}

const lineLimit = 256 * 1024;
const responseLimit = 2 * 1024 * 1024;
// Admission is global, not a queue per vault or per HTTP connection.
let activeRequests = 0;
const maxRequests = 2;
type Resource = FileHandle | Dir;

/** Request-owned resources close on disconnect, including while a test/IO hook waits. */
class ScanScope {
  readonly controller = new AbortController();
  private readonly resources = new Set<Resource>();
  private readonly closing = new Set<Promise<void>>();
  private readonly started: number;
  private readonly timer: ReturnType<typeof setTimeout>;
  private readonly onAbort: () => void;

  constructor(private readonly signal: AbortSignal, private readonly now: () => number) {
    this.started = now();
    this.onAbort = () => this.controller.abort(new ScanAborted());
    signal.addEventListener('abort', this.onAbort, { once: true });
    this.controller.signal.addEventListener('abort', () => {
      for (const resource of this.resources) void this.release(resource);
    }, { once: true });
    this.timer = setTimeout(() => this.controller.abort(new ScanDeadline()), 30_000);
    this.timer.unref();
    if (signal.aborted) this.onAbort();
  }
  check(): void {
    if (!this.controller.signal.aborted && this.now() - this.started >= 30_000) this.controller.abort(new ScanDeadline());
    if (this.controller.signal.aborted) throw this.controller.signal.reason;
  }
  own<T extends Resource>(resource: T): T {
    this.resources.add(resource);
    if (this.controller.signal.aborted) void this.release(resource);
    this.check();
    return resource;
  }
  async release(resource: Resource): Promise<void> {
    if (!this.resources.delete(resource)) return;
    const closing = resource.close().catch(() => {});
    this.closing.add(closing);
    try { await closing; } finally { this.closing.delete(closing); }
  }
  async wait<T>(work: Promise<T>): Promise<T> {
    this.check();
    // Remove each listener after its boundary; a shared never-settled race would
    // retain one promise reaction per chunk until the entire scan completed.
    const result = await new Promise<T>((resolve, reject) => {
      const signal = this.controller.signal;
      const abort = () => { signal.removeEventListener('abort', abort); reject(signal.reason); };
      signal.addEventListener('abort', abort, { once: true });
      work.then(value => { signal.removeEventListener('abort', abort); resolve(value); },
        error => { signal.removeEventListener('abort', abort); reject(error); });
      if (signal.aborted) abort();
    });
    this.check();
    return result;
  }
  async yield(): Promise<void> { await this.wait(yieldImmediate()); }
  async dispose(): Promise<void> {
    clearTimeout(this.timer);
    this.signal.removeEventListener('abort', this.onAbort);
    await Promise.all([...this.resources].map(resource => this.release(resource)));
    await Promise.all([...this.closing]);
  }
}

const comparePath = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
const compareFilename = (a: VaultFilenameHit, b: VaultFilenameHit): number =>
  (a.field === b.field ? 0 : a.field === 'name' ? -1 : 1) || b.score - a.score || comparePath(a.path, b.path);
const compareContent = (a: Pick<VaultContentHit, 'score' | 'path' | 'line'>, b: Pick<VaultContentHit, 'score' | 'path' | 'line'>): number =>
  b.score - a.score || comparePath(a.path, b.path) || a.line - b.line;

function retain<T>(hits: T[], hit: T, limit: number, compare: (a: T, b: T) => number): void {
  let low = 0;
  let high = hits.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (compare(hit, hits[middle]) < 0) high = middle;
    else low = middle + 1;
  }
  if (low >= limit) return;
  hits.splice(low, 0, hit);
  if (hits.length > limit) hits.pop();
}

/** Prepared targets avoid fuzzysort's unbounded string-target cache. No score cutoff. */
function match(query: string, text: string) { return fuzzysort.single(query, fuzzysort.prepare(text)); }

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
function snippets(text: string, indexes: readonly number[]): VaultSearchSnippet[] {
  const windows: Array<{ start: number; end: number }> = [];
  for (const index of indexes) {
    const start = Math.max(0, index - 16);
    const end = Math.min(text.length, index + 17);
    const last = windows.at(-1);
    if (last && start <= last.end) last.end = Math.max(last.end, end);
    else windows.push({ start, end });
  }
  // Slice only on grapheme boundaries, retaining original UTF-16 source offsets.
  let cursor = 0;
  for (const segment of graphemes.segment(text)) {
    while (cursor < windows.length && windows[cursor].end <= segment.index) cursor++;
    if (!windows[cursor]) break;
    const end = segment.index + segment.segment.length;
    for (let index = cursor; index < windows.length && windows[index].start < end; index++) {
      const window = windows[index];
      if (segment.index < window.start) window.start = segment.index;
      if (segment.index < window.end && end > window.end) window.end = end;
    }
  }
  const merged: Array<{ start: number; end: number }> = [];
  for (const window of windows) {
    const last = merged.at(-1);
    if (last && window.start <= last.end) last.end = Math.max(last.end, window.end);
    else merged.push(window);
  }
  return merged.map(({ start, end }) => ({
    text: text.slice(start, end), start, end,
    positions: indexes.filter(index => index >= start && index < end).map(index => index - start),
  }));
}

interface SourceLine { number: number; text: string; overlong: boolean }
/** Fixed byte buffers; validation continues even through skipped overlong lines. */
async function readLines(file: FileHandle, id: VaultId, scope: ScanScope, hooks: VaultSearchHooks,
  accept: (line: SourceLine) => boolean | void): Promise<void> {
  const buffer = Buffer.alloc(64 * 1024);
  const line = Buffer.alloc(lineLimit);
  const validation = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  let length = 0;
  let overlong = false;
  let number = 1;
  let afterCR = false;
  let offset = 0;
  const append = (part: Buffer) => {
    const remaining = lineLimit - length;
    part.copy(line, length, 0, Math.min(remaining, part.length));
    length += Math.min(remaining, part.length);
    if (part.length > remaining) overlong = true;
  };
  const emit = () => {
    // An overlong prefix can end inside a UTF-8 sequence; its clipped context is
    // presentation-only. The streaming validator still checks the entire source.
    const text = overlong ? new TextDecoder('utf-8', { ignoreBOM: true }).decode(line.subarray(0, length)) : decoder.decode(line.subarray(0, length));
    const keepGoing = accept({ number: number++, text, overlong });
    length = 0;
    overlong = false;
    return keepGoing !== false;
  };
  for (;;) {
    scope.check();
    const { bytesRead } = await file.read(buffer, 0, buffer.length, offset);
    scope.check();
    if (!bytesRead) break;
    const chunk = buffer.subarray(0, bytesRead);
    if (offset === 0) {
      let kind: Awaited<ReturnType<typeof fileTypeFromBuffer>>;
      try { kind = await fileTypeFromBuffer(chunk); } catch { /* A short signature need not be binary. */ }
      scope.check();
      if (kind) throw new BinaryFile();
    }
    if (chunk.includes(0)) throw new BinaryFile();
    try { validation.decode(chunk, { stream: true }); } catch { throw new InvalidEncoding(); }
    offset += bytesRead;
    let start = 0;
    for (let index = 0; index < bytesRead; index++) {
      const byte = chunk[index];
      if (afterCR) { afterCR = false; if (byte === 10) { start = index + 1; continue; } }
      if (byte !== 10 && byte !== 13) continue;
      append(chunk.subarray(start, index));
      if (!emit()) return;
      afterCR = byte === 13;
      start = index + 1;
      if ((number & 255) === 0) scope.check();
    }
    append(chunk.subarray(start));
    await scope.wait(hooks.onSearchChunk?.(id) ?? Promise.resolve());
    // This is a real event-loop turn, not just a resolved-promise/microtask yield.
    await scope.yield();
  }
  try { validation.decode(); } catch { throw new InvalidEncoding(); }
  if (length || overlong) emit();
}

function freshCoverage(): VaultSearchCoverage {
  return { complete: true, filesSearched: 0, skippedFiles: { binary: 0, invalidEncoding: 0, unreadable: 0, changed: 0 }, skippedLines: 0, timedOut: false };
}
function unavailable(): never { throw new VaultSearchError('search_unavailable'); }

export function createVaultSearch(boundary: SearchBoundary, hooks: VaultSearchHooks) {
  const scopes = new Set<ScanScope>();
  const tasks = new Set<Promise<unknown>>();
  let closed = false;

  async function run<T>(signal: AbortSignal, work: (scope: ScanScope) => Promise<T>): Promise<T> {
    if (closed || signal.aborted || activeRequests >= maxRequests) unavailable();
    activeRequests++;
    const scope = new ScanScope(signal, hooks.searchNow ?? performance.now.bind(performance));
    scopes.add(scope);
    try { scope.check(); return await work(scope); }
    finally { await scope.dispose(); scopes.delete(scope); activeRequests--; }
  }
  function track<T>(task: Promise<T>): Promise<T> {
    tasks.add(task);
    void task.then(() => tasks.delete(task), () => tasks.delete(task));
    return task;
  }
  async function verify(id: VaultId, file: FileHandle, expected: string, scope: ScanScope): Promise<void> {
    scope.check();
    if (boundary.version(await file.stat()) !== expected) throw new ChangedFile();
    let check: FileHandle;
    try { check = scope.own((await boundary.openRegular(id)).file); }
    catch (error) { scope.check(); throw error instanceof ScanDeadline ? error : new ChangedFile(); }
    try { if (boundary.version(await check.stat()) !== expected) throw new ChangedFile(); }
    finally { await scope.release(check); }
    scope.check();
  }

  async function walk(parent: VaultId, scope: ScanScope,
    coverage: VaultSearchCoverage, visit: (id: VaultId) => Promise<void>): Promise<void> {
    scope.check();
    const entries = scope.own(await opendir(await boundary.directoryPath(parent)));
    try {
      for (;;) {
        scope.check();
        const entry = await entries.read();
        scope.check();
        if (!entry) break;
        if (!isVaultComponent(entry.name)) continue;
        const id = [...parent, entry.name];
        try {
          if (entry.isDirectory()) {
            await walk(id, scope, coverage, visit);
          } else if (entry.isFile()) await visit(id);
        } catch (error) {
          scope.check();
          if (error instanceof ScanDeadline || error instanceof ScanAborted) throw error;
          coverage.skippedFiles.unreadable++;
          coverage.complete = false;
        }
        await scope.yield();
      }
    } finally { await scope.release(entries); }
  }

  async function search(input: VaultSearchRequest, signal: AbortSignal): Promise<VaultSearchResponse> {
    const parsed = parseVaultSearchRequest(input);
    if (!parsed) throw new VaultSearchError('invalid_request');
    const query = normalizeSearchQuery(parsed.query);
    const coverage = freshCoverage();
    const counts = { matches: 0, files: 0 };
    const filenameHits: VaultFilenameHit[] = [];
    const contentHits: VaultContentHit[] = [];
    const result = (): VaultSearchResponse => {
      const hits = parsed.mode === 'filename' ? filenameHits : contentHits;
      // Count limits also have a byte ceiling for long paths/dispersed evidence.
      let bytes = 1024;
      let retained = 0;
      for (const hit of hits) {
        bytes += Buffer.byteLength(JSON.stringify(hit)) + 1;
        if (bytes > responseLimit) break;
        retained++;
      }
      hits.length = retained;
      const summary = { counts, coverage, limited: hits.length < counts.matches };
      return parsed.mode === 'filename' ? { ...summary, mode: 'filename', hits: filenameHits } : { ...summary, mode: 'content', hits: contentHits };
    };
    if (!query) return result();
    return run(signal, async scope => {
      try {
        await walk([], scope, coverage, async id => {
          let file: FileHandle | undefined;
          let expected: string | undefined;
          try {
            const name = id[id.length - 1];
            const path = id.join('/');
            file = scope.own((await boundary.openRegular(id)).file);
            const stats = await file.stat();
            if (!stats.isFile()) throw new ChangedFile();
            expected = boundary.version(stats);
            await scope.wait(hooks.onSearchFileOpened?.(id, file) ?? Promise.resolve());
            if (parsed.mode === 'filename') {
              const byName = match(query, name);
              const matched = byName ?? match(query, path);
              const hit: VaultFilenameHit | undefined = matched ? { id, name, path, field: byName ? 'name' : 'path', positions: [...matched.indexes], score: matched.score } : undefined;
              await verify(id, file, expected, scope);
              coverage.filesSearched++;
              if (hit) { counts.matches++; counts.files++; retain(filenameHits, hit, 50, compareFilename); }
              return;
            }
            const provisional: VaultContentHit[] = [];
            let matches = 0;
            let skippedLines = 0;
            await readLines(file, id, scope, hooks, line => {
              if (line.overlong) { skippedLines++; return; }
              const matched = match(query, line.text);
              if (!matched) return;
              matches++;
              const rank = { score: matched.score, path, line: line.number };
              const worst = provisional.at(-1);
              if (provisional.length === 100 && worst && compareContent(rank, worst) >= 0) return;
              retain(provisional, { ...rank, id, name, version: expected ?? '', snippets: snippets(line.text, matched.indexes) }, 100, compareContent);
            });
            await verify(id, file, expected, scope);
            coverage.filesSearched++;
            coverage.skippedLines += skippedLines;
            if (skippedLines) coverage.complete = false;
            counts.matches += matches;
            if (matches) counts.files++;
            for (const hit of provisional) retain(contentHits, hit, 100, compareContent);
          } catch (error) {
            scope.check();
            // Encoding/binary errors also discard all provisional matches. Check
            // the descriptor/path first so a concurrent mutation is not mislabelled.
            if (file && expected) {
              try { await verify(id, file, expected, scope); }
              catch (failure) { scope.check(); error = failure; }
            }
            const reason = error instanceof ChangedFile ? 'changed' : error instanceof BinaryFile ? 'binary' : error instanceof InvalidEncoding ? 'invalidEncoding' : 'unreadable';
            coverage.skippedFiles[reason]++;
            if (reason !== 'binary') coverage.complete = false;
          } finally { if (file) await scope.release(file); }
        });
      } catch (error) {
        if (error instanceof ScanDeadline) { coverage.complete = false; coverage.timedOut = true; }
        else unavailable();
      }
      return result();
    }).catch(() => unavailable());
  }

  async function context(input: VaultSearchContextRequest, signal: AbortSignal): Promise<VaultSearchContextResponse> {
    const parsed = parseVaultSearchContextRequest(input);
    if (!parsed) throw new VaultSearchError('invalid_request');
    return run(signal, async scope => {
      let file: FileHandle;
      try { file = scope.own((await boundary.openRegular(parsed.id)).file); }
      catch { scope.check(); throw new VaultSearchError('search_context_changed'); }
      try {
        if (boundary.version(await file.stat()) !== parsed.version) throw new ChangedFile();
        await scope.wait(hooks.onSearchFileOpened?.(parsed.id, file) ?? Promise.resolve());
        const lines: VaultSearchContextLine[] = [];
        let truncated = false;
        let targetFound = false;
        await readLines(file, parsed.id, scope, hooks, line => {
          if (line.number < Math.max(1, parsed.line - 3)) return;
          if (line.number > parsed.line + 3) return false;
          const target = line.number === parsed.line;
          const matched = target && !line.overlong ? match(normalizeSearchQuery(parsed.query), line.text) : null;
          if (target && !matched) throw new ChangedFile();
          if (target) targetFound = true;
          let text = line.text;
          if (!target && text.length > 4096) {
            const boundary = graphemes.segment(text).containing(4095);
            text = text.slice(0, boundary?.index ?? 4096);
            truncated = true;
          }
          if (line.overlong) truncated = true;
          lines.push({ number: line.number, text, positions: matched ? [...matched.indexes] : [] });
        });
        await verify(parsed.id, file, parsed.version, scope);
        if (!targetFound) throw new ChangedFile();
        return { id: parsed.id, name: parsed.id[parsed.id.length - 1], version: parsed.version, targetLine: parsed.line, startLine: lines[0].number, lines, truncated };
      } catch (error) {
        scope.check();
        if (error instanceof ChangedFile || error instanceof BinaryFile || error instanceof InvalidEncoding) throw new VaultSearchError('search_context_changed');
        throw error;
      } finally { await scope.release(file); }
    }).catch(error => { if (error instanceof VaultSearchError) throw error; return unavailable(); });
  }

  return {
    search: (input: VaultSearchRequest, signal: AbortSignal) => track(search(input, signal)),
    context: (input: VaultSearchContextRequest, signal: AbortSignal) => track(context(input, signal)),
    async close() {
      closed = true;
      for (const scope of scopes) scope.controller.abort(new ScanAborted());
      await Promise.allSettled([...tasks]);
    },
  };
}
