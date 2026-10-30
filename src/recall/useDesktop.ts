import { useCallback, useMemo, useSyncExternalStore } from 'react';

export function useDesktop() {
  const query = useMemo(() => window.matchMedia('(min-width: 56rem)'), []);
  const subscribe = useCallback((notify: () => void) => {
    query.addEventListener('change', notify);
    return () => query.removeEventListener('change', notify);
  }, [query]);
  return useSyncExternalStore(subscribe, () => query.matches);
}
