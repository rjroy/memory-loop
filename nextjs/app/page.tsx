/**
 * Next.js App Router Root Page
 *
 * This page redirects to the existing React frontend.
 * In Phase 3, this will serve the migrated frontend.
 */

import { redirect } from "next/navigation";

export default function Home() {
  // During migration, redirect to the Vite frontend
  // This page will be replaced with the actual frontend in Phase 3
  redirect("http://localhost:5173");
}
