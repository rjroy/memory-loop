import { createHash } from 'node:crypto';
import { ThinkStateError, type StoredTranscript, type StoredTranscriptEntry, type TranscriptAppendIdentity, type TranscriptStateStore } from './state';
import { OwnedTranscriptFile, TranscriptError, TranscriptNamespace, type TranscriptBytes, type TranscriptIO } from './transcript-file';
import { transcriptEntryIdentity, type TranscriptEntry } from './transcript-format';

/** One registered transcript: SQLite owns recovery bytes; the existing file writer owns safe append I/O. */
export class RegisteredTranscript {
  private loaded = false;
  private record: StoredTranscript | null = null;
  private file?: OwnedTranscriptFile;
  private source?: TranscriptBytes;
  private mappedNamespace?: TranscriptNamespace;

  constructor(private readonly store: TranscriptStateStore, private readonly vault: string,
    private readonly conversationId: string, private readonly defaults: TranscriptNamespace, private readonly io?: TranscriptIO) {}

  private storage<T>(operation: () => T): T {
    try { return operation(); }
    catch (error) {
      // A commit acknowledgement can fail after COMMIT. Reload facts and reverify the owned prefix,
      // rather than replay an append using an old in-memory checkpoint.
      this.loaded = false; this.record = null; this.file = undefined; this.source = undefined;
      throw new TranscriptError(error instanceof ThinkStateError && error.code === 'conflict' ? 'conflict' : 'io_unavailable');
    }
  }
  load(): StoredTranscript | null {
    if (!this.loaded) {
      this.record = this.storage(() => this.store.load(this.conversationId, this.vault));
      this.loaded = true;
    }
    return this.record;
  }
  private reload(): StoredTranscript {
    const record = this.storage(() => this.store.load(this.conversationId, this.vault));
    if (!record) throw new TranscriptError('conflict');
    this.record = record; this.loaded = true;
    return record;
  }
  entry(id: string): StoredTranscriptEntry | null { return this.storage(() => this.store.entry(this.conversationId, id)); }
  latest(semantic: string): StoredTranscriptEntry | null { return this.storage(() => this.store.latest(this.conversationId, semantic)); }
  get noteId(): string[] | undefined { return this.record ? [...this.record.noteId] : undefined; }

  private async namespace(): Promise<TranscriptNamespace> {
    const record = this.load();
    if (!record) throw new TranscriptError('io_unavailable');
    const components = record.noteId.slice(0, -1);
    let namespace = this.defaults;
    if (JSON.stringify(components) !== JSON.stringify(namespace.components)) {
      this.mappedNamespace ??= new TranscriptNamespace(this.vault, components.join('/'), this.io);
      namespace = this.mappedNamespace;
      if (JSON.stringify(namespace.components) !== JSON.stringify(components)) throw new TranscriptError('conflict');
    }
    await namespace.prepare(false);
    await namespace.validate();
    if (JSON.stringify(namespace.identities()) !== JSON.stringify(record.namespace)) throw new TranscriptError('conflict');
    return namespace;
  }
  private async ownedFile(): Promise<OwnedTranscriptFile> {
    const namespace = await this.namespace();
    const record = this.load();
    if (!record) throw new TranscriptError('io_unavailable');
    if (!this.file) this.file = new OwnedTranscriptFile(namespace, `think-${this.conversationId}.md`, {
      ...(record.file ? { checkpoint: record.file } : {}),
      acquired: checkpoint => {
        this.storage(() => this.store.acquire(this.conversationId, checkpoint));
        this.reload();
      },
    });
    return this.file;
  }
  private async pendingSource(stopping: () => boolean): Promise<TranscriptBytes> {
    if (this.source) return this.source;
    const pending = this.load()?.pending;
    if (!pending || pending.state !== 'ready' || !pending.sha256) throw new TranscriptError('content_gap');
    const store = this.store;
    const id = this.conversationId;
    const storage = <T>(operation: () => T) => this.storage(operation);
    const source: TranscriptBytes = { length: pending.length, async *chunks(offset) {
      if (!Number.isSafeInteger(offset) || offset < 0 || offset > pending.length) throw new TranscriptError('content_gap');
      for (let index = 0; index < pending.chunks; index++) {
        if (stopping()) throw new TranscriptError('io_unavailable');
        const bytes = storage(() => store.chunk(id, index));
        if (!bytes) throw new TranscriptError('content_gap');
        if (offset >= bytes.length) { offset -= bytes.length; continue; }
        yield bytes.subarray(offset); offset = 0;
      }
      if (offset) throw new TranscriptError('content_gap');
    } };
    // Verify persisted chunks before any file effect, with bounded memory even for a large AI entry.
    let length = 0;
    const hash = createHash('sha256');
    for await (const bytes of source.chunks(0)) { length += bytes.length; hash.update(bytes); }
    if (length !== pending.length || hash.digest('hex') !== pending.sha256 ||
        this.storage(() => store.chunk(id, pending.chunks)) !== null) throw new TranscriptError('content_gap');
    this.source = source;
    return source;
  }
  private async finish(stopping: () => boolean): Promise<void> {
    const pending = this.load()?.pending;
    if (!pending) return;
    const source = await this.pendingSource(stopping);
    const file = await this.ownedFile();
    await file.append(source, stopping);
    this.storage(() => this.store.confirm(this.conversationId, pending.id, file.confirmedCheckpoint()));
    this.reload(); this.source = undefined;
  }
  /** No native history is needed to finish a ready append or verify its confirmed prefix. */
  async recover(stopping: () => boolean): Promise<StoredTranscript | null> {
    const record = this.load();
    if (!record) return null;
    if (record.pending?.state === 'ready') await this.finish(stopping);
    else if (record.file && !this.file) await (await this.ownedFile()).checkpoint(stopping);
    return this.load();
  }
  async append(source: TranscriptBytes, createdAt: number, entry: TranscriptEntry | null, stopping: () => boolean): Promise<void> {
    if (stopping()) throw new TranscriptError('io_unavailable');
    if (!this.load()) {
      await this.defaults.prepare(); await this.defaults.validate();
      this.storage(() => this.store.intent(this.conversationId, this.vault,
        [...this.defaults.components, `think-${this.conversationId}.md`], createdAt, this.defaults.identities()));
      this.reload();
    }
    if (this.load()?.pending?.state === 'ready') await this.finish(stopping);
    const sourceIdentity = entry ? transcriptEntryIdentity(entry) : createHash('sha256').update(JSON.stringify(['header', this.conversationId, createdAt])).digest('hex');
    if (!entry && this.load()?.file?.offset) return;
    if (entry) {
      const confirmed = this.entry(entry.id);
      if (confirmed) {
        if (confirmed.sourceIdentity !== sourceIdentity) throw new TranscriptError('conflict');
        return;
      }
    }
    const append: TranscriptAppendIdentity = { id: entry?.id ?? 'header', semantic: entry?.semantic ?? 'header',
      sourceIdentity, header: !entry, length: source.length };
    if (entry && (entry.metadata.kind === 'user' || entry.metadata.kind === 'form-reply')) {
      if (entry.body?.kind !== 'canonical') throw new TranscriptError('content_gap');
      const kind = entry.metadata.kind === 'user' ? 'send' : 'form-reply';
      append.original = { kind, commandId: entry.id.slice(kind === 'send' ? 'user:'.length : 'form-reply:'.length),
        sha256: entry.body.sha256, length: entry.body.through };
    }
    this.storage(() => this.store.begin(this.conversationId, append));
    let length = 0;
    let index = 0;
    const hash = createHash('sha256');
    for await (const bytes of source.chunks(0)) {
      if (stopping()) throw new TranscriptError('io_unavailable');
      for (let at = 0; at < bytes.length; at += 65536) {
        const chunk = bytes.subarray(at, at + 65536);
        length += chunk.length;
        if (length > source.length) throw new TranscriptError('content_gap');
        this.storage(() => this.store.stage(this.conversationId, index++, chunk)); hash.update(chunk);
      }
    }
    if (length !== source.length) throw new TranscriptError('content_gap');
    this.storage(() => this.store.seal(this.conversationId, hash.digest('hex')));
    this.reload();
    await this.finish(stopping);
  }
  async checkpoint(stopping: () => boolean): Promise<void> {
    await this.recover(stopping);
    if (this.load()?.file) await (await this.ownedFile()).checkpoint(stopping);
  }
  async close(): Promise<void> { await this.mappedNamespace?.close(); }
}
