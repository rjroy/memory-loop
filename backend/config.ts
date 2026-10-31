import { opendir, readFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import type { VaultConfig } from './contract';

type ConfigErrorCode = 'config_missing' | 'config_invalid' | 'vault_unavailable';

class ConfigError extends Error {
  constructor(readonly code: ConfigErrorCode, message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export async function loadConfig(projectRoot: string): Promise<VaultConfig> {
  let content: string;
  try {
    content = await readFile(join(projectRoot, '.memory-loop', 'config.json'), 'utf8');
  } catch (error: unknown) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
      throw new ConfigError('config_missing', 'Vault configuration is missing');
    }
    throw new ConfigError('config_invalid', 'Vault configuration could not be read');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new ConfigError('config_invalid', 'Vault configuration is invalid');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed) ||
      !('vaultDirectory' in parsed) || typeof parsed.vaultDirectory !== 'string' ||
      !parsed.vaultDirectory.trim() || !isAbsolute(parsed.vaultDirectory)) {
    throw new ConfigError('config_invalid', 'Vault configuration is invalid');
  }

  try {
    const directory = await opendir(parsed.vaultDirectory);
    await directory.close();
  } catch {
    throw new ConfigError('vault_unavailable', 'Vault directory is unavailable');
  }
  return { vaultDirectory: parsed.vaultDirectory, ...('think' in parsed ? { think: parsed.think } : {}), ...('ground' in parsed ? { ground: parsed.ground } : {}) };
}
