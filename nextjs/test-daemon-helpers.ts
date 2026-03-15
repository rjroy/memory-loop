/**
 * Test Daemon Helpers
 *
 * Provides an in-process daemon for nextjs tests that need vault operations.
 * Uses the daemon's Hono app directly via app.request() so tests don't
 * need a running daemon process.
 *
 * Usage in test files:
 *   import { setupTestDaemon } from "../../test-daemon-helpers";
 *
 *   let cleanupDaemon: () => void;
 *   beforeEach(async () => { cleanupDaemon = await setupTestDaemon(); });
 *   afterEach(() => { cleanupDaemon(); });
 */

import { createApp } from "@memory-loop/daemon/server";
import { resetCache } from "@memory-loop/daemon/vault";
import { configureDaemonFetchForTesting } from "./lib/daemon-fetch";

/**
 * Set up an in-process daemon and configure daemon-fetch to use it.
 * Call this in beforeEach after setting VAULTS_DIR.
 * Returns a cleanup function to call in afterEach.
 *
 * Does NOT pre-populate the vault cache. The cache starts empty with a stale
 * timestamp so every getVaults() call refreshes from disk. This lets tests
 * create vault directories after setup and still have them discovered.
 *
 * Configures the shared daemon-fetch layer, which means all client facades
 * (vault-client, file-client) route through the in-process daemon.
 */
export function setupTestDaemon(): () => void {
  const app = createApp(Date.now());

  // Reset cache so it starts empty and stale (timestamp 0).
  // Every getVaults() call will re-discover from VAULTS_DIR.
  resetCache();

  // Configure shared daemon-fetch to route through the in-process daemon
  const cleanupFetch = configureDaemonFetchForTesting(async (path, init) => {
    return app.request(path, init);
  });

  return () => {
    cleanupFetch();
    resetCache();
  };
}
