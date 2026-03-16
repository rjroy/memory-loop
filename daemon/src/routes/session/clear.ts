/**
 * Session Clear Endpoint
 *
 * POST /session/clear - Clear the current session
 */

import type { Context } from "hono";
import { getController } from "../../session-controller";

export function sessionClearHandler(c: Context): Response {
  const controller = getController();
  controller.clearSession();
  return c.json({ success: true });
}
