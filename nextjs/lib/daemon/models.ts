import { daemonFetch } from "./fetch";

export interface ModelEntry {
  name: string;
  provider: string;
  modelId: string;
}

export async function getModels(): Promise<ModelEntry[]> {
  const res = await daemonFetch("/models");
  const json = (await res.json()) as { models: ModelEntry[] };
  return json.models;
}
