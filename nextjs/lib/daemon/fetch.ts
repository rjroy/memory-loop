/**
 * Daemon Fetch Module
 *
 * Provides the HTTP connection layer for all daemon client modules
 * (vaults, files, sessions). Handles Unix socket and TCP port resolution,
 * error wrapping, and test injection.
 */

// ---------------------------------------------------------------------------
// DaemonUnavailableError
// ---------------------------------------------------------------------------

/**
 * Thrown when the daemon is unreachable.
 * Callers can catch this to distinguish "no data" from "daemon down."
 */
export class DaemonUnavailableError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "DaemonUnavailableError";
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FetchFn = (path: string, init?: RequestInit) => Promise<Response>;

// ---------------------------------------------------------------------------
// Provider pattern for testability
// ---------------------------------------------------------------------------

let _fetchFn: FetchFn | null = null;
let _initialized = false;

function getSocketPath(): string {
  if (process.env.DAEMON_SOCKET) {
    return process.env.DAEMON_SOCKET;
  }
  const xdgRuntime = process.env.XDG_RUNTIME_DIR;
  if (xdgRuntime) {
    return `${xdgRuntime}/memory-loop.sock`;
  }
  return "/tmp/memory-loop.sock";
}

function getDaemonPort(): number | undefined {
  return process.env.DAEMON_PORT
    ? parseInt(process.env.DAEMON_PORT, 10)
    : undefined;
}

function defaultDaemonFetch(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const port = getDaemonPort();
  if (port) {
    return fetch(`http://127.0.0.1:${port}${path}`, init);
  }

  const socketPath = getSocketPath();
  return fetch(`http://localhost${path}`, {
    ...init,
    unix: socketPath,
  } as RequestInit);
}

function getDaemonFetch(): FetchFn {
  if (_initialized && _fetchFn) {
    return _fetchFn;
  }
  return defaultDaemonFetch;
}

/**
 * Configure daemon-fetch for testing. Returns cleanup function.
 * Call the returned function in afterEach to reset state.
 *
 * This configures the shared fetch layer used by ALL daemon client
 * modules (vaults, files, sessions), so one mock injection covers all.
 */
export function configureDaemonFetchForTesting(mockFetch: FetchFn): () => void {
  _fetchFn = mockFetch;
  _initialized = true;

  return () => {
    _fetchFn = null;
    _initialized = false;
  };
}

// ---------------------------------------------------------------------------
// Fetch wrapper with error distinction
// ---------------------------------------------------------------------------

/**
 * Fetch from the daemon, wrapping connection errors in DaemonUnavailableError.
 * All daemon client modules should use this instead of raw fetch.
 */
export async function daemonFetch(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const fetchFn = getDaemonFetch();
  try {
    return await fetchFn(path, init);
  } catch (error) {
    throw new DaemonUnavailableError(
      `Daemon unreachable at ${path}: ${error instanceof Error ? error.message : String(error)}`,
      error,
    );
  }
}
