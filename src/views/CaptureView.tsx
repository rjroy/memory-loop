'use client';

import { useId, useRef } from 'react';
import { useCapture } from '../capture/CaptureSession';
import { isMobileCaptureDevice } from '../capture/input-mode';
import RouteHeading from '../shell/RouteHeading';

export default function CaptureView() {
  const { state, edit, capture } = useCapture();
  const id = useId();
  const composing = useRef(false);
  const editorEnterHeld = useRef(false);
  const buttonPress = useRef<{ version: number; eligible: boolean } | null>(null);
  const pointerPress = useRef<{ version: number; eligible: boolean } | null>(null);
  const eligible = state.feedback.kind !== 'saving' && Boolean(state.draft.text.trim());
  const feedback = state.feedback;
  const exception = feedback.kind === 'rejected' || feedback.kind === 'uncertain';
  const message = feedback.kind === 'saved' ? 'Saved'
    : feedback.kind === 'uncertain' ? 'Save unconfirmed. Capturing again may duplicate it.'
    : feedback.kind === 'rejected' ? feedback.reason === 'too-large' ? 'Couldn’t save. Maximum 1 MiB of UTF-8 text.'
      : feedback.reason === 'invalid' ? 'Couldn’t save. Use nonblank text up to 1 MiB.'
      : feedback.reason === 'forbidden' ? 'Couldn’t save. Request not permitted.'
      : 'Couldn’t save. Capture is unavailable.' : '';

  return <div className="capture-view">
    <div className="capture-heading"><RouteHeading route="/capture">Capture</RouteHeading></div>
    <div className="capture-actions" aria-busy={feedback.kind === 'saving'}>
      <button type="button" className="capture-button" aria-disabled={!eligible}
        aria-describedby={exception ? `${id}-feedback` : undefined}
        onPointerDown={() => { pointerPress.current = { version: state.draft.version, eligible }; }}
        onPointerCancel={() => { pointerPress.current = null; }}
        onKeyDown={event => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          if (event.repeat || buttonPress.current) event.preventDefault();
          else buttonPress.current = { version: state.draft.version, eligible };
        }}
        onKeyUp={event => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          const started = buttonPress.current;
          if (started && (!started.eligible || started.version !== state.draft.version)) event.preventDefault();
          // Native Space activation happens after keyup; retain its press until then.
          queueMicrotask(() => { buttonPress.current = null; });
        }}
        onBlur={() => { buttonPress.current = null; pointerPress.current = null; }}
        onClick={event => {
          const started = event.detail === 0 ? buttonPress.current : pointerPress.current;
          pointerPress.current = null;
          if (started && (!started.eligible || started.version !== state.draft.version)) return;
          if (eligible) capture();
        }}>{feedback.kind === 'saving' ? 'Saving…' : 'Capture'}</button>
      <p id={`${id}-feedback`} className={`capture-feedback${exception ? ' capture-feedback--exception' : ''}`}
        role="status" aria-live="polite" aria-atomic="true">
        {feedback.kind === 'saved' ? <><span aria-hidden="true">Saved</span>
          <span className="capture-accessible">{feedback.newerDraft ? 'Entry saved. Newer draft kept.' : 'Entry saved.'}</span></> : message}
      </p>
    </div>
    <label className="capture-accessible" htmlFor={`${id}-thought`}>Thought</label>
    <textarea id={`${id}-thought`} className="capture-editor" rows={6} value={state.draft.text}
      aria-describedby={exception ? `${id}-feedback` : undefined}
      onChange={event => edit(event.target.value)}
      onCompositionStart={() => { composing.current = true; }}
      onCompositionEnd={() => { composing.current = false; }}
      onBlur={() => { editorEnterHeld.current = false; }}
      onKeyUp={event => { if (event.key === 'Enter') editorEnterHeld.current = false; }}
      onKeyDown={event => {
        if (event.key !== 'Enter' || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return;
        if (isMobileCaptureDevice(navigator)) return;
        if (composing.current || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
        event.preventDefault();
        if (event.repeat || editorEnterHeld.current) return;
        editorEnterHeld.current = true;
        if (eligible) capture();
      }} />
  </div>;
}
