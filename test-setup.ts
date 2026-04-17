import { GlobalRegistrator } from "@happy-dom/global-registrator";

// Preserve Bun's native web API implementations before happy-dom overwrites them.
// happy-dom's polyfills for these break daemon SSE tests that rely on real streams.
const nativeWebAPIs = {
  Response: globalThis.Response,
  Request: globalThis.Request,
  Headers: globalThis.Headers,
  ReadableStream: globalThis.ReadableStream,
  WritableStream: globalThis.WritableStream,
  TransformStream: globalThis.TransformStream,
  TextEncoder: globalThis.TextEncoder,
  TextDecoder: globalThis.TextDecoder,
  fetch: globalThis.fetch,
  URL: globalThis.URL,
  URLSearchParams: globalThis.URLSearchParams,
  AbortController: globalThis.AbortController,
  AbortSignal: globalThis.AbortSignal,
  crypto: globalThis.crypto,
};

GlobalRegistrator.register();

// Restore native web APIs so Bun.serve, SSE streams, etc. work correctly.
Object.assign(globalThis, nativeWebAPIs);

if (process.env.LOG_LEVEL === "silent") {
  const noop = () => {};
  console.log = noop;
  console.info = noop;
  console.warn = noop;
  console.error = noop;
  console.debug = noop;
}
