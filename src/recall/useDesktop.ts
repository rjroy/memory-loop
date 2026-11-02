import { useSyncExternalStore } from 'react';

const desktopQuery = '(min-width: 56rem)';
function subscribe(notify: () => void) {
  const query = window.matchMedia(desktopQuery);
  query.addEventListener('change', notify);
  return () => query.removeEventListener('change', notify);
}
const snapshot = () => window.matchMedia(desktopQuery).matches;
const serverSnapshot = () => false;

export function useDesktop() {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}
