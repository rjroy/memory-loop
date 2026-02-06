/**
 * Next.js Instrumentation
 *
 * Called once on server startup. Initializes background schedulers.
 *
 * The production import is inside an explicit NODE_ENV === "production"
 * branch so that turbopack (dev) can dead-code-eliminate it and never
 * trace into scheduler dependencies (cron's child_process, node:crypto).
 * See lib/scheduler-bootstrap.ts.
 */

export async function register() {
  // Only run schedulers on the server, not during build or edge runtime
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { createLogger } = await import("@/lib/logger");
  const log = createLogger("instrumentation");

  if (process.env.NODE_ENV === "production") {
    try {
      const { bootstrapSchedulers } = await import(
        "@/lib/scheduler-bootstrap"
      );
      await bootstrapSchedulers(log);
    } catch (error: unknown) {
      log.error("Failed to bootstrap schedulers", error);
    }
  } else {
    log.info("Schedulers disabled in development mode");
  }
}
