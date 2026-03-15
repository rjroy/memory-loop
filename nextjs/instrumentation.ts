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

export async function register(
  deps: {
    bootstrapSchedulers?: (log: ReturnType<typeof import("@memory-loop/shared").createLogger>) => Promise<void>;
  } = {}
) {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { createLogger } = await import("@memory-loop/shared");
    const log = createLogger("instrumentation");

    // cwebp availability check moved to daemon startup (REQ-IMAGE-WEBP-15/16)

    if (process.env.NODE_ENV === "production") {
      try {
        const bootstrapSchedulers = deps.bootstrapSchedulers ?? (await import("@/lib/scheduler-bootstrap")).bootstrapSchedulers;
        await bootstrapSchedulers(log);
      } catch (error: unknown) {
        log.error("Failed to bootstrap schedulers", error);
      }
    } else {
      log.info("Schedulers disabled in development mode");
    }
  }
}
