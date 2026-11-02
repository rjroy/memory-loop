import { useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { AttachmentResult } from './api';
import { formatFileSize, type AttachmentPick, type AttachmentUploads } from './attachments';

const stateCopy: Record<AttachmentPick['state'], string> = {
  waiting: 'Waiting', empty: 'Empty files cannot be uploaded.', 'too-large': 'Too large', uploading: 'Uploading…', finishing: 'Finishing upload…',
  uploaded: 'Uploaded', failed: "Couldn't upload", uncertain: 'Upload not confirmed.',
};

export default function AttachmentsUpload({ uploads, trigger, isCurrent, onClose, onUploaded, onOpen, onRefresh, onCheckFiles }: {
  uploads: AttachmentUploads; trigger: HTMLElement | null; isCurrent: () => boolean; onClose: () => void;
  onUploaded: (result: AttachmentResult) => Promise<void>; onOpen: (result: AttachmentResult) => void;
  onRefresh: () => Promise<void>; onCheckFiles: () => void;
}) {
  const state = useSyncExternalStore(uploads.subscribe, uploads.getSnapshot, uploads.getSnapshot);
  const dialog = useRef<HTMLDialogElement>(null), chooser = useRef<HTMLButtonElement>(null), input = useRef<HTMLInputElement>(null);
  const content = useRef<HTMLDivElement>(null), issue = useRef<HTMLElement | null>(null), notice = useRef<HTMLParagraphElement>(null);
  const keep = useRef<HTMLButtonElement>(null), restore = useRef<HTMLElement | null>(null), retryFocus = useRef<number | null>(null);
  const repeatWarning = useRef<HTMLParagraphElement>(null);
  const mounted = useRef(false);
  const [confirm, setConfirm] = useState<number | null>(null), [refreshing, setRefreshing] = useState(false), [limitRead, setLimitRead] = useState(0);
  const title = useId(), pickerId = useId(), warningId = useId();
  const waiting = state.picks.filter(pick => pick.state === 'waiting' && uploads.eligible(pick));
  const failed = state.picks.filter(pick => uploads.retryable(pick) && uploads.eligible(pick));
  const unfinished = state.picks.some(pick => pick.file !== null);
  const pendingConfirmation = state.picks.find(pick => pick.key === confirm && pick.state === 'uncertain' && pick.checked);
  const canSubmit = !state.busy && !refreshing && !state.limitsLoading && !state.limitsIssue && state.maxFileBytes !== null;

  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; uploads.deactivate(); uploads.dismiss(); }; }, [uploads]);
  useLayoutEffect(() => {
    if (!trigger) {
      if (restore.current?.isConnected && isCurrent()) { restore.current.focus({ preventScroll: true }); restore.current.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }); }
      restore.current = null; return;
    }
    if (!isCurrent()) { uploads.deactivate(); dialog.current?.close?.(); onClose(); return; }
    if (dialog.current && !dialog.current.open) {
      if (typeof dialog.current.showModal === 'function') dialog.current.showModal(); else dialog.current.setAttribute('open', '');
      chooser.current?.focus({ preventScroll: true });
    }
  });
  useEffect(() => {
    if (!trigger) return;
    const controller = new AbortController();
    void uploads.limits(controller.signal, () => mounted.current && isCurrent());
    return () => controller.abort();
  }, [trigger, uploads, limitRead]);
  useLayoutEffect(() => {
    if (confirm !== null) {
      if (content.current) content.current.scrollTop = 0;
      keep.current?.focus({ preventScroll: true });
      const pane = content.current, message = repeatWarning.current;
      if (pane && message) {
        const bounds = pane.getBoundingClientRect(), text = message.getBoundingClientRect();
        if (text.top < bounds.top || text.bottom > bounds.bottom) pane.scrollTop += text.top - bounds.top;
      }
    }
    else if (retryFocus.current !== null) {
      dialog.current?.querySelector<HTMLElement>(`[data-upload-again="${retryFocus.current}"]`)?.focus(); retryFocus.current = null;
    }
  }, [confirm]);
  useLayoutEffect(() => {
    // Preserve h57 V1: reveal the first feedback line inside the dialog only,
    // without moving focus or either background scroller. The footer never shrinks.
    const pane = content.current, message = state.notice ? notice.current : state.busy ? null : issue.current;
    if (!trigger || !pane || !message) return;
    const bounds = pane.getBoundingClientRect(), text = message.getBoundingClientRect(), viewport = window.visualViewport;
    const top = Math.max(bounds.top + pane.clientTop, viewport?.offsetTop ?? 0);
    const bottom = Math.min(bounds.bottom, (viewport?.offsetTop ?? 0) + (viewport?.height ?? innerHeight));
    const firstLine = Math.min(text.height, parseFloat(getComputedStyle(message).lineHeight));
    if (text.top < top || text.top + firstLine > bottom) pane.scrollTop += text.top - top;
  }, [trigger, state.feedback, state.notice, state.busy, state.limitsIssue]);

  const close = () => {
    if (state.busy || refreshing) { uploads.wait(); return; }
    if (confirm !== null) { retryFocus.current = confirm; setConfirm(null); return; }
    restore.current = trigger; dialog.current?.close?.(); uploads.dismiss(); onClose();
  };
  const start = (keys: number[]) => {
    if (!canSubmit || !isCurrent()) return;
    setConfirm(null);
    void uploads.run(keys, () => mounted.current && isCurrent(), onUploaded);
  };
  const refresh = async (check = false) => {
    if (refreshing || state.busy || !isCurrent()) return;
    setRefreshing(true);
    try {
      await onRefresh();
      if (!mounted.current || !isCurrent()) return;
      uploads.refreshed();
      if (check) { uploads.checked(); dialog.current?.close?.(); uploads.dismiss(); onClose(); onCheckFiles(); }
    } catch { if (mounted.current && isCurrent()) uploads.notice("Couldn't refresh files. Check the connection and try again."); }
    finally { if (mounted.current) setRefreshing(false); }
  };
  if (!trigger) return null;
  const counts = ['uploaded', 'failed', 'uncertain', 'waiting'].map(kind => state.picks.filter(pick => pick.state === kind).length);
  const rejected = state.picks.filter(pick => pick.state === 'empty' || pick.state === 'too-large').length;
  const summary = state.busy ? `Uploading ${state.position} of ${state.total}…` : state.submitted
    ? `${counts[0]} uploaded, ${counts[1]} failed, ${counts[2]} not confirmed, ${counts[3]} waiting${rejected ? `, ${rejected} not eligible` : ''}.`
    : `${state.picks.length} ${state.picks.length === 1 ? 'file' : 'files'} selected.`;
  const targets = waiting.length ? waiting : failed;
  const action = waiting.length ? state.submitted ? 'Upload remaining' : `Upload ${waiting.length} ${waiting.length === 1 ? 'file' : 'files'}`
    : failed.length ? 'Retry failed' : 'Upload 0 files';
  return <dialog ref={dialog} tabIndex={-1} className="recall-action-dialog recall-upload-dialog" aria-labelledby={title} aria-describedby={pendingConfirmation ? warningId : undefined}
    onCancel={event => { event.preventDefault(); event.stopPropagation(); close(); }}
    onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); } }}>
    <form aria-busy={state.busy || refreshing} onSubmit={event => { event.preventDefault(); if (pendingConfirmation) start([pendingConfirmation.key]); else start(targets.map(pick => pick.key)); }}>
      <div ref={content} className="action-dialog-content">
        <h2 id={title}>{pendingConfirmation ? 'Upload this file again?' : 'Upload files'}</h2>
        {pendingConfirmation ? <>
          <p className="upload-file-name">{pendingConfirmation.name}</p>
          <p>The earlier upload wasn't confirmed.</p>
          <p ref={repeatWarning} id={warningId}>Uploading again may save another copy.</p>
        </> : <>
          <p className="action-location">Destination: 06_Attachments/</p>
          <button ref={chooser} type="button" className="recall-button" disabled={state.busy || refreshing} onClick={() => input.current?.click()}>Choose files…</button>
          <input ref={input} id={pickerId} type="file" multiple className="visually-hidden" tabIndex={-1} aria-label="Choose files"
            disabled={state.busy || refreshing} onChange={event => { uploads.add(Array.from(event.currentTarget.files ?? [])); event.currentTarget.value = ''; }} />
          <p className="action-help">{state.limitsLoading ? 'Checking upload limit…' : state.maxFileBytes === null ? 'Upload limit unavailable.' : `Up to ${formatFileSize(state.maxFileBytes)} per file.`}</p>
          {state.limitsIssue && <button type="button" className="recall-button upload-recovery" disabled={refreshing} onClick={() => setLimitRead(value => value + 1)}>Retry upload limit</button>}
          <p className="upload-summary" role="status" aria-live="polite" aria-atomic="true">{summary}</p>
          {state.notice && <p ref={notice} className="action-error" role={state.limitsIssue ? 'alert' : 'status'}>{state.notice}</p>}
          <ul className="upload-picked-list">{state.picks.map(pick => <li key={pick.key} aria-labelledby={`${pickerId}-${pick.key}`}>
            <div className="upload-file-heading"><h3 className="upload-file-name" id={`${pickerId}-${pick.key}`}>{pick.name}</h3><span>{formatFileSize(pick.size)}</span></div>
            <p className="upload-row-state" ref={element => { if (state.feedback === pick.key) issue.current = element; }}
              role={state.feedback === pick.key && !state.busy && ['empty', 'failed', 'uncertain'].includes(pick.state) ? 'alert' : undefined}>{stateCopy[pick.state]}</p>
            {pick.state === 'too-large' && <p>This file exceeds the {state.maxFileBytes === null ? 'last advertised' : formatFileSize(state.maxFileBytes)} limit. Choose a smaller file.</p>}
            {pick.state === 'failed' && <p>{pick.issue === 'upload_too_large' ? 'This file exceeds the server’s upload limit.' : pick.issue === 'invalid_request'
              ? "This file name couldn't be used. Choose a different file." : "The upload couldn't be saved. Your selected file is still here. Try again."}</p>}
            {pick.state === 'uncertain' && <p>The file may have been saved. Check files before uploading it again.</p>}
            {pick.result && pick.result.name !== pick.name && <p>Saved as {pick.result.name}</p>}
            {pick.refreshIssue && <p>Uploaded. Couldn't refresh files.</p>}
            {['uploading', 'finishing'].includes(pick.state) && <>
              <progress className="upload-progress" aria-label={`Upload progress for ${pick.name}`} max={pick.progress?.total ?? 1}
                value={pick.progress?.total === null || !pick.progress ? undefined : Math.min(pick.progress.loaded, pick.progress.total)} />
              {pick.progress && <p className="action-help">{formatFileSize(pick.progress.loaded)}{pick.progress.total !== null && ` of ${formatFileSize(pick.progress.total)}`} transferred</p>}
            </>}
            <div className="recall-confirm-actions upload-row-actions">
              {pick.result && <button type="button" className="recall-button" disabled={state.busy || refreshing || pick.refreshIssue} onClick={() => {
                if (!pick.result || !isCurrent()) return;
                dialog.current?.close?.(); uploads.dismiss(); onClose(); onOpen(pick.result);
              }}>Open file</button>}
              {pick.refreshIssue && <button type="button" className="recall-button" disabled={state.busy || refreshing} onClick={() => void refresh()}>Refresh files</button>}
              {pick.state === 'uncertain' && <>
                <button type="button" className="recall-button" disabled={state.busy || refreshing} onClick={() => void refresh(true)}>Check files</button>
                {pick.checked && <button type="button" className="recall-button" disabled={!canSubmit} data-upload-again={pick.key} onClick={() => setConfirm(pick.key)}>Upload again…</button>}
              </>}
              {pick.file && <button type="button" className="recall-button" disabled={state.busy || refreshing} aria-label={`Remove ${pick.name}`} onClick={() => uploads.remove(pick.key)}>Remove</button>}
            </div>
          </li>)}</ul>
          {unfinished && <p className="action-help">Your selected files are kept until this page is reloaded.</p>}
        </>}
      </div>
      <div className="recall-confirm-actions action-dialog-buttons">
        <button ref={pendingConfirmation ? keep : undefined} type="button" className="recall-button" disabled={state.busy || refreshing} onClick={close}>{pendingConfirmation ? 'Keep waiting' : 'Close'}</button>
        {(pendingConfirmation || targets.length || !state.submitted || state.busy) && <button type="submit" className="recall-button recall-save" disabled={!canSubmit || (!pendingConfirmation && !targets.length)}>
          {state.busy ? 'Uploading…' : pendingConfirmation ? 'Upload again' : action}
        </button>}
      </div>
    </form>
  </dialog>;
}
