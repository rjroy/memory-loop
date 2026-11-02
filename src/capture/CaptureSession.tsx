'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { captureThought } from './client';
import type { CaptureResult } from './client';

type Feedback =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved'; newerDraft: boolean }
  | Exclude<CaptureResult, { kind: 'saved' }>;

interface CaptureState {
  draft: { text: string; version: number };
  feedback: Feedback;
}
interface CapturePresentation {
  state: CaptureState;
  edit(text: string): void;
  capture(): void;
}

const CaptureContext = createContext<CapturePresentation | null>(null);

/** Owned by the persistent shell, never by a route mount or a module singleton. */
export function CaptureSessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<CaptureState>({ draft: { text: '', version: 0 }, feedback: { kind: 'idle' } });
  const current = useRef(state);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  const publish = useCallback((next: CaptureState) => {
    current.current = next;
    setState(next);
  }, []);

  const edit = useCallback((text: string) => {
    const previous = current.current;
    publish({
      draft: { text, version: previous.draft.version + 1 },
      feedback: previous.feedback.kind === 'saved' ? { kind: 'idle' } : previous.feedback,
    });
  }, [publish]);

  const capture = useCallback(() => {
    const previous = current.current;
    if (previous.feedback.kind === 'saving' || !previous.draft.text.trim()) return;
    const submitted = previous.draft;
    // Publish synchronously before dispatch: two activations in one render still send once.
    publish({ ...previous, feedback: { kind: 'saving' } });
    void captureThought(submitted.text).then(result => {
      if (!alive.current) return; // A destroyed shell has no presentation to update; the write is not cancelled.
      const latest = current.current;
      if (result.kind !== 'saved') {
        publish({ ...latest, feedback: result });
        return;
      }
      const newerDraft = latest.draft.version !== submitted.version;
      publish({
        draft: newerDraft ? latest.draft : { text: '', version: latest.draft.version + 1 },
        feedback: { kind: 'saved', newerDraft },
      });
    });
  }, [publish]);

  useEffect(() => {
    if (state.feedback.kind !== 'saved') return;
    const feedback = state.feedback;
    const timer = setTimeout(() => {
      if (current.current.feedback === feedback) publish({ ...current.current, feedback: { kind: 'idle' } });
    }, 3000);
    return () => clearTimeout(timer);
  }, [state.feedback, publish]);

  return <CaptureContext.Provider value={{ state, edit, capture }}>{children}</CaptureContext.Provider>;
}

export function useCapture(): CapturePresentation {
  const presentation = useContext(CaptureContext);
  if (!presentation) throw new Error('Capture requires its persistent shell session');
  return presentation;
}
