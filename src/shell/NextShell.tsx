'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
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
  const [ground] = useState(() => createGroundSession());
  const ownership = useRef(0);
  useEffect(() => {
    const lease = ++ownership.current;
    // StrictMode replays effect setup on this same instance. Close only after a
    // real departure, not its synchronous cleanup/setup rehearsal.
    return () => { queueMicrotask(() => { if (ownership.current === lease) { session.close(); ground.close(); } }); };
  }, [session, ground]);
  useLayoutEffect(() => {
    session.setLocation({ pathname: location.pathname, search: location.search, hash: location.hash, key: location.key, isNavigating });
    ground.setLocation(location.pathname);
  }, [session, ground, location.pathname, location.search, location.hash, location.key, isNavigating]);

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
