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

log.info(`Memory Loop Backend running at http://localhost:${server.port}`);
log.info(`WebSocket available at ws://localhost:${server.port}/ws`);
log.info(`Health check at http://localhost:${server.port}/api/health`);
