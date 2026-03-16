/**
 * Daemon HTTP client for the CLI.
 *
 * Connects to the daemon via Unix socket or TCP port, mirroring
 * the daemon's own socket resolution logic.
 */

import type { DaemonError } from "./types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FetchFn = (path: string, init?: RequestInit) => Promise<Response>;

export interface SSEEvent {
  type: string;
  data: string;
}

// ---------------------------------------------------------------------------
// Connection errors
// ---------------------------------------------------------------------------

export class DaemonConnectionError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "DaemonConnectionError";
  }
}

export class DaemonApiError extends Error {
  public readonly statusCode: number;
  public readonly errorBody: DaemonError;

  constructor(statusCode: number, body: DaemonError) {
    super(body.error);
    this.name = "DaemonApiError";
    this.statusCode = statusCode;
    this.errorBody = body;
  }
}

// ---------------------------------------------------------------------------
// Provider pattern for testability
// ---------------------------------------------------------------------------

let _testFetchFn: FetchFn | null = null;

/**
 * Inject a mock fetch for testing. Returns cleanup function.
 */
export function configureClientForTesting(mockFetch: FetchFn): () => void {
  _testFetchFn = mockFetch;
  return () => {
    _testFetchFn = null;
  };
}

// ---------------------------------------------------------------------------
// Socket/port resolution
// ---------------------------------------------------------------------------

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

// Overrides from CLI flags (--socket, --port)
let _socketOverride: string | undefined;
let _portOverride: number | undefined;

export function setConnectionOverrides(opts: {
  socket?: string;
  port?: number;
}): void {
  _socketOverride = opts.socket;
  _portOverride = opts.port;
}

// ---------------------------------------------------------------------------
// Core fetch
// ---------------------------------------------------------------------------

function defaultFetch(path: string, init?: RequestInit): Promise<Response> {
  const port = _portOverride ?? getDaemonPort();
  if (port) {
    return fetch(`http://127.0.0.1:${port}${path}`, init);
  }

  const socketPath = _socketOverride ?? getSocketPath();
  return fetch(`http://localhost${path}`, {
    ...init,
    unix: socketPath,
  } as RequestInit);
}

function getFetchFn(): FetchFn {
  return _testFetchFn ?? defaultFetch;
}

/**
 * Raw fetch to the daemon. Wraps connection errors.
 */
export async function daemonFetch(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const fetchFn = getFetchFn();
  try {
    return await fetchFn(path, init);
  } catch (error) {
    throw new DaemonConnectionError(
      `Cannot connect to Memory Loop daemon. Is it running?\nStart with: bun run daemon:start`,
      error,
    );
  }
}

/**
 * Fetch JSON from the daemon. Throws DaemonApiError on non-2xx.
 */
export async function daemonJson<T = unknown>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await daemonFetch(path, init);
  if (!response.ok) {
    let body: DaemonError;
    try {
      body = (await response.json()) as DaemonError;
    } catch {
      body = {
        error: `HTTP ${response.status}: ${response.statusText}`,
        code: "UNKNOWN_ERROR",
      };
    }
    throw new DaemonApiError(response.status, body);
  }
  return (await response.json()) as T;
}

/**
 * Open an SSE stream to the daemon. Returns an async iterable of parsed events.
 *
 * Pass an AbortSignal to cancel the stream (e.g., on SIGINT).
 * When aborted, the generator cleanly exits.
 */
export async function* daemonSSE(
  path: string,
  options?: { signal?: AbortSignal },
): AsyncGenerator<SSEEvent, void, undefined> {
  const response = await daemonFetch(path, {
    headers: { Accept: "text/event-stream" },
    signal: options?.signal,
  });

  if (!response.ok) {
    let body: DaemonError;
    try {
      body = (await response.json()) as DaemonError;
    } catch {
      body = {
        error: `HTTP ${response.status}: ${response.statusText}`,
        code: "UNKNOWN_ERROR",
      };
    }
    throw new DaemonApiError(response.status, body);
  }

  if (!response.body) {
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Process complete SSE frames (separated by double newline)
      const frames = buffer.split("\n\n");
      // Keep the last incomplete frame in the buffer
      buffer = frames.pop() ?? "";

      for (const frame of frames) {
        if (!frame.trim()) continue;

        let eventType = "message";
        const dataLines: string[] = [];

        for (const line of frame.split("\n")) {
          if (line.startsWith(":")) {
            // Comment line (keep-alive), skip
            continue;
          }
          if (line.startsWith("event:")) {
            eventType = line.slice(6).trim();
          } else if (line.startsWith("data:")) {
            // SSE spec: strip exactly one leading space after "data:"
            const value = line.slice(5);
            dataLines.push(value.startsWith(" ") ? value.slice(1) : value);
          }
        }

        if (dataLines.length > 0) {
          yield {
            type: eventType,
            data: dataLines.join("\n"),
          };
        }
      }
    }
  } catch (error) {
    // AbortError is expected when the signal fires; exit cleanly
    if (error instanceof Error && error.name === "AbortError") {
      return;
    }
    throw error;
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}

// ---------------------------------------------------------------------------
// Vault resolution (D7)
// ---------------------------------------------------------------------------

interface VaultListItem {
  id: string;
  title: string;
}

interface VaultListResponse {
  vaults: VaultListItem[];
}

/**
 * Resolve a vault argument to a vault ID.
 * Tries exact ID first, then fuzzy-matches against vault titles.
 */
export async function resolveVault(idOrName: string): Promise<string> {
  // Try exact ID first
  try {
    await daemonJson(`/vaults/${encodeURIComponent(idOrName)}`);
    return idOrName;
  } catch (error) {
    if (!(error instanceof DaemonApiError) || error.statusCode !== 404) {
      throw error;
    }
  }

  // Fuzzy match against vault titles
  const { vaults } = await daemonJson<VaultListResponse>("/vaults");
  const needle = idOrName.toLowerCase();
  const matches = vaults.filter(
    (v) =>
      v.title.toLowerCase().includes(needle) ||
      v.id.toLowerCase().includes(needle),
  );

  if (matches.length === 1) {
    return matches[0].id;
  }

  if (matches.length > 1) {
    const names = matches.map((v) => `  ${v.id} (${v.title})`).join("\n");
    throw new Error(
      `Multiple vaults match "${idOrName}":\n${names}\nSpecify the vault ID to disambiguate.`,
    );
  }

  throw new Error(`Vault not found: "${idOrName}"`);
}
