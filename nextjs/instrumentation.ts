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
    checkCwebpAvailability?: () => Promise<boolean>;
    bootstrapSchedulers?: (log: ReturnType<typeof import("@/lib/logger").createLogger>) => Promise<void>;
  } = {}
) {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { createLogger } = await import("@/lib/logger");
    const log = createLogger("instrumentation");

    // Check cwebp binary availability on startup (REQ-IMAGE-WEBP-15)
    const checkCwebpAvailability = deps.checkCwebpAvailability ?? (await import("@/lib/utils/image-converter")).checkCwebpAvailability;
    await checkCwebpAvailability();
    // Server continues regardless of result (REQ-IMAGE-WEBP-16)

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
