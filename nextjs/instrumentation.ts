/**
 * Next.js Instrumentation
 *
 * Called once on server startup. Background schedulers have moved to the
 * daemon process (Stage 4). This file remains for any future Node.js-only
 * initialization that must run inside the Next.js process.
 */

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { createLogger } = await import("@memory-loop/shared");
    const log = createLogger("instrumentation");
    log.info("Next.js instrumentation registered (schedulers run in daemon)");
  }
}
