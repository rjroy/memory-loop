import type { Context } from "hono";
import { getRegistry } from "../global-config";

export function getModelsHandler(c: Context): Response {
  const models = Object.entries(getRegistry()).map(([name, entry]) => ({
    name,
    provider: entry.provider,
    modelId: entry.modelId,
  }));
  return c.json({ models });
}
