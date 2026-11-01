'use client';

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { usePresentation } from './presentation';
import { RecallSessionProvider } from '../recall/RecallSession';
import BrandIdentity from '../components/BrandIdentity';
import AppLink from './AppLink';
import { destinations } from '../navigation';
import { createThinkSession } from '../think/session';
import { ThinkSessionProvider, useThinkPresentation } from '../think/presentation';
import ThinkNewChatButton from '../think/ThinkNewChatButton';
import { CaptureSessionProvider } from '../capture/CaptureSession';
import { createGroundSession } from '../ground/session';
import { GroundSessionProvider } from '../ground/presentation';
import '../think/think.css';

export default function NextShell({ children }: { children: ReactNode }) {
  const { location, navigate, isNavigating, navigationGeneration } = usePresentation();
  const navigation = useRef(navigate);
  const navigationEpoch = useRef(navigationGeneration);
  navigation.current = navigate;
  navigationEpoch.current = navigationGeneration;
  const [session] = useState(() => createThinkSession({
    navigate: (href, options) => navigation.current(href, options),
    navigationGeneration: () => navigationEpoch.current?.(),
    pointer: {
      read: () => window.sessionStorage.getItem('memory-loop.think.current'),
      write: id => window.sessionStorage.setItem('memory-loop.think.current', id),
    },
  }));
  const [ground] = useState(() => createGroundSession(undefined, id => session.prepareDeletion(id)));
  const thinkState = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  const ownership = useRef(0);
  useEffect(() => {
    const lease = ++ownership.current;
    // StrictMode replays effect setup on this same instance. Close only after a
    // real departure, not its synchronous cleanup/setup rehearsal.
    return () => { queueMicrotask(() => { if (ownership.current === lease) { session.close(); ground.close(); } }); };
  }, [session, ground]);
  useEffect(() => {
    const refresh = () => session.refreshView();
    const visible = () => { if (document.visibilityState === 'visible') refresh(); };
    window.addEventListener('focus', refresh);
    window.addEventListener('pageshow', refresh);
    document.addEventListener('visibilitychange', visible);
    return () => {
      window.removeEventListener('focus', refresh);
      window.removeEventListener('pageshow', refresh);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [session]);
  useLayoutEffect(() => {
    session.setLocation({ pathname: location.pathname, search: location.search, hash: location.hash, key: location.key, isNavigating });
    ground.setLocation(location.pathname);
  }, [session, ground, location.pathname, location.search, location.hash, location.key, isNavigating]);
  useLayoutEffect(() => {
    const view = thinkState.view;
    ground.setView(view.token, view.change, view.status === 'ready' || view.status === 'unavailable');
  }, [ground, thinkState.view.token, thinkState.view.change, thinkState.view.status]);

  return <ThinkSessionProvider session={session}><CaptureSessionProvider><GroundSessionProvider session={ground}>
    <ShellContent>{children}</ShellContent>
  </GroundSessionProvider></CaptureSessionProvider></ThinkSessionProvider>;
}

function ShellContent({ children }: { children: ReactNode }) {
  const { location } = usePresentation();
  const think = useThinkPresentation();
  const path = location.pathname.replace(/\/$/, '');
  const mode = destinations.find(destination => destination.path === path)?.label.toLowerCase();
  return <RecallSessionProvider>
    <a className="skip-link" href="#main-content">Skip to content</a>
    <div className={`app-shell${mode ? ` app-shell--${mode}` : ''}`}>
      <header className="app-header">
        <BrandIdentity />
        <nav className="primary-navigation" aria-label="Primary">
          {destinations.map(destination => <AppLink key={destination.path} href={destination.path === '/think' && think.state.identity
            ? `/think?${new URLSearchParams({ conversation: think.state.identity.conversationId })}` : destination.path}
            className="navigation-link" aria-current={path === destination.path ? 'page' : undefined}
            onClick={event => {
              if (path === destination.path && (path === '/recall' || path === '/think' || (!location.search && !location.hash)) &&
                event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) event.preventDefault();
            }}>{destination.label}</AppLink>)}
        </nav>
        {path === '/think' && <ThinkNewChatButton presentation={think} />}
      </header>
      <main className="workspace" id="main-content" tabIndex={-1}>{children}</main>
    </div>
  </RecallSessionProvider>;
}
