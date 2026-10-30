import { useEffect, useLayoutEffect, useState } from 'react';
import { RecallReadError } from './api';
import type { RecallFailure } from './api';

type ReadState<T> =
  | { status: 'idle' | 'loading'; data?: never; error?: never }
  | { status: 'ready'; data: T; error?: never }
  | { status: 'error'; data?: never; error: RecallFailure };

/** Each short read owns its generation. Abort alone is not a stale-commit guard. */
export function useVaultRead<T>(key: string | null, revision: number, read: (key: string, signal: AbortSignal) => Promise<T>): ReadState<T> {
  const [result, setResult] = useState<{ key: string | null; revision: number; state: ReadState<T> } | null>(null);
  // A -> pending B -> Back to A must refetch, not resurrect A's earlier body as fresh.
  useLayoutEffect(() => { setResult(null); }, [key, revision]);
  useEffect(() => {
    if (key === null) return;
    let active = true;
    const controller = new AbortController();
    read(key, controller.signal).then(
      data => { if (active) setResult({ key, revision, state: { status: 'ready', data } }); },
      (error: unknown) => { if (active) setResult({ key, revision, state: { status: 'error', error: error instanceof RecallReadError ? error.code : 'transport' } }); },
    );
    return () => { active = false; controller.abort(); };
  }, [key, revision, read]);
  if (key === null) return { status: 'idle' };
  // Never render a previous file's body under the new file's identity, even for one paint.
  return result?.key === key && result.revision === revision ? result.state : { status: 'loading' };
}
