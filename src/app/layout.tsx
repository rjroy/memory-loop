import type { ReactNode } from 'react';
import type { Metadata, Viewport } from 'next';
import { Suspense } from 'react';
import { connection } from 'next/server';
import PresentationProvider from '../shell/PresentationProvider';
import NextShell from '../shell/NextShell';
import '../styles.css';
import '../recall/recall.css';

export const metadata: Metadata = { title: 'Memory Loop', icons: { icon: 'data:,' }, referrer: 'no-referrer' };
export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover' };

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Request-time SSR makes query hooks available without replacing the whole
  // shell with a client-only fallback. This never reads transport or vault data.
  await connection();
  return <html lang="en"><head>
    <link rel="preload" href="/fonts/im-fell-english-sc/IMFellEnglishSC-Regular.ttf" as="font" type="font/ttf" crossOrigin="anonymous" />
    <link rel="preload" href="/fonts/libre-baskerville/LibreBaskerville-Regular.ttf" as="font" type="font/ttf" crossOrigin="anonymous" />
  </head><body><Suspense fallback={<main id="main-content" tabIndex={-1}><p>Loading Memory Loop…</p></main>}>
    <PresentationProvider><NextShell>{children}</NextShell></PresentationProvider>
  </Suspense></body></html>;
}
