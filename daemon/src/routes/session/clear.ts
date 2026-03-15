/**
 * Session Clear Endpoint
 *
 * POST /session/clear - Clear the current session
 */

import type { Context } from "hono";
import { getController } from "../../session-controller";

export async function sessionClearHandler(c: Context): Promise<Response> {
  const controller = getController();
  controller.clearSession();
  return c.json({ success: true });
}
