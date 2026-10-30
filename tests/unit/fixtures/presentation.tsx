import { useCallback, useState } from 'react';
import type { ReactNode } from 'react';
import { PresentationContext } from '../../../src/shell/presentation';
import type { Presentation, PresentationLocation, NavigationType } from '../../../src/shell/presentation';
import NextShell from '../../../src/shell/NextShell';

function currentLocation(key: string): PresentationLocation {
  return { key, pathname: window.location.pathname, search: window.location.search, hash: window.location.hash };
}

/** Component-boundary adapter; browser routing is verified separately in Playwright. */
export function TestPresentation({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ location: PresentationLocation; navigationType: NavigationType }>(() => ({ location: currentLocation('initial'), navigationType: 'INITIAL' }));
  const navigate = useCallback((href: string, options?: { replace?: boolean }) => {
    if (options?.replace) window.history.replaceState(null, '', href);
    else window.history.pushState(null, '', href);
    setState({ location: currentLocation(crypto.randomUUID()), navigationType: options?.replace ? 'REPLACE' : 'PUSH' });
  }, []);
  const value: Presentation = {
    ...state, isNavigating: false, navigate,
    linkIntent: () => {}, rememberEntry: () => {},
    registerRecallCapture: () => () => {}, registerHeading: () => () => {},
  };
  return <PresentationContext.Provider value={value}><NextShell>{children}</NextShell></PresentationContext.Provider>;
}
