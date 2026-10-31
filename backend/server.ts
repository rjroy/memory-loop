import { createApp, type VaultState } from './app';
import { loadConfig } from './config';
import { openVault } from './vault';
import { loadTransport } from './transport';
import { transportFileFor } from './runtime-options';
import { randomUUID } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { OpenCode } from '@opencode/client';
import { Service } from '@opencode/client/service';
import type { VaultConfig } from './contract';
import { parseThinkConfig } from './think/config';
import { nativeSessions } from './think/native';
import { createThinkService, type ThinkService, type ThinkUnavailableCode } from './think/service';
import { createBodyStore, type BodyStore } from './think/body-store';

export interface ServerOptions {
  /** Directory containing .memory-loop/config.json, independent of the web build. */
  projectRoot: string;
  authority: string;
}
export interface PreparedServer {
  fetch(request: Request): Promise<Response>;
  close(): Promise<void>;
}

async function prepareThink(config: VaultConfig | undefined, vault: VaultState, transportFile: string): Promise<ThinkService | { error: ThinkUnavailableCode }> {
  if (config?.think === undefined) return { error: 'think_config_missing' };
  const think = parseThinkConfig(config.think);
  if (!think) return { error: 'think_config_invalid' };
  if ('error' in vault) return { error: 'think_unavailable' };
  console.info('think_setup_attempt');
  let bodies: BodyStore | undefined;
  try {
    const directory = await realpath(config.vaultDirectory);
    // The registration is explicitly selected by the operator, never discovered from HOME.
    const registration: unknown = JSON.parse(await readFile(think.registrationFile, 'utf8'));
    if (!registration || typeof registration !== 'object' || !('url' in registration) || typeof registration.url !== 'string' ||
        !('pid' in registration) || typeof registration.pid !== 'number' || !Number.isSafeInteger(registration.pid) || registration.pid < 1) throw new Error('invalid registration');
    const url = new URL(registration.url);
    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
        url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('nonlocal registration');
    const endpoint = await Service.discover({ file: think.registrationFile, version: '2.2.2' });
    if (!endpoint || endpoint.url !== registration.url) throw new Error('service unavailable');
    const client = OpenCode.make({ baseUrl: endpoint.url, headers: Service.headers(endpoint) });
    const info = await client.server.info({ signal: AbortSignal.timeout(5000) });
    if (info.version !== '2.2.2' || info.pid !== registration.pid) throw new Error('service identity mismatch');
    const location = { directory };
    if (think.agent) {
      const agents = await client.agent.list({ location }, { signal: AbortSignal.timeout(5000) });
      if (!agents.data.some(agent => agent.id === think.agent && agent.mode !== 'subagent')) throw new Error('selected agent unavailable');
    }
    if (think.model) {
      const models = await client.model.list({ location, types: ['chat'] }, { signal: AbortSignal.timeout(5000) });
      const selected = models.data.find(model => model.enabled && model.type === 'chat' && model.providerID === think.model?.providerID && model.id === think.model.id);
      if (!selected || (think.model.variant !== undefined && !selected.variants.some(variant => variant.id === think.model?.variant))) throw new Error('selected model unavailable');
    }
    const epoch = randomUUID();
    bodies = await createBodyStore({ directory: join(dirname(transportFile), `think-bodies-${epoch}`), epoch, vaultDirectory: directory });
    const service = createThinkService({ native: nativeSessions(client), bodies, context: { directory, ...(think.agent ? { agent: think.agent } : {}), ...(think.model ? { model: think.model } : {}) }, epoch, serviceIdentity: { pid: info.pid, version: info.version }, transcript: { directory: think.transcriptDirectory } });
    console.info('think_setup_outcome', { status: 'ready' });
    return service;
  } catch {
    if (bodies) {
      try { await bodies.close(); }
      catch { console.info('think_body_cleanup_outcome', { status: 'failed' }); }
    }
    console.info('think_setup_outcome', { status: 'unavailable' });
    return { error: 'think_unavailable' };
  }
}

/** Prepare only the authenticated daemon API, without starting a listener. */
export async function prepareServer(options: ServerOptions): Promise<PreparedServer> {
  const transportFile = transportFileFor(options.projectRoot);
  const transport = await loadTransport(transportFile);
  if (transport.config.daemonOrigin !== `http://${options.authority}`) throw new Error('Daemon port does not match transport configuration');
  let vault: VaultState;
  let config: VaultConfig | undefined;
  try {
    config = await loadConfig(options.projectRoot);
    vault = { reader: await openVault(config.vaultDirectory) };
  } catch (error: unknown) {
    const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
    vault = { error: code === 'config_missing' || code === 'config_invalid' ? code : 'vault_unavailable' };
  }
  const think = await prepareThink(config, vault, transportFile);
  try {
    const fetch = createApp({ authority: options.authority, serviceToken: transport.serviceToken, vault, think });
    return { fetch, async close() { try { if (!('error' in think)) await think.close(); } finally { if ('reader' in vault) await vault.reader.close(); } } };
  } catch (error) {
    try { if (!('error' in think)) await think.close(); } finally { if ('reader' in vault) await vault.reader.close(); }
    throw error;
  }
}
