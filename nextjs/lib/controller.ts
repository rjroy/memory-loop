/**
 * Active Session Controller Instance
 *
 * Singleton controller for the Next.js server.
 * Manages the live SDK connection and emits streaming events.
 */

// Import from backend's streaming module via workspace package
import {
  createActiveSessionController,
  type ActiveSessionController,
  type SessionEvent,
  type SessionState,
  type PendingPrompt,
  type PromptResponse,
} from "@memory-loop/backend/streaming";
import { initializeSdkProvider } from "@memory-loop/backend/sdk-provider";

// Re-export types for use in route handlers
export type { SessionEvent, SessionState, PendingPrompt, PromptResponse };

// Singleton instance
let controller: ActiveSessionController | null = null;
let sdkInitialized = false;

/**
 * Gets the singleton Active Session Controller.
 * Initializes the SDK on first call.
 */
export function getController(): ActiveSessionController {
  // Initialize SDK on first access (server-side singleton)
  if (!sdkInitialized) {
    initializeSdkProvider();
    sdkInitialized = true;
  }

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
    void controller.clearSession();
  }
  controller = null;
}
