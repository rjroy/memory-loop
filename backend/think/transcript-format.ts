import { createHash } from 'node:crypto';
import type { BodyReader, BodyRef } from './body-store';
import type { ProjectionEntry, ThinkContentReader, ToolCategory } from './projection';
import { TranscriptError, type TranscriptBytes } from './transcript-file';

const opaque = /^[A-Za-z0-9_-]{1,256}$/;
function id(value: string): string { if (!opaque.test(value)) throw new TranscriptError('content_gap'); return value; }
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const labels: Record<ToolCategory, string> = { 'file-read': 'File read', 'file-write': 'File write', shell: 'Shell', search: 'Search', subagent: 'Subagent', custom: 'Custom tool' };
export interface TranscriptEntry {
  id: string;
  semantic: string;
  role: 'User' | 'AI' | 'Tool' | 'Run';
  at: string;
  metadata: Record<string, string | number>;
  body?: BodyRef;
  summary?: string;
}
/** Immutable source facts, not observation time, transport identity or the chosen framing. */
export function transcriptEntryIdentity(entry: TranscriptEntry): string {
  const metadata = Object.fromEntries(Object.entries(entry.metadata).filter(([key]) => !['at', 'time_basis', 'run_id', 'supersedes_entry_id'].includes(key)));
  const body = entry.body;
  return digest(JSON.stringify([entry.id, entry.role, metadata, entry.summary ?? null,
    body ? [body.key.conversationId, body.kind, body.through, body.kind === 'canonical' ? body.sha256 : body.generation] : null]));
}
export function entryFor(entry: ProjectionEntry, observedAt: number, partial?: 'monitoring-loss' | 'terminal'): TranscriptEntry | undefined {
  const time = entry.sourceTime;
  if (time !== undefined && (!Number.isFinite(time) || Math.abs(time) > 8640000000000000)) throw new TranscriptError('content_gap');
  const at = new Date(time === undefined ? observedAt : time).toISOString();
  const metadata: TranscriptEntry['metadata'] = { at, time_basis: time === undefined ? 'observed' : 'source' };
  if (entry.runId) metadata.run_id = id(entry.runId);
  switch (entry.kind) {
    case 'original': {
      const semantic = `user:${id(entry.clientCommandId)}`;
      return { id: semantic, semantic, role: 'User', at, body: entry.body, metadata: { ...metadata, kind: 'user', message_id: id(entry.messageId), delivery: 'registered' } };
    }
    case 'form-reply': {
      const semantic = `form-reply:${id(entry.clientCommandId)}`;
      return { id: semantic, semantic, role: 'User', at, body: entry.body, metadata: { ...metadata, kind: 'form-reply', decision_id: id(entry.decisionId), delivery: 'registered' } };
    }
    case 'original-capture': {
      if (entry.state !== 'failed') return undefined;
      const semantic = `capture-gap:${id(entry.clientCommandId)}`;
      return { id: semantic, semantic, role: 'Run', at,
        metadata: { ...metadata, kind: 'content-gap', command_kind: entry.commandKind, command_id: id(entry.clientCommandId), capture_state: 'failed' },
        summary: entry.commandKind === 'form-reply' ? 'Original form reply unavailable; transcript has a gap.' : 'Original user input unavailable; transcript has a gap.' };
    }
    case 'assistant-text': {
      if (entry.closure !== 'closed' && !partial) return undefined;
      if (!Number.isSafeInteger(entry.ordinal) || entry.ordinal < 0) throw new TranscriptError('content_gap');
      const semantic = `ai:${id(entry.messageId)}:${entry.ordinal}`;
      if (entry.closure === 'closed' && entry.body.kind !== 'canonical' ||
          entry.body.kind === 'canonical' && !/^[a-f0-9]{64}$/.test(entry.body.sha256)) throw new TranscriptError('content_gap');
      // Public native message ID + text-only ordinal are supplied by the verified projection.
      // Canonical bytes survive cache/transport replacement; observed previews do not claim that identity.
      const version = digest(JSON.stringify(entry.closure === 'closed' && entry.body.kind === 'canonical'
        ? [entry.body.key.conversationId, 'canonical', entry.body.through, entry.body.sha256]
        : [entry.body.generation, entry.body.through, 'observed-partial', partial]));
      return { id: `${semantic}:${version}`, semantic, role: 'AI', at, body: entry.body,
        metadata: { ...metadata, kind: 'assistant-text', message_id: id(entry.messageId), ordinal: entry.ordinal,
          capture: entry.closure === 'closed' ? 'canonical' : 'observed-partial', completeness: entry.capture, ...(partial ? { boundary: partial } : {}) } };
    }
    case 'tool': {
      const semantic = `tool:${id(entry.messageId)}:${id(entry.toolCallId)}`;
      const label = labels[entry.category];
      if (!label || !['started', 'completed', 'failed', 'interrupted', 'unknown'].includes(entry.state)) throw new TranscriptError('content_gap');
      const duration = entry.durationMs;
      if (duration !== undefined && (!Number.isFinite(duration) || duration < 0)) throw new TranscriptError('content_gap');
      return { id: `${semantic}:${entry.state}`, semantic, role: 'Tool', at,
        metadata: { ...metadata, kind: 'tool', message_id: id(entry.messageId), tool_id: id(entry.toolCallId), category: entry.category, state: entry.state, ...(duration === undefined ? {} : { duration_ms: duration }) },
        summary: `${label} — ${entry.state}${duration === undefined ? '' : ` (${duration} ms)`}.` };
    }
    case 'lifecycle': {
      const semantic = `run:${id(entry.clientCommandId)}:${entry.state}`;
      return { id: semantic, semantic, role: 'Run', at, metadata: { ...metadata, kind: 'run', command_kind: entry.commandKind, command_id: id(entry.clientCommandId), state: entry.state }, summary: `Run — ${entry.state}.` };
    }
    case 'compaction': {
      if (!['started', 'ended', 'failed'].includes(entry.phase) || !Number.isSafeInteger(entry.sourceSequence) || entry.sourceSequence < 0) throw new TranscriptError('content_gap');
      const semantic = `compaction:${id(entry.sessionId)}:${id(entry.eventId)}`;
      return { id: semantic, semantic, role: 'Run', at,
        metadata: { ...metadata, kind: 'compaction', evidence: 'observed', session_id: id(entry.sessionId), event_id: id(entry.eventId), phase: entry.phase, source_sequence: entry.sourceSequence },
        summary: entry.phase === 'ended' ? 'Context compacted.' : `Context compaction — ${entry.phase}.` };
    }
  }
}

type Segment = { kind: 'bytes'; bytes: Uint8Array } | { kind: 'ticks'; length: number } | { kind: 'body'; reader: BodyReader; length: number };
function segmentSize(segment: Segment): number { return segment.kind === 'bytes' ? segment.bytes.length : segment.length; }
const bytes = (value: string): Segment => ({ kind: 'bytes', bytes: Buffer.from(value, 'utf8') });
function serialized(segments: Segment[]): TranscriptBytes {
  const length = segments.reduce((sum, segment) => sum + segmentSize(segment), 0);
  if (!Number.isSafeInteger(length)) throw new TranscriptError('content_gap');
  return { length, async *chunks(offset) {
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > length) throw new TranscriptError('content_gap');
    for (const segment of segments) {
      const size = segmentSize(segment);
      if (offset >= size) { offset -= size; continue; }
      for (let at = offset; at < size;) {
        const count = Math.min(65536, size - at);
        const value = segment.kind === 'bytes' ? segment.bytes.subarray(at, at + count)
          : segment.kind === 'ticks' ? Buffer.alloc(count, 96) : await segment.reader.read(at, count);
        if (value.length !== count) throw new TranscriptError('content_gap');
        yield value; at += count;
      }
      offset = 0;
    }
  } };
}
export function transcriptHeader(conversationId: string, at: number): TranscriptBytes {
  return serialized([bytes(`---\nmemory_loop_transcript: 1\nconversation_id: "${id(conversationId)}"\ncreated_at: "${new Date(at).toISOString()}"\n---\n\n# Think conversation\n\n`)]);
}
export interface PreparedTranscriptEntry { source: TranscriptBytes; close(): Promise<void> }
/** Scan then serialize the same pinned immutable prefix, never a whole body/conversation string. */
export async function prepareTranscriptEntry(entry: TranscriptEntry, content: ThinkContentReader, stopping: () => boolean = () => false): Promise<PreparedTranscriptEntry> {
  let reader: BodyReader | undefined;
  try {
    let longest = 2;
    let run = 0;
    if (entry.body) {
      const bodyHash = createHash('sha256');
      if (stopping()) throw new TranscriptError('io_unavailable');
      reader = await content.open(entry.body);
      for (let offset = 0; offset < entry.body.through;) {
        if (stopping()) throw new TranscriptError('io_unavailable');
        const count = Math.min(65536, entry.body.through - offset);
        const value = await reader.read(offset, count);
        if (value.length !== count) throw new TranscriptError('content_gap');
        bodyHash.update(value);
        for (const byte of value) { run = byte === 96 ? run + 1 : 0; longest = Math.max(longest, run); }
        offset += count;
      }
      if (entry.body.kind === 'canonical' && bodyHash.digest('hex') !== entry.body.sha256) throw new TranscriptError('content_gap');
    }
    const metadata = { entry_id: entry.id, ...entry.metadata, ...(entry.body ? { body_utf8_bytes: entry.body.through } : {}) };
    const replacement = 'supersedes_entry_id' in metadata ? ' (replacement)' : '';
    const segments = [bytes(`## ${entry.role}${replacement} — ${entry.at}\n\n<!-- memory-loop-entry ${JSON.stringify(metadata)} -->\n`)];
    if (entry.body && reader) segments.push({ kind: 'ticks', length: longest + 1 }, bytes('text\n'), { kind: 'body', reader, length: entry.body.through }, bytes('\n'), { kind: 'ticks', length: longest + 1 }, bytes('\n'));
    else segments.push(bytes(`${entry.summary ?? 'Outcome unavailable.'}\n`));
    segments.push(bytes(`<!-- memory-loop-end ${JSON.stringify({ entry_id: entry.id })} -->\n\n`));
    const pinned = reader;
    return { source: serialized(segments), async close() { await pinned?.close(); } };
  } catch (error) { await reader?.close(); throw error; }
}
