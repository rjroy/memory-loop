'use client';

import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react';
import type { GroundSession } from './session';

const Context = createContext<GroundSession | null>(null);
export function GroundSessionProvider({ session, children }: { session: GroundSession; children: ReactNode }) {
  return <Context.Provider value={session}>{children}</Context.Provider>;
}
export function useGround() {
  const session = useContext(Context);
  if (!session) throw new Error('Ground requires the persistent app shell');
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  return { state, retry: session.retry };
}
