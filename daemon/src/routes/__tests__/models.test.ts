import { describe, test, expect, afterEach } from "bun:test";
import { createApp } from "../../server";
import {
  configureRegistryForTesting,
  _resetRegistryForTesting,
} from "../../global-config";

afterEach(() => {
  _resetRegistryForTesting();
});

describe("GET /models", () => {
  test("returns empty array when registry is empty", async () => {
    const app = createApp(Date.now());
    const response = await app.request("/models");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ models: [] });
  });

  test("returns model entries from registry", async () => {
    configureRegistryForTesting({
      opus: { provider: "anthropic", modelId: "claude-opus-4-7" },
    });
    const app = createApp(Date.now());
    const response = await app.request("/models");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      models: [{ name: "opus", provider: "anthropic", modelId: "claude-opus-4-7" }],
    });
  });
});
