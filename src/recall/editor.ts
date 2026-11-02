import type { VaultId, VaultNoteResponse } from '../../backend/contract';
import { idKey, readNote, RecallReadError, saveNote, type RecallFailure } from './api';

interface Draft { id: VaultId; base: VaultNoteResponse; markdown: string }
interface Confirmed { key: string; note: VaultNoteResponse }
interface EditorState {
  draft: Draft | null;
  confirmed: Confirmed | null;
  saving: boolean;
  reloading: boolean;
  issue: RecallFailure | 'reload' | null;
  fenced: boolean;
  notice: string;
  pending: (() => void) | null;
}

/** One volatile, identity-bound editor owned by the persistent shell. */
export function createRecallEditor() {
  let state: EditorState = { draft: null, confirmed: null, saving: false, reloading: false, issue: null, fenced: false, notice: '', pending: null };
  const listeners = new Set<() => void>();
  const publish = (patch: Partial<EditorState>) => { state = { ...state, ...patch }; listeners.forEach(listener => listener()); };
  const dirty = () => Boolean(state.draft && state.draft.markdown !== state.draft.base.markdown);
  const position = { start: 0, end: 0, direction: 'none' as 'forward' | 'backward' | 'none', scroll: 0, readingScroll: 0 };
  const finish = () => publish({ draft: null, issue: null, fenced: false, pending: null, notice: '' });
  return {
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getSnapshot: () => state,
    position,
    dirty,
    start(id: VaultId, note: VaultNoteResponse) {
      if (state.draft || !note.editable || !note.revision) return;
      Object.assign(position, { start: 0, end: 0, direction: 'none', scroll: 0 });
      publish({ draft: { id: [...id], base: note, markdown: note.markdown }, confirmed: { key: idKey(id), note }, issue: null, fenced: false, notice: '' });
      console.info('recall_edit_started', { trigger: 'edit' });
    },
    change(markdown: string) {
      if (state.draft) publish({ draft: { ...state.draft, markdown }, notice: state.saving ? state.notice : '' });
    },
    /** Caller executes its action only when true. A blocked action is held once. */
    request(action: () => void) {
      if (state.pending) return false;
      if (state.saving || state.reloading) {
        publish({ notice: state.saving ? 'Saving… Please wait before leaving.' : 'Reloading… Please wait before leaving.' });
        return false;
      }
      if (!dirty()) return true;
      publish({ pending: action });
      console.info('recall_departure_held', { reason: 'unsaved' });
      return false;
    },
    keep() { publish({ pending: null }); console.info('recall_departure_cancelled', { trigger: 'keep-editing' }); },
    discard() {
      const action = state.pending;
      if (!action || state.saving || state.reloading) return;
      // The held action owns replacement. Reload must retain the old draft until
      // its read succeeds; a navigation/cancel explicitly finishes it instead.
      publish({ pending: null });
      console.info('recall_discard_confirmed', { trigger: 'discard' });
      action();
    },
    finish,
    leave() { finish(); publish({ confirmed: null }); },
    clearConfirmed() { if (!state.draft) publish({ confirmed: null, notice: '' }); },
    async save() {
      const draft = state.draft;
      if (!draft || !dirty() || state.saving || state.reloading || state.pending || state.fenced) return;
      publish({ saving: true, issue: null, notice: '' });
      try {
        const acknowledgement = await saveNote({ id: draft.id, markdown: draft.markdown, expectedRevision: draft.base.revision });
        if (!state.draft || idKey(state.draft.id) !== idKey(draft.id)) return;
        const base = { ...draft.base, markdown: draft.markdown, revision: acknowledgement.revision };
        const newer = state.draft.markdown !== draft.markdown;
        publish({ saving: false, confirmed: { key: idKey(draft.id), note: base },
          draft: newer ? { ...state.draft, base } : null,
          notice: newer ? 'Saved. Newer changes are not saved yet.' : 'Note saved.' });
      } catch (error: unknown) {
        const issue = error instanceof RecallReadError ? error.code : 'note_save_uncertain';
        publish({ saving: false, issue, fenced: issue === 'note_conflict' || issue === 'note_not_editable' || issue === 'note_unavailable' });
      }
    },
    async reload() {
      const draft = state.draft;
      if (!draft || state.saving || state.reloading) return;
      publish({ reloading: true, notice: 'Reloading saved note…' });
      try {
        const note = await readNote(idKey(draft.id), new AbortController().signal);
        publish({ draft: null, confirmed: { key: idKey(draft.id), note }, reloading: false, fenced: false, notice: 'Saved note reloaded.' });
      } catch {
        // Keep both the original source and revision, including a conflict fence.
        publish({ reloading: false, issue: 'reload' });
      }
    },
  };
}
