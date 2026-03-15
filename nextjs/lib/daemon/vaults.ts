/**
 * Daemon Vault Client
 *
 * HTTP client that proxies vault operations to the daemon API.
 * Part of the permanent daemon client layer for the web app.
 */

import { basename, join } from "node:path";
import type {
  VaultInfo,
  VaultConfig,
  EditableVaultConfig,
  SlashCommand,
  SaveConfigResult,
} from "@memory-loop/shared";
import { createLogger } from "@memory-loop/shared";
import { daemonFetch } from "./fetch";
export { DaemonUnavailableError } from "./fetch";
export type { SaveConfigResult };

const log = createLogger("vault-client");

// ---------------------------------------------------------------------------
// Backwards-compatible test configuration
// ---------------------------------------------------------------------------

// Re-export for existing test code that calls configureVaultClientForTesting.
// Delegates to the shared daemon-fetch provider.
export { configureDaemonFetchForTesting as configureVaultClientForTesting } from "./fetch";

/**
 * Extract vault ID from a vault path.
 * The vault ID is the directory name (last segment of the path).
 */
function vaultIdFromPath(vaultPath: string): string {
  return basename(vaultPath);
}

// ---------------------------------------------------------------------------
// Vault operations (proxied to daemon)
// ---------------------------------------------------------------------------

export async function discoverVaults(): Promise<VaultInfo[]> {
  const res = await daemonFetch("/vaults");
  if (!res.ok) {
    log.error(`Failed to discover vaults: ${res.status}`);
    return [];
  }
  const body = (await res.json()) as { vaults: VaultInfo[] };
  return body.vaults;
}

export async function getVaultById(vaultId: string): Promise<VaultInfo | null> {
  const res = await daemonFetch(`/vaults/${encodeURIComponent(vaultId)}`);
  if (res.status === 404) return null;
  if (!res.ok) {
    log.error(`Failed to get vault ${vaultId}: ${res.status}`);
    return null;
  }
  return (await res.json()) as VaultInfo;
}

export async function createVault(title: string): Promise<VaultInfo> {
  const res = await daemonFetch("/vaults", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
  if (!res.ok) {
    const body = (await res.json()) as { error: string; code: string };
    throw new Error(body.error);
  }
  return (await res.json()) as VaultInfo;
}

// ---------------------------------------------------------------------------
// Config operations (proxied to daemon)
// ---------------------------------------------------------------------------

export async function loadVaultConfig(
  vaultPath: string,
): Promise<VaultConfig> {
  const vaultId = vaultIdFromPath(vaultPath);
  const res = await daemonFetch(
    `/vaults/${encodeURIComponent(vaultId)}/config`,
  );
  if (!res.ok) {
    log.error(`Failed to load config for ${vaultId}: ${res.status}`);
    return {};
  }
  return (await res.json()) as VaultConfig;
}

export async function saveVaultConfig(
  vaultPath: string,
  editableConfig: EditableVaultConfig,
): Promise<SaveConfigResult> {
  const vaultId = vaultIdFromPath(vaultPath);
  const res = await daemonFetch(
    `/vaults/${encodeURIComponent(vaultId)}/config`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editableConfig),
    },
  );
  if (!res.ok) {
    const body = (await res.json()) as { error: string };
    return { success: false, error: body.error };
  }
  return { success: true };
}

export async function savePinnedAssets(
  vaultPath: string,
  paths: string[],
): Promise<void> {
  const vaultId = vaultIdFromPath(vaultPath);
  const res = await daemonFetch(
    `/vaults/${encodeURIComponent(vaultId)}/config/pinned-assets`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paths }),
    },
  );
  if (!res.ok) {
    log.error(`Failed to save pinned assets for ${vaultId}: ${res.status}`);
  }
}

export async function loadSlashCommands(
  vaultPath: string,
): Promise<SlashCommand[] | undefined> {
  const vaultId = vaultIdFromPath(vaultPath);
  const res = await daemonFetch(
    `/vaults/${encodeURIComponent(vaultId)}/config/slash-commands`,
  );
  if (!res.ok) {
    log.error(`Failed to load slash commands for ${vaultId}: ${res.status}`);
    return undefined;
  }
  const body = (await res.json()) as { commands: SlashCommand[] | null };
  return body.commands ?? undefined;
}

export async function saveSlashCommands(
  vaultPath: string,
  commands: SlashCommand[],
): Promise<void> {
  const vaultId = vaultIdFromPath(vaultPath);
  const res = await daemonFetch(
    `/vaults/${encodeURIComponent(vaultId)}/config/slash-commands`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commands }),
    },
  );
  if (!res.ok) {
    log.error(`Failed to save slash commands for ${vaultId}: ${res.status}`);
  }
}

// ---------------------------------------------------------------------------
// Environment helpers (no daemon call needed)
// ---------------------------------------------------------------------------

/**
 * Get the vaults directory path.
 * Reads VAULTS_DIR env var directly (same env var the daemon reads).
 */
export function getVaultsDir(): string {
  return process.env.VAULTS_DIR ?? join(process.cwd(), "..", "vaults");
}
