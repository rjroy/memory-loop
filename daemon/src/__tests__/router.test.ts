import { describe, test, expect } from "bun:test";
import { createApp } from "../server";

const startTime = Date.now();
const app = createApp(startTime);

describe("router", () => {
  test("GET /health returns 200", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
  });

  test("GET /help returns 200", async () => {
    const res = await app.request("/help");
    expect(res.status).toBe(200);
  });

  test("unknown path returns 404", async () => {
    const res = await app.request("/unknown");
    expect(res.status).toBe(404);
  });

  test("POST /health returns 404", async () => {
    const res = await app.request("/health", { method: "POST" });
    expect(res.status).toBe(404);
  });
});
