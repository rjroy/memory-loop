/**
 * Session Controller
 *
 * Module-level singleton for the daemon process.
 * Unlike the Next.js version (which uses globalThis to survive HMR),
 * the daemon is a stable long-running process, so a plain module-level
 * variable suffices.
 */

import {
  createActiveSessionController,
  type ActiveSessionController,
} from "./streaming";

// Module-level singleton (no globalThis needed in daemon)
let controller: ActiveSessionController | null = null;

/**
 * Gets the singleton Active Session Controller.
 * Creates it on first call.
 */
export function getController(): ActiveSessionController {
  if (!controller) {
    controller = createActiveSessionController();
  }
  return controller;
}

/**
 * Resets the controller (for testing).
 */
export function resetController(): void {
  if (controller) {
    controller.clearSession();
  }
  controller = null;
}
