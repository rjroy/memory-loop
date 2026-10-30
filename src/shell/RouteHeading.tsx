'use client';

import { useLayoutEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { usePresentation } from './presentation';

/** The actual leaf heading announces readiness; a streamed old page is not it. */
export default function RouteHeading({ route, children }: { route: string; children: ReactNode }) {
  const heading = useRef<HTMLHeadingElement>(null);
  const { registerHeading } = usePresentation();
  useLayoutEffect(() => {
    if (heading.current) return registerHeading(route, heading.current);
  }, [registerHeading, route]);
  return <h1 id="view-heading" tabIndex={-1} ref={heading}>{children}</h1>;
}
