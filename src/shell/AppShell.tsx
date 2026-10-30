import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { destinations } from '../navigation';
import RouteEffects from './RouteEffects';
import { RecallSessionProvider } from '../recall/RecallSession';

export default function AppShell() {
  const location = useLocation();

  return (
    <RecallSessionProvider>
      <a className="skip-link" href="#main-content">Skip to content</a>
      <div className={`app-shell${location.pathname.replace(/\/$/, '') === '/recall' ? ' app-shell--recall' : ''}`}>
        <div className="shell-navigation">
          <header className="app-name">Memory Loop</header>
          <nav className="primary-navigation" aria-label="Primary">
            {destinations.map(({ label, path }) => (
              <NavLink
                key={path}
                to={path}
                end
                caseSensitive
                className="navigation-link"
                onClick={(event) => {
                  if (
                    location.pathname.replace(/\/$/, '') === path && (path === '/recall' || (!location.search && !location.hash)) &&
                    event.button === 0 && !event.metaKey && !event.ctrlKey &&
                    !event.shiftKey && !event.altKey
                  ) event.preventDefault();
                }}
              >
                {label}
              </NavLink>
            ))}
          </nav>
        </div>
        <main className="workspace" id="main-content" tabIndex={-1}>
          <Outlet />
        </main>
      </div>
      <RouteEffects />
    </RecallSessionProvider>
  );
}
