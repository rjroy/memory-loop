import { AttachmentUploadError, readAttachmentLimits, uploadAttachment } from './api';
import type { AttachmentFailure, AttachmentProgress, AttachmentResult } from './api';

export interface AttachmentPick {
  key: number; name: string; size: number; file: File | null;
  state: 'waiting' | 'empty' | 'too-large' | 'uploading' | 'finishing' | 'uploaded' | 'failed' | 'uncertain';
  progress: AttachmentProgress | null; issue: AttachmentFailure | null; result: AttachmentResult | null;
  refreshIssue: boolean; checked: boolean;
}
interface UploadState {
  picks: AttachmentPick[]; maxFileBytes: number | null; limitsLoading: boolean; limitsIssue: boolean;
  busy: boolean; submitted: boolean; position: number; total: number; notice: string; feedback: number | null;
}
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} ${bytes === 1 ? 'byte' : 'bytes'}`;
  const units = ['KiB', 'MiB', 'GiB', 'TiB'];
  let size = bytes / 1024, index = 0;
  while (size >= 1024 && index < units.length - 1) { size /= 1024; index++; }
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(size)} ${units[index]}`;
}

/** A volatile Recall-owned selection and one sequential batch, not a job registry. */
export function createAttachmentUploads() {
  let state: UploadState = { picks: [], maxFileBytes: null, limitsLoading: false, limitsIssue: false, busy: false, submitted: false, position: 0, total: 0, notice: '', feedback: null };
  const listeners = new Set<() => void>();
  let nextKey = 0, generation = 0;
  let active: { key: number; controller: AbortController } | null = null;
  const publish = (patch: Partial<UploadState>) => { state = { ...state, ...patch }; listeners.forEach(listener => listener()); };
  const update = (key: number, patch: Partial<AttachmentPick>) => publish({ picks: state.picks.map(pick => pick.key === key ? { ...pick, ...patch } : pick) });
  const eligible = (pick: AttachmentPick) => pick.file !== null && pick.size > 0 && state.maxFileBytes !== null && pick.size <= state.maxFileBytes;
  const retryable = (pick: AttachmentPick) => pick.state === 'failed' && pick.issue === 'upload_unavailable';
  const deactivate = () => {
    if (!active && !state.busy) return;
    generation++;
    const interrupted = active; active = null;
    console.info('recall_upload_batch_detached', { reason: 'view-departure', active: Boolean(interrupted) });
    if (interrupted) update(interrupted.key, { state: 'uncertain', progress: null, issue: 'upload_uncertain', checked: false });
    publish({ busy: false, notice: '', feedback: interrupted?.key ?? state.feedback });
    interrupted?.controller.abort();
  };
  return {
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getSnapshot: () => state,
    hasPending: () => state.picks.some(pick => pick.file !== null),
    wait() { publish({ notice: 'Uploading… Please wait before closing.' }); },
    notice(notice: string) { publish({ notice }); },
    deactivate,
    async limits(signal: AbortSignal, owns: () => boolean) {
      publish({ limitsLoading: true, limitsIssue: false, notice: '' });
      try {
        const { maxFileBytes } = await readAttachmentLimits(signal);
        if (signal.aborted || !owns()) return;
        publish({ maxFileBytes, limitsLoading: false, picks: state.picks.map(pick =>
          ['waiting', 'empty', 'too-large'].includes(pick.state) ? { ...pick, state: pick.size === 0 ? 'empty' : pick.size > maxFileBytes ? 'too-large' : 'waiting' } : pick) });
      } catch {
        if (!signal.aborted && owns()) publish({ limitsLoading: false, limitsIssue: true, notice: "Couldn't load the upload limit. Try again." });
      }
    },
    add(files: readonly File[]) {
      if (state.busy) return;
      const picks = [...state.picks];
      let feedback: number | null = null;
      for (const file of files) if (!picks.some(pick => pick.file === file)) {
        picks.push({ key: ++nextKey, name: file.name, size: file.size, file,
          state: file.size === 0 ? 'empty' : state.maxFileBytes !== null && file.size > state.maxFileBytes ? 'too-large' : 'waiting',
          progress: null, issue: null, result: null, refreshIssue: false, checked: false });
        if (file.size === 0) feedback = nextKey;
      }
      publish({ picks, notice: '', feedback });
      console.info('recall_upload_selection_changed', { count: picks.length, trigger: 'picker' });
    },
    remove(key: number) { if (!state.busy) publish({ picks: state.picks.filter(pick => pick.key !== key), notice: '', feedback: null }); },
    dismiss() {
      if (state.busy) return;
      const picks = state.picks.filter(pick => pick.file !== null);
      publish({ picks, notice: '', submitted: picks.length > 0 && state.submitted,
        feedback: picks.some(pick => pick.key === state.feedback) ? state.feedback : null });
    },
    checked() { publish({ picks: state.picks.map(pick => pick.state === 'uncertain' ? { ...pick, checked: true } : pick) }); },
    refreshed() { publish({ picks: state.picks.map(pick => ({ ...pick, refreshIssue: false })), notice: '' }); },
    eligible,
    retryable,
    async run(keys: number[], owns: () => boolean, onUploaded: (result: AttachmentResult) => Promise<void>) {
      if (state.busy || state.limitsLoading || state.limitsIssue || !owns()) return;
      const targets = keys.filter(key => state.picks.some(pick => pick.key === key && eligible(pick) &&
        (pick.state === 'waiting' || retryable(pick) || (pick.state === 'uncertain' && pick.checked))));
      if (!targets.length) return;
      console.info('recall_upload_batch_started', { count: targets.length, trigger: 'explicit' });
      const operation = ++generation;
      const current = () => generation === operation && owns();
      const abandon = () => { if (generation === operation) deactivate(); };
      publish({ busy: true, submitted: true, total: targets.length, position: 0, notice: '', feedback: null });
      for (const key of targets) {
        if (!current()) { abandon(); return; }
        const pick = state.picks.find(pick => pick.key === key);
        if (!pick?.file) continue;
        const controller = new AbortController(); active = { key, controller };
        publish({ position: state.position + 1 });
        update(key, { state: 'uploading', progress: null, issue: null, refreshIssue: false, checked: false });
        try {
          const result = await uploadAttachment(pick.file, controller.signal, progress => {
            if (current()) update(key, { progress, state: progress.finishing ? 'finishing' : 'uploading' });
          });
          if (!current()) { abandon(); return; }
          active = null;
          update(key, { state: 'uploaded', file: null, result, progress: null });
          try { await onUploaded(result); } catch { if (current()) update(key, { refreshIssue: true }); }
          if (!current()) { abandon(); return; }
        } catch (error: unknown) {
          if (!current()) { abandon(); return; }
          active = null;
          const issue = error instanceof AttachmentUploadError ? error.code : 'upload_uncertain';
          update(key, { state: issue === 'upload_uncertain' ? 'uncertain' : 'failed', issue, progress: null });
          publish({ feedback: key });
          if (issue === 'upload_uncertain') { console.info('recall_upload_batch_paused', { reason: 'unconfirmed' }); break; }
        }
      }
      if (current()) { publish({ busy: false, notice: '' }); console.info('recall_upload_batch_settled', { count: targets.length, attempted: state.position }); }
    },
  };
}
export type AttachmentUploads = ReturnType<typeof createAttachmentUploads>;
