/**
 * Memory Loop Backend
 *
 * Entry point for the Hono/Bun server providing:
 * - WebSocket API for real-time communication
 * - REST endpoints for vault management
 * - Claude Agent SDK integration for AI conversations
 */

import { serverConfig } from "./server";

const server = Bun.serve(serverConfig);

console.log(`Memory Loop Backend running at http://localhost:${server.port}`);
console.log(`WebSocket available at ws://localhost:${server.port}/ws`);
console.log(`Health check at http://localhost:${server.port}/api/health`);
