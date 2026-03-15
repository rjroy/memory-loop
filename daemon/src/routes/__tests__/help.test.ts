import { describe, test, expect } from "bun:test";
import { helpHandler, type HelpResponse } from "../help";

describe("GET /help", () => {
  test("returns 200 with expected structure", async () => {
    const response = helpHandler();

    expect(response.status).toBe(200);

    const body = (await response.json()) as HelpResponse;
    expect(body.name).toBe("memory-loop");
    expect(body.version).toBe("0.0.0");
    expect(body.description).toBe("Memory Loop daemon API");
    expect(Array.isArray(body.endpoints)).toBe(true);
  });

  test("health endpoint is listed in discovery", async () => {
    const response = helpHandler();
    const body = (await response.json()) as HelpResponse;

    const healthEntry = body.endpoints.find((e) => e.path === "/health");
    expect(healthEntry).toBeDefined();
    expect(healthEntry?.method).toBe("GET");
  });

  test("help endpoint is listed in discovery", async () => {
    const response = helpHandler();
    const body = (await response.json()) as HelpResponse;

    const helpEntry = body.endpoints.find((e) => e.path === "/help");
    expect(helpEntry).toBeDefined();
  });
});
