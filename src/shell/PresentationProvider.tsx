'use client';

import { useCallback, useLayoutEffect, useReducer, useRef, useState, useTransition } from 'react';
import type { ReactNode } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { destinations } from '../navigation';
import { PresentationContext, sameQuery } from './presentation';
import type { NavigationType, PresentationLocation, PresentationNavigationOptions, RecallPosition } from './presentation';

// Next owns pushes/replacements; native traversal can be cancelled before entry
// change while an editor holds a draft. No history state or entries are rewritten.
interface BrowserEntry { readonly key: string; readonly url: string | null }
interface EntryChange extends Event { readonly from: BrowserEntry; readonly navigationType: 'push' | 'replace' | 'traverse' | 'reload' | null }
interface BrowserNavigation extends EventTarget { readonly currentEntry: BrowserEntry | null; traverseTo(key: string): { finished: Promise<unknown> } }
interface NavigationAttempt extends Event { destination: BrowserEntry; navigationType: string; hashChange: boolean; canIntercept: boolean }
type WindowPosition = { x: number; y: number; element: HTMLElement | null; elementId: string | null };
type Snapshot = { location: PresentationLocation; window?: WindowPosition; recall?: RecallPosition; prepared: boolean };
type View = { location: PresentationLocation; navigationType: NavigationType; recallSnapshot?: RecallPosition };
type Repair = { requested: boolean };
type Visit = { view: View; url: string; generation: number; repair: Repair | null; published: boolean; entryEffect: NavigationType | null; inheritFrom?: string };
type Intent = { url: string; navigationType: 'PUSH' | 'REPLACE'; generation: number; focus?: 'preserve' };
const relative = (url: URL) => `${url.pathname}${url.search}${url.hash}`;
const asLocation = (url: URL, key: string, nativeHash = false): PresentationLocation => ({ key, pathname: url.pathname, search: url.search, hash: url.hash, nativeHash });
const sameContent = (a: PresentationLocation, b: PresentationLocation) => a.pathname === b.pathname && sameQuery(a.search, b.search);
const headingRoute = (path: string) => destinations.some(destination => destination.path === path) ? path : 'not-found';
const copyRecall = (position: RecallPosition | undefined) => position ? { ...position, treeScroll: { ...position.treeScroll } } : undefined;
const asView = (snapshot: Snapshot, navigationType: NavigationType): View => ({
  location: snapshot.location, navigationType, recallSnapshot: copyRecall(snapshot.recall),
});

function browserNavigation(): BrowserNavigation | null {
  const candidate: unknown = Reflect.get(window, 'navigation');
  if (!(candidate instanceof EventTarget) || !('currentEntry' in candidate)) return null;
  const entry: unknown = candidate.currentEntry;
  if (typeof entry !== 'object' || entry === null || !('key' in entry) || typeof entry.key !== 'string' || !entry.key) return null;
  return candidate as BrowserNavigation;
}

export default function PresentationProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const [committed, setCommitted] = useState<View>(() => ({
    location: { key: 'initial', pathname, search: search ? `?${search}` : '', hash: '' }, navigationType: 'INITIAL',
  }));
  const rendered = useRef(committed);
  const snapshots = useRef(new Map<string, Snapshot>());
  const navigation = useRef<BrowserNavigation | null>(null);
  const visit = useRef<Visit | null>(null);
  const intent = useRef<Intent | null>(null);
  const generation = useRef(0);
  const navigationGeneration = useCallback(() => generation.current, []);
  const claimNativeRecallSelection = useCallback((from: PresentationLocation): (() => boolean) | null => {
    const item = visit.current;
    const displayed = rendered.current.location;
    // A current URL alone cannot authorize superseding an unrendered departure.
    // Only the coordinator's inherited HASH visit belongs to this mounted view.
    if (!mounted.current || intent.current || from.pathname !== '/recall' ||
      displayed.key !== from.key || !sameContent(displayed, from) || displayed.hash !== from.hash ||
      !item || item.view.navigationType !== 'HASH' || item.inheritFrom !== from.key ||
      !sameContent(item.view.location, from) || item.generation !== generation.current ||
      navigation.current?.currentEntry?.key !== item.view.location.key || relative(new URL(window.location.href)) !== item.url) return null;
    const ownedGeneration = generation.current;
    return () => mounted.current && !intent.current && visit.current === item && generation.current === ownedGeneration &&
      navigation.current?.currentEntry?.key === item.view.location.key && relative(new URL(window.location.href)) === item.url;
  }, []);
  const liveRecall = useRef<{ key: string; capture: () => RecallPosition } | null>(null);
  const departureGuard = useRef<((resume: () => void) => boolean) | null>(null);
  const approvedTraversal = useRef<string | null>(null);
  const mounted = useRef(false);
  const notified = useRef(false);
  const applying = useRef(false);
  const heading = useRef<{ route: string; element: HTMLHeadingElement } | null>(null);
  const headingFocus = useRef<Visit | null>(null);
  const [revision, changed] = useReducer((value: number) => value + 1, 0);
  const [preparing, startTransition] = useTransition();
  const [completedRepair, setCompletedRepair] = useState<Repair | null>(null);
  const [unsupported, setUnsupported] = useState(false);

  // currententrychange also fires inside Next's insertion effect. Capture there
  // synchronously, but notify React after that effect rather than updating in it.
  const notify = useCallback(() => {
    if (notified.current) return;
    notified.current = true;
    queueMicrotask(() => { notified.current = false; if (mounted.current) changed(); });
  }, []);

  const capture = useCallback((key: string, pane = true) => {
    if (applying.current) return;
    const target = snapshots.current.get(key);
    const activeVisit = visit.current;
    if (!target || activeVisit?.view.location.key !== key) return;
    const inherited = activeVisit.view.navigationType === 'HASH' && activeVisit.inheritFrom === rendered.current.location.key;
    if (!activeVisit.published && !inherited) return;
    const focused = document.activeElement;
    const element = focused instanceof HTMLElement && focused !== document.body ? focused : null;
    target.window = { x: window.scrollX, y: window.scrollY, element, elementId: element?.id || null };
    const recall = liveRecall.current;
    if (pane && recall && (recall.key === key || (inherited && recall.key === activeVisit.inheritFrom))) {
      target.recall = copyRecall(recall.capture());
    }
  }, []);
  const rememberEntry = useCallback(() => {
    if (intent.current) return; // the outgoing snapshot is already frozen
    const key = navigation.current?.currentEntry?.key;
    if (key) capture(key);
  }, [capture]);
  const registerRecallCapture = useCallback((key: string, read: () => RecallPosition) => {
    const registration = { key, capture: read };
    liveRecall.current = registration;
    return () => { if (liveRecall.current === registration) liveRecall.current = null; };
  }, []);
  const focusHeading = useCallback(() => {
    const item = headingFocus.current;
    const target = heading.current;
    if (!item?.published || visit.current !== item || item.generation !== generation.current ||
        navigation.current?.currentEntry?.key !== item.view.location.key || relative(new URL(window.location.href)) !== item.url ||
        target?.route !== headingRoute(item.view.location.pathname) || !target.element.isConnected) return;
    applying.current = true;
    try { target.element.focus({ preventScroll: true }); } finally { applying.current = false; }
    headingFocus.current = null;
  }, []);
  const registerHeading = useCallback((route: string, element: HTMLHeadingElement) => {
    if (visit.current && route !== headingRoute(visit.current.view.location.pathname)) return () => {};
    const registration = { route, element };
    heading.current = registration;
    focusHeading();
    return () => { if (heading.current === registration) heading.current = null; };
  }, [focusHeading]);

  const registerNavigationGuard = useCallback((guard: (resume: () => void) => boolean) => {
    departureGuard.current = guard;
    return () => { if (departureGuard.current === guard) departureGuard.current = null; };
  }, []);
  const guardNavigation = useCallback((href: string, resume: () => void) => {
    const target = new URL(href, window.location.href);
    const current = new URL(window.location.href);
    if (target.origin === current.origin && target.pathname === current.pathname && sameQuery(target.search, current.search)) return true;
    return departureGuard.current?.(resume) ?? true;
  }, []);

  const linkIntent = useCallback((href: string, replace = false, focus?: 'preserve') => {
    const url = new URL(href, window.location.href);
    if (url.origin !== window.location.origin) throw new Error('App navigation must be same-origin');
    rememberEntry();
    intent.current = { url: relative(url), navigationType: replace ? 'REPLACE' : 'PUSH', generation: ++generation.current, focus };
    notify();
  }, [notify, rememberEntry]);
  const commitNavigation = useCallback((href: string, options?: PresentationNavigationOptions) => {
    linkIntent(href, options?.replace, options?.focus);
    if (options?.replace) router.replace(href, { scroll: false });
    else router.push(href, { scroll: false });
  }, [linkIntent, router]);
  const navigate = useCallback((href: string, options?: PresentationNavigationOptions) => {
    if (guardNavigation(href, () => commitNavigation(href, options))) commitNavigation(href, options);
  }, [guardNavigation, commitNavigation]);

  useLayoutEffect(() => {
    mounted.current = true;
    const source = browserNavigation();
    const initialKey = source?.currentEntry?.key;
    if (!source || !initialKey) { setUnsupported(true); return () => { mounted.current = false; }; }
    navigation.current = source;
    const initial: Snapshot = { location: asLocation(new URL(window.location.href), initialKey), prepared: true };
    snapshots.current.set(initialKey, initial);
    const initialView = asView(initial, 'INITIAL');
    visit.current = { view: initialView, url: relative(new URL(window.location.href)), generation: generation.current, repair: null, published: false, entryEffect: 'INITIAL' };
    setCommitted(initialView);

    const navigating = (raw: Event) => {
      const event = raw as NavigationAttempt;
      if (event.navigationType !== 'traverse' || !event.destination.url || !event.cancelable) return;
      if (approvedTraversal.current === event.destination.key) { approvedTraversal.current = null; return; }
      const allowed = guardNavigation(event.destination.url, () => {
        approvedTraversal.current = event.destination.key;
        source.traverseTo(event.destination.key).finished.catch(() => { approvedTraversal.current = null; });
      });
      if (!allowed) event.preventDefault();
    };

    const entryChanged = (event: Event) => {
      const change = event as EntryChange;
      const key = source.currentEntry?.key;
      if (!key) return;
      const url = new URL(window.location.href);
      const targetURL = relative(url);
      const previous = visit.current;
      // A same-slot, same-URL replacement is Next's state preparation, not a new
      // visit. Completion still needs the transition request marker below.
      if (previous?.view.location.key === key && previous.url === targetURL) { notify(); return; }
      if (!destinations.some(destination => destination.path === url.pathname)) return;
      const from = snapshots.current.get(change.from.key);
      const requested = intent.current?.url === targetURL ? intent.current : null;
      if (!intent.current) capture(change.from.key);
      const nativeHash = !requested && (change.navigationType === 'push' || change.navigationType === 'replace') && from &&
        from.location.pathname === url.pathname && sameQuery(from.location.search, url.search) && from.location.hash !== url.hash;
      let snapshot = snapshots.current.get(key);
      if (!snapshot) {
        snapshot = { location: asLocation(url, key, Boolean(nativeHash)), prepared: false };
        if (nativeHash && from) {
          snapshot.window = from.window ? { ...from.window } : undefined;
          snapshot.recall = copyRecall(from.recall);
        }
        snapshots.current.set(key, snapshot);
      } else {
        snapshot.location = asLocation(url, key, Boolean(nativeHash) || (snapshot.location.nativeHash && sameContent(snapshot.location, asLocation(url, key))));
        if (!requested && change.navigationType === 'replace') snapshot.prepared = false;
      }
      const action = requested?.navigationType ?? (change.navigationType === 'traverse' ? 'POP' : nativeHash ? 'HASH' : change.navigationType === 'push' ? 'PUSH' : 'REPLACE');
      const intermediate = intent.current && !requested && !nativeHash && change.navigationType !== 'traverse';
      const epoch = requested?.generation ?? (intermediate ? generation.current - 1 : ++generation.current);
      if (!intermediate) intent.current = null;
      // A bookkeeping replacement has no new entry effects. If a genuine route
      // visit on this same browser slot has not committed yet, carry its pending
      // focus/scroll work through canonicalization instead of losing it. This
      // belongs only to this visit, never its saved snapshot or a future POP.
      const entryEffect = requested?.focus === 'preserve'
        ? action === 'REPLACE' && previous?.view.location.key === key && previous.view.location.pathname === url.pathname && !previous.published
          ? previous.entryEffect : null
        : action;
      const nextVisit: Visit = {
        view: asView(snapshot, action), url: targetURL, generation: epoch,
        repair: requested || snapshot.prepared ? null : { requested: false }, published: false,
        entryEffect,
        inheritFrom: nativeHash ? change.from.key : undefined,
      };
      // Recall may replace its bare URL before its streamed H1 arrives. Keep
      // that route-entry focus request on the same browser slot through replace.
      headingFocus.current = headingFocus.current === previous && previous?.view.location.key === key ? nextVisit : null;
      visit.current = nextVisit;
      notify();
    };
    const rememberFocusOrScroll = () => {
      const key = source.currentEntry?.key;
      if (!key) return;
      // Native Skip's final focus can arrive after a newer selection intent. Save
      // that live focus under the hash entry, but never save the closing B pane as A.
      if (!intent.current) capture(key);
      else if (visit.current?.view.navigationType === 'HASH') capture(key, false);
    };
    source.addEventListener('currententrychange', entryChanged);
    source.addEventListener('navigate', navigating);
    document.addEventListener('click', rememberEntry, true);
    document.addEventListener('focusin', rememberFocusOrScroll);
    window.addEventListener('scroll', rememberFocusOrScroll, { passive: true });
    return () => {
      mounted.current = false;
      source.removeEventListener('currententrychange', entryChanged);
      source.removeEventListener('navigate', navigating);
      document.removeEventListener('click', rememberEntry, true);
      document.removeEventListener('focusin', rememberFocusOrScroll);
      window.removeEventListener('scroll', rememberFocusOrScroll);
    };
  }, [capture, notify, rememberEntry, guardNavigation]);

  const active = visit.current;
  const matches = (location: PresentationLocation) => location.pathname === pathname && sameQuery(location.search, search);
  const display = active && !intent.current && !active.repair && active.generation === generation.current && matches(active.view.location) ? active.view : committed;

  useLayoutEffect(() => {
    const item = visit.current;
    if (!item || intent.current || item.generation !== generation.current || item.published) return;
    const isCurrent = () => visit.current === item && item.generation === generation.current &&
      navigation.current?.currentEntry?.key === item.view.location.key && relative(new URL(window.location.href)) === item.url;
    if (!isCurrent()) return;
    const repair = item.repair;
    if (repair) {
      if (!repair.requested) {
        repair.requested = true;
        startTransition(() => {
          if (!isCurrent()) return;
          router.replace(item.url, { scroll: false });
          setCompletedRepair(repair);
        });
        return;
      }
      if (preparing || completedRepair !== repair || !matches(item.view.location)) return;
      // This particular replacement has committed, not merely matching hooks
      // left over from before it was requested.
      item.repair = null;
      notify();
      return;
    }
    if (!matches(item.view.location)) return;
    const snapshot = snapshots.current.get(item.view.location.key);
    if (!snapshot) return;
    snapshot.prepared = true;
    item.published = true;
    const previous = rendered.current.location;
    rendered.current = item.view;
    setCommitted(item.view);
    const { location } = item.view;
    if (location.pathname !== '/recall') {
      const title = destinations.find(destination => destination.path === location.pathname)?.label ?? 'Page not found';
      document.title = `${title} · Memory Loop`;
    }
    const entryEffect = item.entryEffect;
    if (entryEffect === null) { focusHeading(); return; } // Only an already-pending route-heading request can run.
    if (entryEffect === 'INITIAL' || entryEffect === 'HASH') return;
    const hashTraversal = entryEffect === 'POP' && (location.nativeHash || (sameContent(previous, location) && previous.hash !== location.hash));
    if (location.pathname === '/recall' && previous.pathname === '/recall' && !hashTraversal) { focusHeading(); return; }
    const saved = snapshot.window;
    const restored = saved?.elementId === 'view-heading' ? null : saved?.element?.isConnected ? saved.element : saved?.elementId ? document.getElementById(saved.elementId) : null;
    if (entryEffect === 'POP' && (location.pathname !== '/recall' || hashTraversal) && restored) {
      applying.current = true;
      try { restored.focus({ preventScroll: true }); } finally { applying.current = false; }
    } else { headingFocus.current = item; focusHeading(); }
    if (entryEffect === 'POP' && saved) {
      const frame = requestAnimationFrame(() => { if (isCurrent()) window.scrollTo(saved.x, saved.y); });
      return () => cancelAnimationFrame(frame);
    }
    if (entryEffect !== 'POP') window.scrollTo(0, 0);
  }, [pathname, search, preparing, completedRepair, revision, notify, router, startTransition, focusHeading]);

  if (unsupported) return <main id="main-content"><h1>Browser update required</h1><p>Memory Loop requires an updated browser with the Navigation API.</p></main>;
  return <PresentationContext.Provider value={{ ...display, isNavigating: Boolean(intent.current || (active && !active.published)), navigationGeneration, claimNativeRecallSelection, rememberEntry, registerRecallCapture, registerHeading, navigate, linkIntent, registerNavigationGuard, guardNavigation }}>
    {children}
  </PresentationContext.Provider>;
}
