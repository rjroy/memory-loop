'use client';

import Link from 'next/link';
import type { ComponentProps } from 'react';
import { usePresentation } from './presentation';

export default function AppLink({ href, onNavigate, ...props }: ComponentProps<typeof Link> & { href: string }) {
  const { linkIntent, guardNavigation, navigate } = usePresentation();
  return <Link {...props} href={href} scroll={false} onNavigate={event => {
     let prevented = false;
     onNavigate?.({ preventDefault() { prevented = true; event.preventDefault(); } });
     if (prevented) return;
     if (guardNavigation && !guardNavigation(href, () => navigate(href, { replace: props.replace }))) {
       event.preventDefault();
       return;
     }
     linkIntent(href, props.replace);
  }} />;
}
