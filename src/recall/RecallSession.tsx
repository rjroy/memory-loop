import { createContext, useContext, useRef } from 'react';
import type { ReactNode } from 'react';
import type { VaultId } from '../../backend/contract';

export function createRecallSession() {
  return {
    lastId: null as VaultId | null,
    expanded: new Set<string>(),
    desktopVisible: true,
    narrowClosed: false,
    treeScroll: { top: 0, left: 0 },
    readerScroll: 0,
    entries: new Map<string, number>(),
  };
}

const RecallSession = createContext<ReturnType<typeof createRecallSession> | null>(null);

export function RecallSessionProvider({ children }: { children: ReactNode }) {
  const session = useRef(createRecallSession());
  return <RecallSession.Provider value={session.current}>{children}</RecallSession.Provider>;
}

export function useRecallSession() {
  const session = useContext(RecallSession);
  if (!session) throw new Error('Recall needs its shell session');
  return session;
}
