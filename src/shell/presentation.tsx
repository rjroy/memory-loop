'use client';

import { createContext, useContext } from 'react';

export type NavigationType = 'INITIAL' | 'PUSH' | 'REPLACE' | 'POP' | 'HASH';
export interface PresentationNavigationOptions {
  replace?: boolean;
  /** URL bookkeeping does not start a new focus/scroll transition. */
  focus?: 'preserve';
}
export interface PresentationLocation {
  key: string;
  pathname: string;
  search: string;
  hash: string;
  nativeHash?: boolean;
}
export interface RecallPosition {
  readerScroll: number;
  treeScroll: { top: number; left: number };
  narrowOpen: boolean;
  desktopVisible: boolean;
}
export interface Presentation {
  location: PresentationLocation;
  navigationType: NavigationType;
  isNavigating: boolean;
  /** Read immediately before an async context commit, including unrendered intents. */
  navigationGeneration?(): number;
  /** Fresh mounted user selection only: capture ownership of an inherited native
   * Recall fragment before React catches up. Never reacquire in held/async work. */
  claimNativeRecallSelection?(from: PresentationLocation): (() => boolean) | null;
  recallSnapshot?: RecallPosition;
  /** Capture the visible entry before an action changes its presentation. */
  rememberEntry(): void;
  registerRecallCapture(key: string, capture: () => RecallPosition): () => void;
  registerHeading(route: string, element: HTMLHeadingElement): () => void;
  navigate(href: string, options?: PresentationNavigationOptions): void;
  /** Registers a Next Link intent; Next itself performs the navigation. */
  linkIntent(href: string, replace?: boolean): void;
  /** A single active volatile editor may hold a departure before URL mutation. */
  registerNavigationGuard?(guard: (resume: () => void) => boolean): () => void;
  guardNavigation?(href: string, resume: () => void): boolean;
}

export const PresentationContext = createContext<Presentation | null>(null);

export function usePresentation(): Presentation {
  const value = useContext(PresentationContext);
  if (!value) throw new Error('Presentation requires the persistent app layout');
  return value;
}

export function sameQuery(left: string, right: string): boolean {
  return new URLSearchParams(left).toString() === new URLSearchParams(right).toString();
}
