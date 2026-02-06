/**
 * Active Session Controller Instance
 *
 * Singleton controller for the Next.js server.
 * Manages the live SDK connection and emits streaming events.
 *
 * Uses globalThis to survive module reloading in Next.js dev mode.
 * Without this, webpack HMR resets module-level variables, causing
 * the controller to lose session state mid-stream (e.g., the /answer
 * route gets a fresh controller while the SSE stream runs on the old one).
 */

// Import from backend's streaming module via workspace package
import {
  createActiveSessionController,
  type ActiveSessionController,
  type SessionEvent,
  type SessionState,
  type PendingPrompt,
  type PromptResponse,
} from "@/lib/streaming";
import { initializeSdkProvider } from "@/lib/sdk-provider";

// Re-export types for use in route handlers
export type { SessionEvent, SessionState, PendingPrompt, PromptResponse };

// Attach singleton to globalThis so it survives Next.js dev mode module reloading
const globalForController = globalThis as unknown as {
  __memoryLoopController?: ActiveSessionController;
};

/**
 * Ensures the SDK provider is initialized.
 * Idempotent: safe to call from any API route.
 * Call this in routes that use backend modules requiring the SDK
 * (inspiration, card generation, vault setup, etc.).
 */
export function ensureSdk(): void {
  initializeSdkProvider();
}

/**
 * Gets the singleton Active Session Controller.
 * Initializes the SDK on first call.
 */
export function getController(): ActiveSessionController {
  ensureSdk();

  if (!globalForController.__memoryLoopController) {
    globalForController.__memoryLoopController = createActiveSessionController();
  }
  return globalForController.__memoryLoopController;
}

/**
 * Resets the controller (for testing).
 */
export function resetController(): void {
  if (globalForController.__memoryLoopController) {
    void globalForController.__memoryLoopController.clearSession();
  }
  globalForController.__memoryLoopController = undefined;
}
