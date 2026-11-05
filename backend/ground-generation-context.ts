import type { Stats } from 'node:fs';
import { lstat, opendir } from 'node:fs/promises';
import { isVaultComponent } from './contract';
import { openSafeRoot } from './safe-fs';
import type { GroundGenerationConfig } from './ground-generation-config';
import type { GroundGenerationState } from './ground-generation-state';
import { GroundGenerationError } from './ground-generation-error';

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
  const root = await openSafeRoot(directory);
  const isTranscript = (id: readonly string[]) => options.state.isTranscript(directory, id) ||
    (root.path !== directory && options.state.isTranscript(root.path, id));
  const check = async () => {
    checkAbort();
    try { await root.resolve([], 'directory'); } catch { throw new GroundGenerationError('conflict'); }
  };
  const excluded = (id: readonly string[]) => [['03_Resources', 'Memory-Loop'], options.transcriptDirectory].some(prefix => prefix.every((part, index) => id[index] === part));
  const candidates: Candidate[] = [];
  const after = options.now - limits.lookbackDays * 86400000;
  let visited = 0; let selected = 0; let status: 'failed' | 'cancelled' | 'ready' = 'failed';
  async function walk(parent: string[]): Promise<void> {
    if (parent.length > 32) throw new GroundGenerationError('configuration');
    const entries = await opendir(await root.resolve(parent, 'directory'), { bufferSize: 32 });
    for await (const entry of entries) {
      visited++;
      await check();
      if (!isVaultComponent(entry.name)) continue;
      const id = [...parent, entry.name]; if (excluded(id)) continue;
      if (entry.isDirectory()) {
        await walk(id);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        const file = await root.openFile(id, 'read');
        try {
          const stat = await file.stat();
          if (!stat.isFile() || stat.mtimeMs < after || stat.mtimeMs > options.now) continue;
          checkAbort(); const transcript = isTranscript(id); checkAbort();
          if (transcript) continue;
          candidates.push({ id, stat });
          candidates.sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs || (a.id.join('/') < b.id.join('/') ? -1 : 1));
          if (candidates.length > limits.maxNotes) candidates.pop();
        } finally { await file.close(); }
      }
    }
  }
  try {
    await check(); await walk([]); await check();
    const result: GenerationExcerpt[] = []; let remaining = limits.maxTotalBytes;
    for (const candidate of candidates) {
      if (!remaining) break;
      checkAbort(); const transcript = isTranscript(candidate.id); checkAbort();
      if (transcript) continue;
      const held: Array<{ id: string[]; stat: Stats }> = [];
      try {
        for (let index = 1; index < candidate.id.length; index++) {
          const id = candidate.id.slice(0, index);
          held.push({ id, stat: await lstat(await root.resolve(id, 'directory')) });
        }
        const file = await root.openFile(candidate.id, 'read');
        try {
          const before = await file.stat();
          if (!before.isFile() || fingerprint(before) !== fingerprint(candidate.stat)) continue;
          const count = Math.min(before.size, limits.maxNoteBytes, remaining); const bytes = Buffer.alloc(count);
          let offset = 0;
          while (offset < count) {
            if (signal.aborted) throw new Error('context stopped');
            const read = await file.read(bytes, offset, count - offset, offset); if (!read.bytesRead) break; offset += read.bytesRead;
          }
          await check();
          if (offset !== count || fingerprint(before) !== fingerprint(await file.stat()) || fingerprint(before) !== fingerprint(await lstat(await root.resolve(candidate.id, 'file')))) continue;
          let stable = true;
          for (const node of held) if (!same(node.stat, await lstat(await root.resolve(node.id, 'directory')))) stable = false;
          if (!stable) continue;
          // A bounded prefix may end inside a code point; retain only complete UTF-8 text.
          const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes, { stream: count < before.size });
          if (!text.trim()) continue;
          remaining -= Buffer.byteLength(text);
          result.push({ noteId: candidate.id, modifiedAt: new Date(before.mtimeMs).toISOString(), text });
        } finally { await file.close(); }
      } catch { if (signal.aborted) throw new Error('context stopped'); /* Skip a changed/unreadable candidate, never widen the search. */ }
    }
    await check(); selected = result.length; status = 'ready'; return result;
  } catch (error) {
    if (signal.aborted) status = 'cancelled';
    throw error;
  } finally {
    console.info('ground_generation_context_outcome', { status, scanned: visited, selected, durationMs: Math.max(0, Date.now() - started) });
  }
}
