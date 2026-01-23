/**
 * Memory Loop Backend
 *
 * Entry point for the Hono/Bun server providing:
 * - WebSocket API for real-time communication
 * - REST endpoints for vault management
 * - Claude Agent SDK integration for AI conversations
 * - Memory extraction scheduler (REQ-F-4)
 */

// Initialize SDK provider FIRST, before any other imports that might use it
import { initializeSdkProvider } from "./sdk-provider";
initializeSdkProvider();

import { serverConfig, isTlsEnabled, createHttpRedirectServer, getPort } from "./server";
import { serverLog as log } from "./logger";
import { startScheduler, getCronSchedule } from "./extraction/extraction-manager";

const server = Bun.serve(serverConfig);

const displayHost = server.hostname === "0.0.0.0" ? "localhost" : server.hostname;
const serverPort = getPort();
const httpProtocol = isTlsEnabled() ? "https" : "http";
const wsProtocol = isTlsEnabled() ? "wss" : "ws";

log.info(`Memory Loop Backend running at ${httpProtocol}://${displayHost}:${serverPort}`);
log.info(`WebSocket available at ${wsProtocol}://${displayHost}:${serverPort}/ws`);
log.info(`Health check at ${httpProtocol}://${displayHost}:${serverPort}/api/health`);

// Start HTTP redirect server when TLS is enabled
if (isTlsEnabled()) {
  log.info(`TLS enabled - connections are encrypted`);
  const redirectConfig = createHttpRedirectServer(serverPort);
  const redirectServer = Bun.serve(redirectConfig);
  log.info(
    `HTTP redirect server running at http://${displayHost}:${redirectServer.port} -> https://${displayHost}:${serverPort}`
  );
}

if (server.hostname === "0.0.0.0") {
  log.info(`Server bound to all interfaces (0.0.0.0) - accessible remotely`);
}

// =============================================================================
// Extraction Scheduler (REQ-F-4)
// =============================================================================

// Start the extraction scheduler (disabled in development mode)
// - Performs recovery check if sandbox file exists from interrupted run
// - Triggers catch-up extraction if last run was >24h ago
// - Schedules daily extraction at configured time (default: 3am)
if (process.env.NODE_ENV === "development") {
  log.info("Extraction scheduler disabled in development mode");
} else {
  void startScheduler().then((started) => {
    if (started) {
      log.info(`Extraction scheduler started with schedule: ${getCronSchedule()}`);
    } else {
      log.warn("Extraction scheduler failed to start");
    }
  }).catch((error: unknown) => {
    log.error("Failed to start extraction scheduler:", error);
  });
}
