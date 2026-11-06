'use client';

import { useCallback, useLayoutEffect, useRef } from 'react';
import type { RefObject } from 'react';
import type { ThinkPresenterProps } from './types';

interface ComposerProps extends ThinkPresenterProps {
  editorRef: RefObject<HTMLTextAreaElement | null>;
  descriptionId?: string;
}

export default function ThinkComposer({ presentation: { state, actions }, editorRef, descriptionId }: ComposerProps) {
  const composing = useRef(false);
  const pressed = useRef<string | null>(null);
  const pointer = useRef<string | null>(null);
  const action = state.composer;
  const identity = state.identity?.epoch ? { conversationId: state.identity.conversationId, epoch: state.identity.epoch } : null;
  const canSend = Boolean(identity && action.kind === 'send' && action.eligible && state.draft.text.trim());
  const canStop = Boolean(identity && action.kind === 'stop' && (action.state === 'available' || action.state === 'retry'));
  const signature = `${state.identity?.conversationId}:${action.kind}:${action.kind === 'stop' ? action.runId : state.draft.version}`;
  const label = action.kind === 'stop' ? action.state === 'requesting' ? 'Stopping…' : action.state === 'retry' ? 'Retry Stop' : 'Stop'
    : action.kind === 'checking' ? 'Checking…' : 'Send';

  const sizeEditor = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    // A textarea's scrollHeight includes a wrapped placeholder. Only actual
    // draft text may grow the editor; an empty value uses the CSS line floor.
    if (!editor.value.length) {
      editor.style.height = '';
      editor.scrollTop = 0;
      return;
    }
    const scroll = editor.scrollTop;
    editor.style.height = 'auto';
    // CSS owns the font-scaled floor and viewport-aware ceiling. scrollHeight is
    // content height, so resetting first lets an emptied/wrapped draft shrink.
    const style = getComputedStyle(editor);
    const border = parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
    editor.style.height = `${editor.scrollHeight + (Number.isFinite(border) ? border : 0)}px`;
    editor.scrollTop = scroll;
  }, [editorRef]);

  useLayoutEffect(sizeEditor, [sizeEditor, state.draft.text]);
  useLayoutEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    let width = editor.clientWidth;
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => {
      if (editor.clientWidth !== width) { width = editor.clientWidth; sizeEditor(); }
    });
    observer?.observe(editor);
    window.addEventListener('resize', sizeEditor);
    return () => { observer?.disconnect(); window.removeEventListener('resize', sizeEditor); };
  }, [editorRef, sizeEditor]);

  const send = () => {
    if (!identity || !canSend) return;
    actions.send(identity, state.draft.version);
    editorRef.current?.focus({ preventScroll: true });
  };

  return <div className="think-compose-row">
    <label className="visually-hidden" htmlFor="think-message">Message</label>
    <textarea id="think-message" ref={editorRef} rows={1} value={state.draft.text} placeholder="Message"
      aria-describedby={descriptionId} onChange={event => actions.editDraft(event.target.value)}
      onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
      onKeyDown={event => {
        if (event.key !== 'Enter' || event.shiftKey || event.altKey) return;
        if (composing.current || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
        event.preventDefault();
        if (!event.repeat) send();
      }} />
    <div className="think-action-column">
      {state.preparedDraft && !state.identity ? <button type="button" className="think-button think-primary" disabled={state.newChat === 'starting'}
        onClick={actions.startPreparedDraft}>Start chat</button> :
      <button type="button" className="think-button think-primary" disabled={!canSend && !canStop}
        aria-keyshortcuts={action.kind === 'send' ? 'Enter Control+Enter Meta+Enter' : undefined}
        title={action.kind === 'send' ? 'Send (Enter); new line (Shift+Enter)' : undefined}
        onPointerDown={() => { pointer.current = signature; }} onPointerCancel={() => { pointer.current = null; }}
        onKeyDown={event => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          if (event.repeat) event.preventDefault();
          else pressed.current = signature;
        }}
        onKeyUp={event => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          if (pressed.current !== signature) event.preventDefault();
          queueMicrotask(() => { pressed.current = null; });
        }}
        onBlur={() => { pressed.current = null; pointer.current = null; }}
        onClick={event => {
          const started = event.detail === 0 ? pressed.current : pointer.current;
          pointer.current = null;
          if (started !== null && started !== signature) return;
          if (canSend) send();
          else if (identity && canStop && action.kind === 'stop') actions.stop(identity, action.runId);
        }}>{label}</button>}
    </div>
  </div>;
}
