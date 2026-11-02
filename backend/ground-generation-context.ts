import { constants, type Stats } from 'node:fs';
import { lstat, open, opendir, realpath, type FileHandle } from 'node:fs/promises';
import { isVaultComponent } from './contract';
import type { GroundGenerationConfig } from './ground-generation-config';
import type { GroundGenerationState } from './ground-generation-state';
import { GroundGenerationError } from './ground-generation-error';

const directories = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;
const files = constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW;
const path = (handle: FileHandle, name?: string) => `/proc/self/fd/${handle.fd}${name ? `/${name}` : ''}`;
const same = (a: Stats, b: Stats) => a.dev === b.dev && a.ino === b.ino;
const fingerprint = (s: Stats) => JSON.stringify([s.dev, s.ino, s.size, s.mtimeMs, s.ctimeMs, s.nlink]);
interface Candidate { id: string[]; stat: Stats }
export interface GenerationExcerpt { noteId: string[]; modifiedAt: string; text: string }

/** Traverse the vault asynchronously while bounding retained candidates and payloads. */
export async function recentGenerationContext(options: {
  directory: string; transcriptDirectory: readonly string[]; limits: GroundGenerationConfig['context'];
  state: Pick<GroundGenerationState, 'isTranscript'>; now: number; signal: AbortSignal;
}): Promise<GenerationExcerpt[]> {
  const { directory, limits, signal } = options;
  const started = Date.now();
  const checkAbort = () => { if (signal.aborted) throw new Error('context stopped'); };
  checkAbort();
  if (await realpath(directory) !== directory) throw new GroundGenerationError('conflict');
  const root = await open(directory, directories);
  let original: Stats;
  try { original = await root.stat(); } catch (error) { await root.close(); throw error; }
  const check = async () => {
    checkAbort();
    if (!same(original, await lstat(directory)) || !same(original, await root.stat())) throw new GroundGenerationError('conflict');
  };
  const excluded = (id: readonly string[]) => [['03_Resources', 'Memory-Loop'], options.transcriptDirectory].some(prefix => prefix.every((part, index) => id[index] === part));
  const candidates: Candidate[] = [];
  const after = options.now - limits.lookbackDays * 86400000;
  let visited = 0; let selected = 0; let status: 'failed' | 'cancelled' | 'ready' = 'failed';
  async function walk(handle: FileHandle, parent: string[]): Promise<void> {
    if (parent.length > 32) throw new GroundGenerationError('configuration');
    const entries = await opendir(path(handle), { bufferSize: 32 });
    for await (const entry of entries) {
      visited++;
      await check();
      if (!isVaultComponent(entry.name)) continue;
      const id = [...parent, entry.name]; if (excluded(id)) continue;
      if (entry.isDirectory()) {
        const child = await open(path(handle, entry.name), directories);
        try { await walk(child, id); } finally { await child.close(); }
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        const file = await open(path(handle, entry.name), files);
        try {
          const stat = await file.stat();
          if (!stat.isFile() || stat.nlink !== 1 || stat.mtimeMs < after || stat.mtimeMs > options.now) continue;
          checkAbort(); const transcript = options.state.isTranscript(directory, id); checkAbort();
          if (transcript) continue;
          candidates.push({ id, stat });
          candidates.sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs || (a.id.join('/') < b.id.join('/') ? -1 : 1));
          if (candidates.length > limits.maxNotes) candidates.pop();
        } finally { await file.close(); }
      }
    }
  }
  try {
    await check(); await walk(root, []); await check();
    const result: GenerationExcerpt[] = []; let remaining = limits.maxTotalBytes;
    for (const candidate of candidates) {
      if (!remaining) break;
      checkAbort(); const transcript = options.state.isTranscript(directory, candidate.id); checkAbort();
      if (transcript) continue;
      const held: Array<{ handle: FileHandle; named: string; stat: Stats }> = [];
      try {
        let parent = root;
        for (const component of candidate.id.slice(0, -1)) {
          const named = path(parent, component); const handle = await open(named, directories);
          try { held.push({ handle, named, stat: await handle.stat() }); }
          catch (error) { await handle.close(); throw error; }
          parent = handle;
        }
        const named = path(parent, candidate.id[candidate.id.length - 1]); const file = await open(named, files);
        try {
          const before = await file.stat();
          if (!before.isFile() || before.nlink !== 1 || fingerprint(before) !== fingerprint(candidate.stat)) continue;
          const count = Math.min(before.size, limits.maxNoteBytes, remaining); const bytes = Buffer.alloc(count);
          let offset = 0;
          while (offset < count) {
            if (signal.aborted) throw new Error('context stopped');
            const read = await file.read(bytes, offset, count - offset, offset); if (!read.bytesRead) break; offset += read.bytesRead;
          }
          await check();
          if (offset !== count || fingerprint(before) !== fingerprint(await file.stat()) || fingerprint(before) !== fingerprint(await lstat(named))) continue;
          let stable = true;
          for (const node of held) if (!same(node.stat, await node.handle.stat()) || !same(node.stat, await lstat(node.named))) stable = false;
          if (!stable) continue;
          // A bounded prefix may end inside a code point; retain only complete UTF-8 text.
          const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes, { stream: count < before.size });
          if (!text.trim()) continue;
          remaining -= Buffer.byteLength(text);
          result.push({ noteId: candidate.id, modifiedAt: new Date(before.mtimeMs).toISOString(), text });
        } finally { await file.close(); }
      } catch { if (signal.aborted) throw new Error('context stopped'); /* Skip a changed/unreadable candidate, never widen the search. */ }
      finally { for (const node of held.reverse()) await node.handle.close(); }
    }
    await check(); selected = result.length; status = 'ready'; return result;
  } catch (error) {
    if (signal.aborted) status = 'cancelled';
    throw error;
  } finally {
    console.info('ground_generation_context_outcome', { status, scanned: visited, selected, durationMs: Math.max(0, Date.now() - started) });
    await root.close();
  }
}
