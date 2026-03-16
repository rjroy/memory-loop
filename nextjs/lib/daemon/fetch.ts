/**
 * Daemon Fetch Module
 *
 * Provides the HTTP connection layer for all daemon client modules
 * (vaults, files, sessions). Handles Unix socket and TCP port resolution,
 * error wrapping, and test injection.
 *
 * Next.js runs under Node.js, not Bun, so Unix socket requests use
 * Node's http module with socketPath instead of Bun's `unix` fetch option.
 */

import * as http from "node:http";

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

function extractHeaders(init?: RequestInit): Record<string, string> {
  const headers: Record<string, string> = {};
  if (init?.headers) {
    const h = init.headers;
    if (h instanceof Headers) {
      h.forEach((v, k) => { headers[k] = v; });
    } else if (Array.isArray(h)) {
      for (const [k, v] of h) { headers[k] = v; }
    } else {
      Object.assign(headers, h);
    }
  }
  return headers;
}

function buildResponseHeaders(res: http.IncomingMessage): Headers {
  const responseHeaders = new Headers();
  for (const [key, value] of Object.entries(res.headers)) {
    if (value !== undefined) {
      const values = Array.isArray(value) ? value : [value];
      for (const v of values) {
        responseHeaders.append(key, v);
      }
    }
  }
  return responseHeaders;
}

/**
 * Make an HTTP request over a Unix socket using Node's http module.
 * Returns a standard Response with a streaming body so SSE and large
 * binary responses work without buffering the full payload in memory.
 */
function fetchViaUnixSocket(
  socketPath: string,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        socketPath,
        path,
        method: init?.method ?? "GET",
        headers: extractHeaders(init),
      },
      (nodeResponse) => {
        const body = new ReadableStream({
          start(controller) {
            nodeResponse.on("data", (chunk: Buffer) => {
              controller.enqueue(new Uint8Array(chunk));
            });
            nodeResponse.on("end", () => controller.close());
            nodeResponse.on("error", (err) => controller.error(err));
          },
          cancel() {
            nodeResponse.destroy();
          },
        });

        resolve(
          new Response(body, {
            status: nodeResponse.statusCode ?? 500,
            statusText: nodeResponse.statusMessage ?? "",
            headers: buildResponseHeaders(nodeResponse),
          }),
        );
      },
    );

    req.on("error", reject);

    if (init?.body) {
      if (typeof init.body === "string") {
        req.write(init.body);
      } else if (init.body instanceof ArrayBuffer) {
        req.write(Buffer.from(init.body));
      } else if (Buffer.isBuffer(init.body)) {
        req.write(init.body);
      }
    }

    req.end();
  });
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
  return fetchViaUnixSocket(socketPath, path, init);
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
