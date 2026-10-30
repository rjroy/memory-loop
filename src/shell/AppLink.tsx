'use client';

import Link from 'next/link';
import type { ComponentProps } from 'react';
import { usePresentation } from './presentation';

export default function AppLink({ href, onNavigate, ...props }: ComponentProps<typeof Link> & { href: string }) {
  const { linkIntent } = usePresentation();
  return <Link {...props} href={href} scroll={false} onNavigate={event => {
    onNavigate?.(event);
    linkIntent(href, props.replace);
  }} />;
}
