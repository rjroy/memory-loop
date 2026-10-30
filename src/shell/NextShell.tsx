'use client';

import type { ReactNode } from 'react';
import { usePresentation } from './presentation';
import { RecallSessionProvider } from '../recall/RecallSession';
import BrandIdentity from '../components/BrandIdentity';
import AppLink from './AppLink';
import { destinations } from '../navigation';

export default function NextShell({ children }: { children: ReactNode }) {
  const { location } = usePresentation();
  const path = location.pathname.replace(/\/$/, '');
  const mode = destinations.find(destination => destination.path === path)?.label.toLowerCase();
  return <RecallSessionProvider>
    <a className="skip-link" href="#main-content">Skip to content</a>
    <div className={`app-shell${mode ? ` app-shell--${mode}` : ''}`}>
      <header className="app-header">
        <BrandIdentity />
        <nav className="primary-navigation" aria-label="Primary">
          {destinations.map(destination => <AppLink key={destination.path} href={destination.path}
            className="navigation-link" aria-current={path === destination.path ? 'page' : undefined}
            onClick={event => {
              if (path === destination.path && (path === '/recall' || (!location.search && !location.hash)) &&
                event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) event.preventDefault();
            }}>{destination.label}</AppLink>)}
        </nav>
      </header>
      <main className="workspace" id="main-content" tabIndex={-1}>{children}</main>
    </div>
  </RecallSessionProvider>;
}
