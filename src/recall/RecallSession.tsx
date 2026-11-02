import { createContext, useContext, useRef } from 'react';
import type { ReactNode } from 'react';
import type { VaultId, VaultSearchContextRequest } from '../../backend/contract';
import { createRecallEditor } from './editor';
import { createAttachmentUploads } from './attachments';
import { createRecallSearch } from './searchState';

export function createRecallSession() {
  return {
    editor: createRecallEditor(),
    uploads: createAttachmentUploads(),
    search: createRecallSearch(),
    normalReaderPositions: new Map<string, number>(),
    lastExcerpt: null as VaultSearchContextRequest | null,
    lastId: null as VaultId | null,
    expanded: new Set<string>(),
    desktopVisible: true,
    narrowClosed: false,
    treeScroll: { top: 0, left: 0 },
    readerScroll: 0,
    fileActionFenced: false,
    fileActionAffectedId: null as VaultId | null,
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
