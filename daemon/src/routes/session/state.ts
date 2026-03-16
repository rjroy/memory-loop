/**
 * Session State Endpoint
 *
 * GET /session/state - Get current session state
 */

import type { Context } from "hono";
import { getController } from "../../session-controller";

export function sessionStateHandler(c: Context): Response {
  const controller = getController();
  const state = controller.getState();
  return c.json(state);
}
