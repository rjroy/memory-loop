/**
 * Daemon Client Layer
 *
 * Barrel export for all daemon client modules.
 * The web app communicates with the daemon exclusively through these modules.
 */

export {
  daemonFetch,
  DaemonUnavailableError,
  configureDaemonFetchForTesting,
  type FetchFn,
} from "./fetch";

export * as vaultClient from "./vaults";
export * as fileClient from "./files";
export * as sessionClient from "./sessions";
