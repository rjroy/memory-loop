'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import RouteHeading from '../shell/RouteHeading';
import MarkdownDocument from '../recall/MarkdownDocument';
import ThinkComposer from './ThinkComposer';
import ThinkQuestion from './ThinkQuestion';
import type { ThinkActivity, ThinkAdmission, ThinkKnownIdentity, ThinkMessage, ThinkMessagePart, ThinkPresenterProps } from './types';

const toolNames = { 'file-read': 'File read', 'file-write': 'File change', shell: 'Shell tool', search: 'File search', subagent: 'Subagent', custom: 'Custom tool' };
function activityLabel(activity: ThinkActivity): string {
  if (activity.kind === 'compaction') return activity.phase === 'started' ? 'AI is making room in its context…' : activity.phase === 'ended' ? 'Context compacted' : 'Context compaction failed';
  return `${toolNames[activity.category]} · ${activity.state === 'started' ? 'working' : activity.state}`;
}

function Activity({ items, onOpen }: { items: readonly ThinkActivity[]; onOpen?(): void }) {
  if (!items.length) return null;
  const current = [...items].reverse().find(item => item.kind === 'tool' ? item.state === 'started' : item.phase === 'started') ?? items[items.length - 1];
  return <details className="think-activity" onToggle={event => { if (event.currentTarget.open) onOpen?.(); }}>
    <summary><span className="visually-hidden">AI activity: </span>{activityLabel(current)}</summary>
    <ol aria-label="AI activity">{items.map(item => <li key={item.id}>{activityLabel(item)}
      {item.kind === 'tool' && item.durationMs !== undefined && <span className="think-duration">{new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(item.durationMs / 1000)}s</span>}
    </li>)}</ol>
  </details>;
}

function MessageBody({ part, identity, presentation, fallbackText }: { part: ThinkMessagePart; identity: ThinkKnownIdentity | null; fallbackText?: string } & ThinkPresenterProps) {
  const content = part.content;
  const text = content.state === 'ready' ? content.text : content.previousText ?? fallbackText;
  return <div className="think-part" data-think-anchor={`part:${part.messageId}:${part.ordinal}`}>
    {text !== undefined && <MarkdownDocument markdown={text} />}
    {content.state === 'unloaded' && identity && <button type="button" className="think-button think-text-button" onClick={() => presentation.actions.retryBody(identity, content.ref)}>Load message</button>}
    {content.state === 'loading' && <p className="think-part-status">Loading message…</p>}
    {content.state === 'replacing' && <p className="think-part-status">Updating message…</p>}
    {content.state === 'error' && <div className="think-part-status">
      <p>{content.reason === 'unsupported' ? 'This message cannot be displayed with the available resources.' : 'This message couldn’t be loaded.'}</p>
      {identity && <button type="button" className="think-button think-text-button" onClick={() => presentation.actions.retryBody(identity, content.ref)}>Retry message</button>}
    </div>}
    {part.closure === 'open' && part.capture !== 'complete'
      ? <p className="think-part-status">Partial response · catching up</p>
      : part.closure === 'open' && content.state === 'ready' && <span className="think-stream-mark" aria-hidden="true" />}
  </div>;
}

function admissionText(message: ThinkMessage): string | null {
  if (message.role !== 'user' || !message.admission) return null;
  return receiptText(message.admission);
}

function receiptText(admission: ThinkAdmission): string | null {
  switch (admission.state) {
    case 'submitting': case 'checking': return 'Checking message receipt…';
    case 'registered': return 'Waiting to start';
    case 'rejected': return 'Message wasn’t accepted.';
    default: return null;
  }
}

export default function ThinkConversation({ presentation }: ThinkPresenterProps) {
  return <Conversation presentation={presentation} />;
}

function Conversation({ presentation }: ThinkPresenterProps) {
  const { state, actions } = presentation;
  const editor = useRef<HTMLTextAreaElement>(null);
  const reader = useRef<HTMLElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const keepWriting = useRef<HTMLButtonElement>(null);
  const following = useRef(true);
  const anchor = useRef<{ key: string; offset: number } | null>(null);
  const programmatic = useRef(false);
  const readerPointer = useRef(false);
  const [latest, setLatest] = useState(false);
  const [selected, setSelected] = useState(false);
  const selectedRef = useRef(false);
  const retainedParts = useRef(new Map<string, ThinkMessagePart>());
  const messageKeys = useRef(new Map<string, string>());
  const submittedTexts = useRef(new Map<string, string>());
  const previousIdentity = useRef(state.identity?.conversationId);
  const previousRun = useRef(state.run.state);
  const pendingNewChatFocus = useRef(false);
  const [announcement, setAnnouncement] = useState('');
  const sameConversation = previousIdentity.current === state.identity?.conversationId;
  if (!sameConversation) { retainedParts.current.clear(); messageKeys.current.clear(); submittedTexts.current.clear(); }
  if (state.pendingSubmission) submittedTexts.current.set(state.pendingSubmission.clientCommandId, state.pendingSubmission.text);
  const messages: readonly ThinkMessage[] = state.pendingSubmission ? [...state.messages, {
    role: 'user', messageId: `pending:${state.pendingSubmission.clientCommandId}`, displayOrder: Number.MAX_SAFE_INTEGER,
    parts: [], admission: state.pendingSubmission.admission,
  }] : state.messages;
  const displayPart = (part: ThinkMessagePart) => {
    const key = `${part.messageId}:${part.ordinal}`;
    const retained = retainedParts.current.get(key);
    if (selected && sameConversation && retained) return retained;
    retainedParts.current.set(key, part);
    return part;
  };
  const messageKey = (message: ThinkMessage) => {
    if (!messageKeys.current.has(message.messageId)) messageKeys.current.set(message.messageId,
      message.role === 'user' && message.admission ? `submission:${message.admission.clientCommandId}` : message.messageId);
    return messageKeys.current.get(message.messageId)!;
  };
  const [recover, setRecover] = useState<string | null>(null);
  const noticeId = useId();
  const identity = state.identity?.epoch ? { conversationId: state.identity.conversationId, epoch: state.identity.epoch } : null;
  const hasContent = Boolean(messages.length || state.pendingSubmission || state.questions.length || state.backgroundActivity.length);

  const nearBottom = () => {
    const region = reader.current;
    if (!region) return true;
    if (getComputedStyle(region).overflowY === 'visible') return region.getBoundingClientRect().bottom <= window.innerHeight + 12;
    return region.scrollHeight - region.clientHeight - region.scrollTop <= 12;
  };
  const rememberAnchor = () => {
    const region = reader.current;
    if (!region) return;
    const top = getComputedStyle(region).overflowY === 'visible' ? 0 : region.getBoundingClientRect().top;
    const elements = region.querySelectorAll<HTMLElement>('[data-think-anchor]');
    for (const element of elements) {
      if (element.getBoundingClientRect().bottom > top) {
        anchor.current = { key: element.dataset.thinkAnchor!, offset: element.getBoundingClientRect().top - top };
        return;
      }
    }
    anchor.current = null;
  };
  const readerControl = () => {
    const active = document.activeElement;
    return active instanceof HTMLElement && reader.current?.contains(active) && active !== reader.current ? active : null;
  };
  const revealReaderControl = () => {
    const region = reader.current;
    const active = readerControl();
    if (!region || !active || getComputedStyle(region).overflowY === 'visible') return;
    const box = region.getBoundingClientRect();
    const control = active.getBoundingClientRect();
    const inset = 8; // Includes the existing focus outline and its offset.
    if (control.top < box.top + inset || control.height > region.clientHeight - inset * 2) region.scrollTop += control.top - box.top - inset;
    else if (control.bottom > box.bottom - inset) region.scrollTop += control.bottom - box.bottom + inset;
  };
  const pause = () => { following.current = false; setLatest(hasContent && !nearBottom()); rememberAnchor(); };
  const settleReading = () => {
    const region = reader.current;
    if (!region || readerPointer.current) return;
    // At short heights the document is the scroll owner. Never chase tokens by
    // scrolling the whole page; Latest is an explicit user action in this mode.
    if (getComputedStyle(region).overflowY === 'visible') {
      following.current = false;
      setLatest(hasContent && !nearBottom());
      rememberAnchor();
      return;
    }
    programmatic.current = true;
    if (following.current && !selectedRef.current) region.scrollTop = region.scrollHeight;
    else if (anchor.current) {
      const saved = anchor.current;
      const element = Array.from(region.querySelectorAll<HTMLElement>('[data-think-anchor]')).find(item => item.dataset.thinkAnchor === saved.key);
      if (element) region.scrollTop += element.getBoundingClientRect().top - region.getBoundingClientRect().top - saved.offset;
    }
    // A resized composer/notice can move the reader edge after the browser's
    // native focus scroll. Keep that active control visible before saving the
    // new reading anchor; do not scroll unrelated ancestors or follow tokens.
    revealReaderControl();
    programmatic.current = false;
    setLatest(hasContent && !following.current && !nearBottom());
    rememberAnchor();
  };

  useLayoutEffect(() => {
    const id = state.identity?.conversationId;
    if (previousIdentity.current && id && previousIdentity.current !== id) {
      following.current = true;
      anchor.current = null;
      selectedRef.current = false;
      setSelected(false);
      setRecover(null);
      pendingNewChatFocus.current = true;
      setAnnouncement(previousRun.current === 'working' ? 'New chat. Previous work continues.' : 'New chat.');
    }
    if (pendingNewChatFocus.current && state.creation === 'ready') {
      pendingNewChatFocus.current = false;
      document.getElementById('view-heading')?.focus({ preventScroll: true });
    }
    previousIdentity.current = id;
    previousRun.current = state.run.state;
  }, [state.identity?.conversationId, state.creation, state.run.state]);
  // Actual size changes drive anchoring. Re-projecting identical messages while
  // a question field is edited must not undo native focus scrolling.
  useLayoutEffect(settleReading, [state.identity?.conversationId, hasContent, selected]);
  useEffect(() => {
    const selectionChanged = () => {
      const selection = window.getSelection();
      const held = Boolean(selection && !selection.isCollapsed && reader.current &&
        (reader.current.contains(selection.anchorNode) || reader.current.contains(selection.focusNode)));
      selectedRef.current = held;
      setSelected(held);
      if (held) { following.current = false; setLatest(true); rememberAnchor(); }
    };
    const pageScrolled = () => {
      if (reader.current && getComputedStyle(reader.current).overflowY === 'visible') setLatest(hasContent && !nearBottom());
    };
    document.addEventListener('selectionchange', selectionChanged);
    window.addEventListener('scroll', pageScrolled, { passive: true });
    return () => { document.removeEventListener('selectionchange', selectionChanged); window.removeEventListener('scroll', pageScrolled); };
  }, [hasContent]);
  useEffect(() => {
    let release: ReturnType<typeof setTimeout> | undefined;
    const finishPointer = () => {
      if (!readerPointer.current) return;
      // pointerup precedes mouseup/click. Finish that native activation before
      // changing scroll position under its target.
      release = setTimeout(() => { readerPointer.current = false; settleReading(); }, 0);
    };
    window.addEventListener('pointerup', finishPointer, true);
    window.addEventListener('pointercancel', finishPointer, true);
    return () => {
      window.removeEventListener('pointerup', finishPointer, true);
      window.removeEventListener('pointercancel', finishPointer, true);
      if (release !== undefined) clearTimeout(release);
      readerPointer.current = false;
    };
  }, [hasContent, selected]);
  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(settleReading);
    if (reader.current) observer.observe(reader.current);
    if (content.current) observer.observe(content.current);
    return () => observer.disconnect();
  }, [hasContent, selected]);
  useLayoutEffect(() => {
    if (state.newChat === 'confirm-discard') keepWriting.current?.focus({ preventScroll: true });
  }, [state.newChat]);

  const exceptions: string[] = [];
  if (state.newChat === 'starting') exceptions.push('Starting chat…');
  else if (state.creation === 'registered') exceptions.push('Starting chat…');
  else if (state.creation === 'upstream-unconfirmed') exceptions.push('Checking whether this chat was started…');
  else if (state.creation === 'rejected') exceptions.push(state.creationFailure === 'configuration_invalid' ? 'Think setup needs attention.' : 'This chat couldn’t be started.');
  else if (state.creation === 'missing') exceptions.push('This chat couldn’t be opened. Check the address or start a new chat.');
  else if (state.monitoring === 'denied') exceptions.push('Access to this chat was denied. Access must be corrected before checking again.');
  else if (state.monitoring === 'service-changed') exceptions.push('Service changed; outcome unknown.');
  else if (state.monitoring === 'unavailable') exceptions.push('Think is unavailable.');
  else if (state.monitoring === 'reconnecting') exceptions.push(`Reconnecting. Work may continue.${state.composer.kind === 'stop' && state.composer.state === 'unavailable' ? ' Stop unavailable.' : ''}`);
  else if (state.monitoring === 'resynchronizing') exceptions.push('Catching up…');
  else if (state.monitoring === 'opening' || state.creation === 'opening') exceptions.push('Opening current chat…');
  if (state.permissionCompatibility === 'incompatible' || state.permissionPending) exceptions.push('Tool access doesn’t match this chat’s full-access setup. This chat cannot resolve that request here.');
  if (state.transcriptWarning?.current) {
    const reason = state.transcriptWarning.current.reason;
    exceptions.push(reason === 'conflict' ? 'Transcript needs attention: file changed.' : reason === 'content_gap' ? 'Some transcript content is unavailable.'
      : reason === 'invalid_configuration' ? 'Transcript setup needs attention.' : 'Transcript saving is still delayed.');
  }
  if (state.transcriptWarning && state.transcriptWarning.otherCount > 0) exceptions.push('Some transcripts need attention.');
  if (state.composer.kind === 'stop' && state.composer.state === 'retry') exceptions.push('Couldn’t request Stop. Work may still be running.');
  const terminal = state.run.state === 'interrupted' ? 'Stopped' : state.run.state === 'cancelled-before-delivery' ? 'Stopped before starting'
    : state.run.state === 'failed' ? 'Response ended with an error.' : '';
  const canCheck = ['denied', 'unavailable'].includes(state.monitoring) || state.newChat === 'unavailable';
  const dismissNewChat = () => { actions.cancelNewChat(); editor.current?.focus({ preventScroll: true }); };

  return <div className="think-view think-view--conversation">
    <div className="visually-hidden"><RouteHeading route="/think">Think</RouteHeading></div>
    <a className="skip-link think-skip-message" href="#think-message">Skip to message</a>
    <section className="think-conversation" aria-label="Conversation" tabIndex={0} ref={reader}
      onPointerDownCapture={() => { readerPointer.current = true; }}
      onFocusCapture={event => {
        if (event.target !== event.currentTarget) {
          following.current = false;
          if (!readerPointer.current) {
            setLatest(hasContent && !nearBottom());
            queueMicrotask(() => { revealReaderControl(); rememberAnchor(); });
          }
        }
      }}
      onWheel={event => { if (event.deltaY < 0) pause(); }}
      onTouchMove={pause}
      onKeyDown={event => {
        if (event.target instanceof HTMLElement && event.target.closest('input, textarea, select, button, summary, a')) return;
        if (['ArrowUp', 'PageUp', 'Home'].includes(event.key)) pause();
      }}
      onScroll={() => {
        if (programmatic.current) return;
        if (readerPointer.current) { following.current = false; rememberAnchor(); return; }
        following.current = nearBottom() && !selectedRef.current && !readerControl();
        setLatest(hasContent && !following.current && !nearBottom());
        rememberAnchor();
      }}>
      <div className="think-conversation-measure" ref={content}>
        {!hasContent && state.creation === 'ready' && <div className="think-empty-invitation">
          <h2>What else could this become?</h2><img src="/brand/the-guide/approved-a5.svg" width="64" height="64" alt="" />
        </div>}
        {messages.map((message, index) => <article key={messageKey(message)} className={`think-message think-message--${message.role}`}
          data-think-anchor={`message:${message.messageId}`} aria-label={`${message.role === 'user' ? 'You' : 'AI'}, message ${index + 1}`}>
          <p className="think-role">{message.role === 'user' ? 'You' : 'AI'}</p>
          {message.parts.map(part => <MessageBody key={`${part.messageId}:${part.ordinal}`} part={displayPart(part)} identity={identity} presentation={presentation}
            fallbackText={message.role === 'user' && message.admission ? submittedTexts.current.get(message.admission.clientCommandId) : undefined} />)}
          {message.messageId === `pending:${state.pendingSubmission?.clientCommandId}` && <div className="think-part"><MarkdownDocument markdown={state.pendingSubmission!.text} /></div>}
          {admissionText(message) && <p className="think-part-status">{admissionText(message)}</p>}
          {message.role === 'user' && message.admission?.state === 'checking' && <button type="button" className="think-button think-text-button" onClick={actions.checkConnection}>Check receipt</button>}
          {message.role === 'assistant' && <Activity items={message.activity} onOpen={() => { if (!nearBottom()) pause(); }} />}
        </article>)}
        {state.backgroundActivity.length > 0 && <section className="think-background" aria-label="Background activity"><p className="think-role">AI · Background activity</p><Activity items={state.backgroundActivity} onOpen={() => { if (!nearBottom()) pause(); }} /></section>}
        {identity && state.questions.map(question => <ThinkQuestion key={question.decisionId} identity={identity} question={question} actions={actions} />)}
        {state.history.state === 'loading' && <p className="think-part-status">Loading messages…</p>}
        {state.history.state === 'unavailable' && <p className="think-part-status">Some messages couldn’t be loaded.</p>}
        {state.history.state === 'more' && identity && <button type="button" className="think-button think-text-button" onClick={() => {
          if (state.history.state === 'more') { pause(); actions.loadHistory(identity, state.history.nextCursor); }
        }}>Load more messages</button>}
        {terminal && hasContent && <p className="think-part-status" role="status">{terminal}</p>}
      </div>
    </section>
    <div className="think-compose-area">
      <div className="think-compose-measure">
        {latest && <button type="button" className="think-button think-latest" aria-label="Latest response" onClick={() => {
          const region = reader.current;
          if (!region) return;
          const buttonFocused = document.activeElement instanceof HTMLElement && document.activeElement.getAttribute('aria-label') === 'Latest response';
          if (getComputedStyle(region).overflowY === 'visible') region.scrollIntoView({ block: 'end', behavior: 'instant' });
          else { following.current = true; region.scrollTop = region.scrollHeight; }
          setLatest(false);
          rememberAnchor();
          if (buttonFocused) region.focus({ preventScroll: true });
        }}>Latest</button>}
        {state.newChat === 'confirm-discard' && <div className="think-draft-confirm" role="group" aria-label="Discard draft" onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); dismissNewChat(); } }}>
          <p>Discard this draft and start a new chat?</p>
          <div className="think-inline-actions"><button type="button" className="think-button think-secondary" ref={keepWriting} onClick={dismissNewChat}>Keep writing</button>
            <button type="button" className="think-button think-secondary" onClick={actions.confirmNewChat}>Discard &amp; start</button></div>
        </div>}
        {state.rejectedSubmissions.map(submission => <div className="think-exception" key={submission.clientCommandId}>
          <p>Message wasn’t accepted.{submission.reason === 'resource_failure' ? ' The service ran out of available resources.' : ''}</p>
          {identity && state.draft.text !== submission.text && (recover === submission.clientCommandId && state.draft.text.trim()
            ? <div className="think-inline-actions"><span>Replace your current draft?</span><button type="button" className="think-button think-text-button" onClick={() => setRecover(null)}>Keep writing</button>
              <button type="button" className="think-button think-text-button" onClick={() => { actions.recoverRejected(identity, submission.clientCommandId, state.draft.version); setRecover(null); editor.current?.focus(); }}>Replace draft</button></div>
            : <button type="button" className="think-button think-text-button" onClick={() => {
              if (state.draft.text.trim()) setRecover(submission.clientCommandId);
              else { actions.recoverRejected(identity, submission.clientCommandId); editor.current?.focus(); }
            }}>Use unsent message</button>)}
        </div>)}
        <div id={noticeId} className="think-exception" role="status" aria-live="polite" aria-atomic="true">
          {exceptions.length > 0 && <p>{exceptions.join(' ')}</p>}
        </div>
        {canCheck && <button type="button" className="think-button think-text-button" onClick={actions.checkConnection}>{state.monitoring === 'denied' ? 'Check access' : 'Check connection'}</button>}
        <ThinkComposer presentation={presentation} editorRef={editor} descriptionId={exceptions.length ? noticeId : undefined} />
        <p className="visually-hidden" role="status" aria-live="polite">{announcement}</p>
      </div>
    </div>
  </div>;
}
