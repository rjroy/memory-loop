/**
 * Memory Loop Backend
 *
 * Entry point for the Hono/Bun server providing:
 * - WebSocket API for real-time communication
 * - REST endpoints for vault management
 * - Claude Agent SDK integration for AI conversations
 */

import { serverConfig } from "./server";
import { serverLog as log } from "./logger";

const server = Bun.serve(serverConfig);

const displayHost = server.hostname === "0.0.0.0" ? "localhost" : server.hostname;
log.info(`Memory Loop Backend running at http://${displayHost}:${server.port}`);
log.info(`WebSocket available at ws://${displayHost}:${server.port}/ws`);
log.info(`Health check at http://${displayHost}:${server.port}/api/health`);
if (server.hostname === "0.0.0.0") {
  log.info(`Server bound to all interfaces (0.0.0.0) - accessible remotely`);
}
