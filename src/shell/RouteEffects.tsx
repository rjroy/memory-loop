import { useLayoutEffect, useRef } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';
import { destinations } from '../navigation';

type EntryPosition = {
  x: number;
  y: number;
  element: HTMLElement | null;
  elementId: string | null;
};

export default function RouteEffects() {
  const location = useLocation();
  const navigationType = useNavigationType();
  const entries = useRef(new Map<string, EntryPosition>());
  const currentKey = useRef<string | null>(null);

  useLayoutEffect(() => {
    const remember = () => {
      if (currentKey.current === null) return;
      const active = document.activeElement;
      const element = active instanceof HTMLElement && active !== document.body ? active : null;
      entries.current.set(currentKey.current, {
        x: window.scrollX,
        y: window.scrollY,
        element,
        elementId: element?.id || null,
      });
    };

    // Capture the outgoing entry before a link or POP commits a new view.
    document.addEventListener('click', remember, true);
    document.addEventListener('focusin', remember);
    window.addEventListener('scroll', remember, { passive: true });
    window.addEventListener('popstate', remember, true);
    return () => {
      document.removeEventListener('click', remember, true);
      document.removeEventListener('focusin', remember);
      window.removeEventListener('scroll', remember);
      window.removeEventListener('popstate', remember, true);
    };
  }, []);

  useLayoutEffect(() => {
    if (location.pathname === '/') return;

    const path = location.pathname.replace(/\/$/, '');
    const title = destinations.find(destination => destination.path === path)?.label ?? 'Page not found';
    document.title = `${title} · Memory Loop`;

    const firstView = currentKey.current === null;
    const saved = entries.current.get(location.key);
    currentKey.current = location.key;
    if (firstView) return;

    const heading = document.querySelector<HTMLElement>('#main-content h1');
    if (heading && !heading.hasAttribute('tabindex')) heading.tabIndex = -1;
    const target = navigationType === 'POP' && saved
      ? (saved.element?.isConnected ? saved.element :
        (saved.elementId ? document.getElementById(saved.elementId) : null)) ?? heading
      : heading;
    target?.focus({ preventScroll: true });

    if (navigationType === 'POP') {
      if (!saved) return;
      // Reapply the saved position after browser restoration, without a top reset.
      const frame = window.requestAnimationFrame(() => {
        if (window.scrollX !== saved.x || window.scrollY !== saved.y) {
          window.scrollTo(saved.x, saved.y);
        }
      });
      return () => window.cancelAnimationFrame(frame);
    }

    if (window.scrollX !== 0 || window.scrollY !== 0) window.scrollTo(0, 0);
  }, [location.key, location.pathname, navigationType]);

  return null;
}
