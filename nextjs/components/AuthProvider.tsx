"use client";

import { SessionProvider } from "next-auth/react";

/**
 * Wraps next-auth's SessionProvider for client components.
 * Separate from contexts/SessionContext.tsx which manages app state.
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  return <SessionProvider>{children}</SessionProvider>;
}
