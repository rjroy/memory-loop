import { describe, test, expect } from "bun:test";
import { handleRequest } from "../router";

const startTime = Date.now();

describe("router", () => {
  test("GET /health returns 200", async () => {
    const req = new Request("http://localhost/health");
    const res = await handleRequest(req, startTime);
    expect(res.status).toBe(200);
  });

  test("GET /help returns 200", async () => {
    const req = new Request("http://localhost/help");
    const res = await handleRequest(req, startTime);
    expect(res.status).toBe(200);
  });

  test("unknown path returns 404", async () => {
    const req = new Request("http://localhost/unknown");
    const res = await handleRequest(req, startTime);
    expect(res.status).toBe(404);

    const body = (await res.json()) as { error: string; code: string };
    expect(body.error).toBe("Not found");
    expect(body.code).toBe("NOT_FOUND");
  });

  test("POST /health returns 404", async () => {
    const req = new Request("http://localhost/health", { method: "POST" });
    const res = await handleRequest(req, startTime);
    expect(res.status).toBe(404);
  });
});
