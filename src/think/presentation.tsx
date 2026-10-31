'use client';

import { createContext, useContext, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import type { ThinkSession, ThinkSessionState } from './session';
import type { ThinkPresentation } from './types';

const SessionContext = createContext<ThinkSession | null>(null);

/** Mount once in the persistent shell; the owner supplies and closes the session. */
export function ThinkSessionProvider({ session, children }: { session: ThinkSession; children: ReactNode }) {
  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
}

/** This is the read-side bootstrap, not yet the full ThinkPresentation contract. */
export function useThinkSession(): { session: ThinkSession; state: ThinkSessionState } {
  const session = useContext(SessionContext);
  if (!session) throw new Error('Think session requires the persistent app shell');
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  return { session, state };
}

export function useThinkPresentation(): ThinkPresentation {
  const session = useContext(SessionContext);
  if (!session) throw new Error('Think session requires the persistent app shell');
  return useSyncExternalStore(session.subscribe, session.getPresentation, session.getPresentation);
}
