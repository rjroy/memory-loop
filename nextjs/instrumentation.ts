/**
 * Next.js Instrumentation
 *
 * Called once on server startup. Initializes background schedulers.
 *
 * Scheduler imports live inside the NEXT_RUNTIME === "nodejs" block so
 * webpack can dead-code-eliminate them when building for Edge. Webpack
 * replaces NEXT_RUNTIME at compile time, making the branch statically
 * evaluable. An early-return guard doesn't work: webpack still traces
 * imports that appear after the return.
 */

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
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
}
