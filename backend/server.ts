import { createApp, type VaultState } from './app';
import { loadConfig } from './config';
import { openVault } from './vault';
import { loadTransport } from './transport';
import { transportFileFor } from './runtime-options';
import { randomUUID } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Service } from '@opencode/client/service';
import type { VaultConfig } from './contract';
import { parseThinkConfig } from './think/config';
import { createNativeClient, nativeSessions } from './think/native';
import { createThinkService, type ThinkService, type ThinkUnavailableCode } from './think/service';
import { createBodyStore, type BodyStore } from './think/body-store';
import { openCaptureWriter, type CaptureWriter } from './capture';
import { groundResourcePaths, openGround, type GroundReader } from './ground';
import { parseGroundGenerationConfig, type GroundGenerationSettings } from './ground-generation-config';
import { createGroundGeneration } from './ground-generation';
import { groundGenerationNative } from './ground-generation-native';
import { createQuestionPublisher, createQuotePublisher } from './ground-generation-publisher';
import { transcriptComponents } from './think/transcript-file';
import { openThinkState } from './think/sqlite-state';
import { createConversationService, type ConversationService } from './think/conversations';
import { nativeVersionStatus } from './think/native-version';
import { installDashboardSkill } from './think/dashboard-skill';

export interface ServerOptions {
  /** Directory containing .memory-loop/config.json, independent of the web build. */
  projectRoot: string;
  authority: string;
}
export interface PreparedServer {
  fetch(request: Request): Promise<Response>;
  /** Runtime calls this only after successfully binding its single-daemon listener. */
  startRecovery(): void;
  close(): Promise<void>;
}

interface PreparedThink {
  think: ThinkService | { error: ThinkUnavailableCode };
  conversations?: ConversationService;
  close(): Promise<void>;
  startRecovery(): void;
  groundDemand?(job: 'questions' | 'quotes'): void;
}
const unavailableThink = (error: ThinkUnavailableCode): PreparedThink => ({ think: { error }, async close() {}, startRecovery() {} });

async function prepareThink(config: VaultConfig | undefined, vault: VaultState, transportFile: string, projectRoot: string, generation: GroundGenerationSettings): Promise<PreparedThink> {
  // Read-only/unconfigured applications must not acquire a private application database.
  if (config?.think === undefined) {
    console.info('think_config_outcome', { status: 'missing' });
    return unavailableThink('think_config_missing');
  }
  const think = parseThinkConfig(config.think);
  if (!think) {
    console.info('think_config_outcome', { status: 'invalid', field: 'configuration (including requiredVersion)' });
    return unavailableThink('think_config_invalid');
  }
  if ('error' in vault) return unavailableThink('think_unavailable');
  console.info('think_setup_attempt');
  let directory: string;
  let state: Awaited<ReturnType<typeof openThinkState>>;
  try {
    directory = await realpath(config.vaultDirectory);
    // Registry ownership and metadata outlive the optional native attachment descriptor.
    // The same private-root/mode/migration checks apply to both startup paths.
    state = await openThinkState(projectRoot, directory);
  } catch {
    console.info('think_setup_outcome', { status: 'unavailable' });
    return unavailableThink('think_unavailable');
  }
  const epoch = randomUUID();
  let bodies: BodyStore | undefined;
  try {
    // The registration is explicitly selected by the operator, never discovered from HOME.
    const registration: unknown = JSON.parse(await readFile(think.registrationFile, 'utf8'));
    if (!registration || typeof registration !== 'object' || !('url' in registration) || typeof registration.url !== 'string' ||
        !('pid' in registration) || typeof registration.pid !== 'number' || !Number.isSafeInteger(registration.pid) || registration.pid < 1) throw new Error('invalid registration');
    const url = new URL(registration.url);
    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
        url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('nonlocal registration');
    if ('password' in registration && typeof registration.password !== 'string') throw new Error('invalid registration');
    const versionStatus = nativeVersionStatus('version' in registration ? registration.version : undefined, think.requiredVersion);
    if (versionStatus !== 'compatible') {
      console.info('think_native_version_outcome', { source: 'registration', status: versionStatus, requiredVersion: think.requiredVersion });
      throw new Error('Native registration version incompatible');
    }
    // The public registered Endpoint is connection configuration, NOT proof that native is
    // currently available. Keep the healthy private registry/list/leases usable offline;
    // every owned native operation still checks the real server PID before publishing.
    const endpoint = { url: registration.url, ...('password' in registration && typeof registration.password === 'string' && registration.password.length > 0
      ? { auth: { type: 'basic' as const, username: 'opencode', password: registration.password } } : {}) };
    const client = createNativeClient({ baseUrl: endpoint.url, headers: Service.headers(endpoint) });
    const location = { directory };
    // Current new-chat defaults must not invalidate a registered chat's stored creation baseline.
    const validateCreation = async (signal: AbortSignal): Promise<void> => {
      if (think.agent) {
        const agents = await client.agent.list({ location }, { signal });
        if (!agents.data.some(agent => agent.id === think.agent && agent.mode !== 'subagent')) throw new Error('selected agent unavailable');
      }
      if (think.model) {
        const models = await client.model.list({ location, types: ['chat'] }, { signal });
        const selected = models.data.find(model => model.enabled && model.type === 'chat' && model.providerID === think.model?.providerID && model.id === think.model.id);
        if (!selected || (think.model.variant !== undefined && !selected.variants.some(variant => variant.id === think.model?.variant))) throw new Error('selected model unavailable');
      }
    };
    bodies = await createBodyStore({ directory: join(dirname(transportFile), `think-bodies-${epoch}`), epoch, vaultDirectory: directory });
    const service = createThinkService({ native: nativeSessions(client), bodies, state, context: { directory, ...(think.agent ? { agent: think.agent } : {}), ...(think.model ? { model: think.model } : {}) }, epoch,
      serviceIdentity: { pid: registration.pid }, minimumVersion: think.requiredVersion, validateCreation, transcript: { directory: think.transcriptDirectory } });
    const jobs: Array<{ job: 'questions' | 'quotes'; runner: ReturnType<typeof createGroundGeneration> }> = [];
    if (generation.state === 'ready') {
      for (const [job, resource] of [['questions', 'prompts'], ['quotes', 'inspiration']] as const) {
        try {
          const noteId = groundResourcePaths(config.ground)[resource];
          if (!noteId) throw new Error('invalid generation resource');
          const publisher = job === 'questions' ? createQuestionPublisher : createQuotePublisher;
          const runner = createGroundGeneration({ job, config: generation.config, directory, transcriptDirectory: transcriptComponents(think.transcriptDirectory), state: state.generation,
            preflight: state.generation,
            publisher: publisher({ directory, noteId, state: state.generation.publications }),
            selection: { ...(think.agent ? { agent: think.agent } : {}), ...(think.model ? { model: think.model } : {}) },
            native: groundGenerationNative({ client, directory, installationId: state.installationId,
              identity: { pid: registration.pid }, minimumVersion: think.requiredVersion, validateSelection: validateCreation }) });
          jobs.push({ job, runner });
          console.info('ground_generation_setup_outcome', { job, state: 'prepared' });
        } catch { console.info('ground_generation_setup_outcome', { job, state: 'unavailable' }); }
      }
    }
    console.info('think_setup_outcome', { status: 'ready' });
    // Jobs borrow Think's private connection; drain them BEFORE Think closes it.
    let closing: Promise<void> | undefined;
    let skillSetup: Promise<void> | undefined;
    const skillStop = new AbortController();
    return { think: service, groundDemand(job) { jobs.find(entry => entry.job === job)?.runner.demand(); }, close() {
      closing ??= (async () => {
        try {
          skillStop.abort();
          await skillSetup;
          const results = await Promise.allSettled(jobs.map(({ runner }) => runner.close()));
          if (results.some(result => result.status === 'rejected')) throw new Error('generation close unavailable');
        } finally { await service.close(); }
      })();
      return closing;
    }, startRecovery() {
      skillSetup ??= (async () => {
        console.info('think_dashboard_skill_install_attempt');
        try {
          const status = await installDashboardSkill(directory, projectRoot);
          console.info('think_dashboard_skill_install_outcome', { status });
          if (status === 'conflict') return;
          console.info('think_dashboard_skill_discovery_attempt');
          const info = await client.server.info({ signal: AbortSignal.any([skillStop.signal, AbortSignal.timeout(5000)]) });
          if (info.pid !== registration.pid || nativeVersionStatus(info.version, think.requiredVersion) !== 'compatible') throw new Error('Native identity unavailable');
          for (let attempt = 0; attempt < 10; attempt++) {
            const skills = await client.skill.list({ location: { directory } }, { signal: AbortSignal.any([skillStop.signal, AbortSignal.timeout(5000)]) });
            if (skills.data.some(skill => skill.id === 'memory-loop-dashboard-setup' && skill.path === join(directory, '.opencode', 'skills', 'memory-loop-dashboard-setup', 'SKILL.md'))) {
              console.info('think_dashboard_skill_discovery_outcome', { status: 'discovered' });
              return;
            }
            await new Promise<void>(resolve => setTimeout(resolve, 250));
            if (skillStop.signal.aborted) return;
          }
          console.info('think_dashboard_skill_discovery_outcome', { status: 'unavailable' });
        } catch { console.info('think_dashboard_skill_setup_outcome', { status: 'unavailable' }); }
      })();
      service.startRecovery();
      for (const { job, runner } of jobs) {
        try { runner.start(); } catch { console.info('ground_generation_setup_outcome', { job, state: 'unavailable' }); }
      }
    } };
  } catch {
    if (bodies) {
      try { await bodies.close(); }
      catch { console.info('think_body_cleanup_outcome', { status: 'failed' }); }
    }
    // No native adapter/body store is fabricated for this path. List, leases and
    // controlled unavailable Resume receipts use exactly the normal registry capability.
    const conversations = createConversationService({ state, directory, epoch });
    if (generation.state === 'ready') console.info('ground_generation_setup_outcome', { state: 'unavailable' });
    let closing: Promise<void> | undefined;
    console.info('think_setup_outcome', { status: 'registry-only' });
    return { think: { error: 'think_unavailable' }, conversations, startRecovery: () => conversations.startRecovery(), close() {
      closing ??= (async () => { try { await conversations.close(); } finally { state.close(); } })();
      return closing;
    } };
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
  if (config) console.info('ground_generation_config_attempt');
  const generation = parseGroundGenerationConfig(config?.ground);
  if (config) {
    console.info('ground_generation_config_outcome', { state: generation.state });
  }
  const preparedThink = await prepareThink(config, vault, transportFile, options.projectRoot, generation);
  let capture: CaptureWriter | undefined;
  let ground: GroundReader | undefined;
  let groundError: 'configuration' | 'io' = 'error' in vault && vault.error === 'vault_unavailable' ? 'io' : 'configuration';
  if (config && 'reader' in vault) {
    console.info('capture_setup_attempt');
    try { capture = await openCaptureWriter(config.vaultDirectory); console.info('capture_setup_outcome', { status: 'ready' }); }
    catch { console.info('capture_setup_outcome', { status: 'unavailable' }); }
    console.info('ground_setup_attempt');
    try { ground = await openGround(config.vaultDirectory, config.ground); console.info('ground_setup_outcome', { status: 'ready' }); }
    catch { groundError = 'io'; console.info('ground_setup_outcome', { status: 'unavailable' }); }
  }
  let closing: Promise<void> | undefined;
  function close(): Promise<void> {
    closing ??= (async () => {
      try { await preparedThink.close(); } finally { try { await ground?.close(); } finally { try { await capture?.close(); } finally { if ('reader' in vault) await vault.reader.close(); } } }
    })();
    return closing;
  }
  try {
    const fetch = createApp({ authority: options.authority, serviceToken: transport.serviceToken, vault, uploadMaxBytes: config?.recall?.uploads?.maxFileBytes,
      think: preparedThink.think, conversations: preparedThink.conversations, capture, ground, groundError, groundDemand: preparedThink.groundDemand });
    return { fetch, close, startRecovery: () => preparedThink.startRecovery() };
  } catch (error) {
    await close();
    throw error;
  }
}
