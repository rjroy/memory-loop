/**
 * Transitional Vault Client (REQ-DAB-23)
 *
 * HTTP client that proxies vault operations to the daemon API.
 * This module will be deleted in Stage 6 when the Next.js app
 * is fully converted to a daemon client.
 */

import { basename, join } from "node:path";
import { readFile } from "node:fs/promises";
import type {
  VaultInfo,
  VaultConfig,
  EditableVaultConfig,
  SlashCommand,
} from "@memory-loop/shared";
import { createLogger, resolveGoalsPath } from "@memory-loop/shared";
import { fileExists } from "@memory-loop/shared/server";
import type { SaveConfigResult } from "@/lib/vault-config";
export type { SaveConfigResult };

const log = createLogger("vault-client");

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
  return process.env.DAEMON_PORT ? parseInt(process.env.DAEMON_PORT, 10) : undefined;
}

async function daemonFetch(path: string, init?: RequestInit): Promise<Response> {
  const port = getDaemonPort();
  if (port) {
    return fetch(`http://127.0.0.1:${port}${path}`, init);
  }

  const socketPath = getSocketPath();
  return fetch(`http://localhost${path}`, {
    ...init,
    unix: socketPath,
  } as RequestInit);
}

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

// TODO: Stage 3 - move to daemon file read endpoint
export async function getVaultGoals(vault: VaultInfo): Promise<string | null> {
  if (!vault.goalsPath) {
    return null;
  }
  const goalsFullPath = join(vault.contentRoot, vault.goalsPath);
  try {
    return await readFile(goalsFullPath, "utf-8");
  } catch {
    log.warn(`Failed to read goals file: ${goalsFullPath}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Config operations (proxied to daemon)
// ---------------------------------------------------------------------------

export async function loadVaultConfig(vaultPath: string): Promise<VaultConfig> {
  const vaultId = vaultIdFromPath(vaultPath);
  const res = await daemonFetch(`/vaults/${encodeURIComponent(vaultId)}/config`);
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
  const res = await daemonFetch(`/vaults/${encodeURIComponent(vaultId)}/config`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(editableConfig),
  });
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
  const res = await daemonFetch(`/vaults/${encodeURIComponent(vaultId)}/config/pinned-assets`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ paths }),
  });
  if (!res.ok) {
    log.error(`Failed to save pinned assets for ${vaultId}: ${res.status}`);
  }
}

export async function loadSlashCommands(
  vaultPath: string,
): Promise<SlashCommand[] | undefined> {
  const vaultId = vaultIdFromPath(vaultPath);
  const res = await daemonFetch(`/vaults/${encodeURIComponent(vaultId)}/config/slash-commands`);
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
  const res = await daemonFetch(`/vaults/${encodeURIComponent(vaultId)}/config/slash-commands`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ commands }),
  });
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
