import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register();

// Suppress all console output during tests to keep CI/terminal clean.
// Raw console.* calls throughout the codebase bypass the logger, so we
// silence them here. Tests that need to assert on console output can
// spy on these stubs.
if (process.env.LOG_LEVEL === "silent") {
  const noop = () => {};
  console.log = noop;
  console.info = noop;
  console.warn = noop;
  console.error = noop;
  console.debug = noop;
}
