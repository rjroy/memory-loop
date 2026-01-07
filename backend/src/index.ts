/**
 * Memory Loop Backend
 *
 * Entry point for the Hono/Bun server providing:
 * - WebSocket API for real-time communication
 * - REST endpoints for vault management
 * - Claude Agent SDK integration for AI conversations
 */

import { serverConfig, isTlsEnabled } from "./server";
import { serverLog as log } from "./logger";

const server = Bun.serve(serverConfig);

const displayHost = server.hostname === "0.0.0.0" ? "localhost" : server.hostname;
const httpProtocol = isTlsEnabled() ? "https" : "http";
const wsProtocol = isTlsEnabled() ? "wss" : "ws";

log.info(`Memory Loop Backend running at ${httpProtocol}://${displayHost}:${server.port}`);
log.info(`WebSocket available at ${wsProtocol}://${displayHost}:${server.port}/ws`);
log.info(`Health check at ${httpProtocol}://${displayHost}:${server.port}/api/health`);
if (isTlsEnabled()) {
  log.info(`TLS enabled - connections are encrypted`);
}
if (server.hostname === "0.0.0.0") {
  log.info(`Server bound to all interfaces (0.0.0.0) - accessible remotely`);
}
