import { createApp, type VaultState } from './app';
import { loadConfig } from './config';
import { openVault } from './vault';
import { loadTransport } from './transport';
import { transportFileFor } from './runtime-options';

export interface ServerOptions {
  /** Directory containing .memory-loop/config.json, independent of the web build. */
  projectRoot: string;
  authority: string;
}
export interface PreparedServer {
  fetch(request: Request): Promise<Response>;
  close(): Promise<void>;
}

/** Prepare only the authenticated daemon API, without starting a listener. */
export async function prepareServer(options: ServerOptions): Promise<PreparedServer> {
  const transport = await loadTransport(transportFileFor(options.projectRoot));
  if (transport.config.daemonOrigin !== `http://${options.authority}`) throw new Error('Daemon port does not match transport configuration');
  let vault: VaultState;
  try {
    const config = await loadConfig(options.projectRoot);
    vault = { reader: await openVault(config.vaultDirectory) };
  } catch (error: unknown) {
    const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
    vault = { error: code === 'config_missing' || code === 'config_invalid' ? code : 'vault_unavailable' };
  }
  try {
    const fetch = createApp({ authority: options.authority, serviceToken: transport.serviceToken, vault });
    return { fetch, async close() { if ('reader' in vault) await vault.reader.close(); } };
  } catch (error) {
    if ('reader' in vault) await vault.reader.close();
    throw error;
  }
}
