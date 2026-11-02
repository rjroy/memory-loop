import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { VaultDirectoryResponse, VaultEntry, VaultId, VaultTreeResponse } from '../../backend/contract';
import { idKey, readDirectory, RecallReadError, type RecallFailure } from './api';

export interface DirectoryCache {
  rootIdentity: string | null;
  listings: Map<string, VaultDirectoryResponse>;
  stale: Set<string>;
  full: VaultTreeResponse | null;
}

export function createDirectoryCache(): DirectoryCache {
  return { rootIdentity: null, listings: new Map(), stale: new Set(), full: null };
}

/** Owns view requests; cached metadata belongs only to this shell session. */
export function useDirectoryTree(cache: DirectoryCache, expanded: Set<string>, onRootChange: () => void) {
  const [revision, setRevision] = useState(0);
  const [verified, setVerified] = useState(false);
  const [error, setError] = useState<RecallFailure | null>(null);
  const [failed, setFailed] = useState<Set<string>>(() => new Set());
  const generation = useRef(0);
  const active = useRef(false);
  const pending = useRef(new Set<string>());
  const refreshing = useRef(false);
  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;
  const onRootChangeRef = useRef(onRootChange);
  onRootChangeRef.current = onRootChange;

  const publish = () => { if (active.current) setRevision(value => value + 1); };
  const fetchOne = useCallback(async (id: VaultId, epoch: number) => {
    const key = idKey(id);
    const result = await readDirectory(id, new AbortController().signal);
    if (!active.current || epoch !== generation.current) return;
    if (!id.length) {
      if (cache.rootIdentity !== null && cache.rootIdentity !== result.rootIdentity) {
        cache.listings.clear(); cache.stale.clear(); cache.full = null;
        onRootChangeRef.current();
      }
      cache.rootIdentity = result.rootIdentity;
    } else if (result.rootIdentity !== cache.rootIdentity) {
      // A restart or vault swap mid-flight requires a new root handshake.
      throw new RecallReadError('transport');
    }
    if (id.length) {
      const parent = cache.listings.get(idKey(id.slice(0, -1)));
      const expected = parent?.entries.find(entry => entry.kind === 'directory' && idKey(entry.id) === key);
      if (!expected || expected.identity !== result.directoryIdentity) throw new RecallReadError('transport');
    }
    // A pathname can be replaced while the daemon stays alive. Never attach a
    // previously cached subtree to a different directory identity.
    for (const [cachedKey, listing] of cache.listings) {
      if (listing.id.length !== id.length + 1 || !id.every((part, index) => listing.id[index] === part)) continue;
      const child = result.entries.find(entry => entry.kind === 'directory' && idKey(entry.id) === cachedKey);
      if (!child || child.identity !== listing.directoryIdentity) {
        for (const [candidate, value] of cache.listings) {
          if (listing.id.every((part, index) => value.id[index] === part)) { cache.listings.delete(candidate); cache.stale.delete(candidate); }
        }
      }
    }
    cache.listings.set(key, result);
    cache.stale.delete(key);
    publish();
  }, [cache]);

  const refresh = useCallback(async (refreshExpanded = true) => {
    const epoch = ++generation.current;
    refreshing.current = true;
    pending.current.clear();
    setFailed(new Set());
    try {
      await fetchOne([], epoch);
      if (!active.current || epoch !== generation.current) return;
      setVerified(true); setError(null);
      if (!refreshExpanded) return;
      for (const key of expandedRef.current) {
        let id: VaultId;
        try { id = JSON.parse(key) as VaultId; } catch { continue; }
        if (!cache.listings.has(key)) continue;
        await fetchOne(id, epoch);
      }
    } catch (failure) {
      if (active.current && epoch === generation.current) {
        setError(failure instanceof RecallReadError ? failure.code : 'transport');
      }
      throw failure;
    } finally {
      if (active.current && epoch === generation.current) { refreshing.current = false; publish(); }
    }
  }, [cache, fetchOne]);

  useEffect(() => {
    active.current = true;
    void refresh(false).catch(() => {});
    const focus = () => {
      cache.full = null;
      for (const key of cache.stale) if (!cache.listings.has(key)) cache.stale.delete(key);
      for (const key of cache.listings.keys()) if (key !== '[]') cache.stale.add(key);
      void refresh().catch(() => {});
    };
    window.addEventListener('focus', focus);
    return () => { active.current = false; generation.current++; window.removeEventListener('focus', focus); };
  }, [cache, refresh]);

  useEffect(() => {
    if (!verified || !cache.rootIdentity || refreshing.current) return;
    const epoch = generation.current;
    for (const key of expanded) {
      if (cache.listings.has(key) && !cache.stale.has(key) || pending.current.has(key) || failed.has(key)) continue;
      let id: VaultId;
      try { id = JSON.parse(key) as VaultId; } catch { continue; }
      if (!cache.listings.has(idKey(id.slice(0, -1)))) continue;
      pending.current.add(key);
      void fetchOne(id, epoch).catch(() => { if (active.current && epoch === generation.current) setFailed(previous => new Set(previous).add(key)); })
        .finally(() => { if (epoch === generation.current) pending.current.delete(key); });
    }
  }, [cache, expanded, failed, fetchOne, revision, verified]);

  const retry = useCallback((key: string) => setFailed(previous => { const next = new Set(previous); next.delete(key); return next; }), []);

  const tree = useMemo(() => {
    if (!verified) return error ? { status: 'error' as const, error } : { status: 'loading' as const };
    const root = cache.listings.get('[]');
    if (!root) return { status: 'error' as const, error: error ?? 'transport' as RecallFailure };
    const build = (id: VaultId): VaultEntry[] => (cache.listings.get(idKey(id))?.entries ?? []).map(entry =>
      entry.kind === 'directory' ? { ...entry, children: build(entry.id) } : entry);
    return { status: 'ready' as const, data: { rootIdentity: root.rootIdentity, entries: build([]) } };
  }, [cache, revision, verified, error]);
  return { tree, refresh, failed, retry };
}
