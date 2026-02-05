/**
 * Server tests for Memory Loop backend
 *
 * Tests server configuration utilities and WebSocket endpoint.
 * REST endpoint tests are no longer here (routes moved to Next.js).
 */

import { describe, expect, it, afterEach } from "bun:test";
import {
  createApp,
  getPort,
  getHost,
  getTlsConfig,
  isTlsEnabled,
  getHttpRedirectPort,
  createHttpRedirectServer,
} from "../server";

describe("getPort", () => {
  const originalEnv = process.env.PORT;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.PORT;
    } else {
      process.env.PORT = originalEnv;
    }
  });

  it("returns default port 3000 when PORT is not set", () => {
    delete process.env.PORT;
    expect(getPort()).toBe(3000);
  });

  it("returns configured PORT when valid", () => {
    process.env.PORT = "8080";
    expect(getPort()).toBe(8080);
  });

  it("returns default port when PORT is invalid number", () => {
    process.env.PORT = "invalid";
    expect(getPort()).toBe(3000);
  });

  it("returns default port when PORT is out of range", () => {
    process.env.PORT = "99999";
    expect(getPort()).toBe(3000);
  });

  it("returns default port when PORT is negative", () => {
    process.env.PORT = "-1";
    expect(getPort()).toBe(3000);
  });

  it("returns default port when PORT is zero", () => {
    process.env.PORT = "0";
    expect(getPort()).toBe(3000);
  });
});

describe("getHost", () => {
  const originalEnv = process.env.HOST;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.HOST;
    } else {
      process.env.HOST = originalEnv;
    }
  });

  it("returns default host 0.0.0.0 when HOST is not set", () => {
    delete process.env.HOST;
    expect(getHost()).toBe("0.0.0.0");
  });

  it("returns configured HOST when set", () => {
    process.env.HOST = "127.0.0.1";
    expect(getHost()).toBe("127.0.0.1");
  });

  it("returns localhost when HOST is set to localhost", () => {
    process.env.HOST = "localhost";
    expect(getHost()).toBe("localhost");
  });

  it("returns custom hostname when HOST is set", () => {
    process.env.HOST = "192.168.1.100";
    expect(getHost()).toBe("192.168.1.100");
  });
});

describe("getTlsConfig", () => {
  const originalCert = process.env.TLS_CERT;
  const originalKey = process.env.TLS_KEY;
  const originalPassphrase = process.env.TLS_PASSPHRASE;
  const originalCa = process.env.TLS_CA;

  afterEach(() => {
    // Restore original environment
    if (originalCert === undefined) {
      delete process.env.TLS_CERT;
    } else {
      process.env.TLS_CERT = originalCert;
    }
    if (originalKey === undefined) {
      delete process.env.TLS_KEY;
    } else {
      process.env.TLS_KEY = originalKey;
    }
    if (originalPassphrase === undefined) {
      delete process.env.TLS_PASSPHRASE;
    } else {
      process.env.TLS_PASSPHRASE = originalPassphrase;
    }
    if (originalCa === undefined) {
      delete process.env.TLS_CA;
    } else {
      process.env.TLS_CA = originalCa;
    }
  });

  it("returns undefined when TLS_CERT is not set", () => {
    delete process.env.TLS_CERT;
    delete process.env.TLS_KEY;
    expect(getTlsConfig()).toBeUndefined();
  });

  it("returns undefined when TLS_KEY is not set", () => {
    process.env.TLS_CERT = "/path/to/cert.pem";
    delete process.env.TLS_KEY;
    expect(getTlsConfig()).toBeUndefined();
  });

  it("returns undefined when only TLS_KEY is set", () => {
    delete process.env.TLS_CERT;
    process.env.TLS_KEY = "/path/to/key.pem";
    expect(getTlsConfig()).toBeUndefined();
  });

  it("returns config with cert and key when both are set", () => {
    process.env.TLS_CERT = "/path/to/cert.pem";
    process.env.TLS_KEY = "/path/to/key.pem";
    delete process.env.TLS_PASSPHRASE;
    delete process.env.TLS_CA;

    const config = getTlsConfig();
    expect(config).toBeDefined();
    expect(config?.cert).toBeDefined();
    expect(config?.key).toBeDefined();
    expect(config?.passphrase).toBeUndefined();
    expect(config?.ca).toBeUndefined();
  });

  it("includes passphrase when TLS_PASSPHRASE is set", () => {
    process.env.TLS_CERT = "/path/to/cert.pem";
    process.env.TLS_KEY = "/path/to/key.pem";
    process.env.TLS_PASSPHRASE = "secret";
    delete process.env.TLS_CA;

    const config = getTlsConfig();
    expect(config).toBeDefined();
    expect(config?.passphrase).toBe("secret");
  });

  it("includes ca when TLS_CA is set", () => {
    process.env.TLS_CERT = "/path/to/cert.pem";
    process.env.TLS_KEY = "/path/to/key.pem";
    process.env.TLS_CA = "/path/to/ca.pem";
    delete process.env.TLS_PASSPHRASE;

    const config = getTlsConfig();
    expect(config).toBeDefined();
    expect(config?.ca).toBeDefined();
  });

  it("includes all options when fully configured", () => {
    process.env.TLS_CERT = "/path/to/cert.pem";
    process.env.TLS_KEY = "/path/to/key.pem";
    process.env.TLS_PASSPHRASE = "secret";
    process.env.TLS_CA = "/path/to/ca.pem";

    const config = getTlsConfig();
    expect(config).toBeDefined();
    expect(config?.cert).toBeDefined();
    expect(config?.key).toBeDefined();
    expect(config?.passphrase).toBe("secret");
    expect(config?.ca).toBeDefined();
  });
});

describe("isTlsEnabled", () => {
  const originalCert = process.env.TLS_CERT;
  const originalKey = process.env.TLS_KEY;

  afterEach(() => {
    if (originalCert === undefined) {
      delete process.env.TLS_CERT;
    } else {
      process.env.TLS_CERT = originalCert;
    }
    if (originalKey === undefined) {
      delete process.env.TLS_KEY;
    } else {
      process.env.TLS_KEY = originalKey;
    }
  });

  it("returns false when neither TLS_CERT nor TLS_KEY is set", () => {
    delete process.env.TLS_CERT;
    delete process.env.TLS_KEY;
    expect(isTlsEnabled()).toBe(false);
  });

  it("returns false when only TLS_CERT is set", () => {
    process.env.TLS_CERT = "/path/to/cert.pem";
    delete process.env.TLS_KEY;
    expect(isTlsEnabled()).toBe(false);
  });

  it("returns false when only TLS_KEY is set", () => {
    delete process.env.TLS_CERT;
    process.env.TLS_KEY = "/path/to/key.pem";
    expect(isTlsEnabled()).toBe(false);
  });

  it("returns true when both TLS_CERT and TLS_KEY are set", () => {
    process.env.TLS_CERT = "/path/to/cert.pem";
    process.env.TLS_KEY = "/path/to/key.pem";
    expect(isTlsEnabled()).toBe(true);
  });
});

describe("getHttpRedirectPort", () => {
  const originalEnv = process.env.HTTP_PORT;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.HTTP_PORT;
    } else {
      process.env.HTTP_PORT = originalEnv;
    }
  });

  it("returns default port 80 when HTTP_PORT is not set", () => {
    delete process.env.HTTP_PORT;
    expect(getHttpRedirectPort()).toBe(80);
  });

  it("returns configured HTTP_PORT when valid", () => {
    process.env.HTTP_PORT = "8080";
    expect(getHttpRedirectPort()).toBe(8080);
  });

  it("returns default port when HTTP_PORT is invalid number", () => {
    process.env.HTTP_PORT = "invalid";
    expect(getHttpRedirectPort()).toBe(80);
  });

  it("returns default port when HTTP_PORT is out of range", () => {
    process.env.HTTP_PORT = "99999";
    expect(getHttpRedirectPort()).toBe(80);
  });

  it("returns default port when HTTP_PORT is negative", () => {
    process.env.HTTP_PORT = "-1";
    expect(getHttpRedirectPort()).toBe(80);
  });

  it("returns default port when HTTP_PORT is zero", () => {
    process.env.HTTP_PORT = "0";
    expect(getHttpRedirectPort()).toBe(80);
  });
});

describe("createHttpRedirectServer", () => {
  const originalHttpPort = process.env.HTTP_PORT;
  const originalHost = process.env.HOST;

  afterEach(() => {
    if (originalHttpPort === undefined) {
      delete process.env.HTTP_PORT;
    } else {
      process.env.HTTP_PORT = originalHttpPort;
    }
    if (originalHost === undefined) {
      delete process.env.HOST;
    } else {
      process.env.HOST = originalHost;
    }
  });

  it("returns server config with correct port", () => {
    process.env.HTTP_PORT = "3080";
    delete process.env.HOST;

    const config = createHttpRedirectServer(3443);

    expect(config.port).toBe(3080);
    expect(config.hostname).toBe("0.0.0.0");
    expect(typeof config.fetch).toBe("function");
  });

  it("redirects requests to HTTPS with 308 status", () => {
    process.env.HTTP_PORT = "80";
    delete process.env.HOST;

    const config = createHttpRedirectServer(443);
    const req = new Request("http://example.com/some/path?query=value");
    const res = config.fetch(req);

    expect(res.status).toBe(308);
    expect(res.headers.get("Location")).toBe("https://example.com:443/some/path?query=value");
  });

  it("preserves path in redirect", () => {
    const config = createHttpRedirectServer(3000);
    const req = new Request("http://localhost/api/health");
    const res = config.fetch(req);

    expect(res.status).toBe(308);
    expect(res.headers.get("Location")).toBe("https://localhost:3000/api/health");
  });

  it("preserves query string in redirect", () => {
    const config = createHttpRedirectServer(3000);
    const req = new Request("http://localhost/search?q=test&page=2");
    const res = config.fetch(req);

    expect(res.status).toBe(308);
    expect(res.headers.get("Location")).toBe("https://localhost:3000/search?q=test&page=2");
  });

  it("redirects favicon requests to HTTPS", () => {
    const config = createHttpRedirectServer(443);
    const req = new Request("http://example.com/favicon-32.png");
    const res = config.fetch(req);

    expect(res.status).toBe(308);
    expect(res.headers.get("Location")).toBe("https://example.com:443/favicon-32.png");
  });

  it("redirects root path correctly", () => {
    const config = createHttpRedirectServer(443);
    const req = new Request("http://example.com/");
    const res = config.fetch(req);

    expect(res.status).toBe(308);
    expect(res.headers.get("Location")).toBe("https://example.com:443/");
  });
});

describe("createApp", () => {
  it("creates a Hono app instance", () => {
    const app = createApp();
    expect(app).toBeDefined();
    expect(typeof app.fetch).toBe("function");
  });
});

// WebSocket endpoint test removed: upgradeWebSocket requires Bun.serve context
// (c.env.server) which isn't available in unit tests. The WebSocket handler
// itself is tested in websocket-handler.test.ts.
