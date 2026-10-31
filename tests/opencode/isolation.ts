export type Metadata = 'directory' | 'file' | 'symlink' | 'missing' | 'error';
export type Inspect = (path: string) => Promise<Metadata>;
export interface IsolationInput {
  root: string;
  cwd: string;
  paths: Record<string, string | undefined>;
  config: string;
  providerOrigin: string;
  password: string;
  host: string;
  port: number;
  hostEnvironment: Record<string, string | undefined>;
}
export interface LaunchSpec {
  executable: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
}
export type Launch = (spec: LaunchSpec) => Promise<void>;

import { isAbsolute, normalize, relative, resolve, sep } from 'node:path';

const directorySelectors = [
  'HOME', 'OPENCODE_TEST_HOME', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME',
  'XDG_CACHE_HOME', 'XDG_STATE_HOME', 'TMPDIR', 'OPENCODE_CONFIG_DIR',
] as const;
const fileSelectors = ['OPENCODE_DB', 'GIT_CONFIG_GLOBAL'] as const;

function fail(message: string): never {
  throw new Error(`Isolation guard: ${message}`);
}

function contained(root: string, path: string): boolean {
  if (typeof path !== 'string' || !path || path.includes('\0') || !isAbsolute(path) || normalize(path) !== path) return false;
  const rel = relative(root, path);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function keysAre(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).every(key => keys.includes(key));
}

function validatePermissions(value: unknown, parent: boolean): void {
  if (!Array.isArray(value)) fail('invalid fixture permissions');
  for (const rule of value) {
    if (!record(rule) || !keysAre(rule, ['action', 'resource', 'effect']) ||
        typeof rule.action !== 'string' || !rule.action || typeof rule.resource !== 'string' || !rule.resource ||
        (rule.effect !== 'deny' && !(parent && rule.effect === 'allow' && rule.action === 'subagent' && rule.resource === 'fixture_child'))) {
      fail('invalid fixture permission');
    }
  }
}

function validateConfig(config: string, origin: string, root: string): string[] {
  let parsed: unknown;
  try { parsed = JSON.parse(config); } catch { fail('invalid fixture configuration'); }
  if (!record(parsed) || !keysAre(parsed, ['model', 'update', 'share', 'snapshots', 'providers', 'permissions', 'agents', 'compaction', 'mcp']) ||
      parsed.model !== 'fixture-provider/fixture-model' || parsed.update !== 'disable' ||
      parsed.share !== 'disabled' || parsed.snapshots !== false || !record(parsed.providers) ||
      Object.keys(parsed.providers).length !== 1 || !record(parsed.providers['fixture-provider'])) {
    fail('configuration must contain only the fixture provider');
  }
  const provider = parsed.providers['fixture-provider'];
  if (!keysAre(provider, ['env', 'package', 'settings', 'models']) ||
      !Array.isArray(provider.env) || provider.env.length !== 0 ||
      provider.package !== '@opencode/ai/providers/openai-compatible' ||
      !record(provider.settings) || !keysAre(provider.settings, ['baseURL', 'apiKey']) ||
      provider.settings.baseURL !== `${origin}/v1` || provider.settings.apiKey !== 'fixture-only' ||
      !record(provider.models) || Object.keys(provider.models).length !== 1 ||
      !record(provider.models['fixture-model'])) {
    fail('invalid fixture provider');
  }
  const model = provider.models['fixture-model'];
  if (!keysAre(model, ['type', 'capabilities', 'limit']) || model.type !== 'chat' ||
      !record(model.capabilities) || !keysAre(model.capabilities, ['tools', 'input', 'output']) ||
      model.capabilities.tools !== true || !Array.isArray(model.capabilities.input) ||
      model.capabilities.input.length !== 1 || model.capabilities.input[0] !== 'text' ||
      !Array.isArray(model.capabilities.output) || model.capabilities.output.length !== 1 ||
      model.capabilities.output[0] !== 'text' || !record(model.limit) ||
      !keysAre(model.limit, ['context', 'output']) || model.limit.context !== 131072 || model.limit.output !== 2048) {
    fail('invalid fixture model');
  }
  if (parsed.permissions !== undefined) validatePermissions(parsed.permissions, false);
  if (parsed.agents !== undefined) {
    if (!record(parsed.agents) || !keysAre(parsed.agents, ['fixture_parent', 'fixture_child'])) fail('invalid fixture agents');
    for (const [name, agent] of Object.entries(parsed.agents)) {
      if (!record(agent) || !keysAre(agent, ['mode', 'permissions']) ||
          agent.mode !== (name === 'fixture_parent' ? 'primary' : 'subagent')) fail('invalid fixture agent');
      validatePermissions(agent.permissions, name === 'fixture_parent');
    }
  }
  if (parsed.compaction !== undefined) {
    const value = parsed.compaction;
    if (!record(value) || !keysAre(value, ['auto', 'keep', 'buffer']) || value.auto !== false || value.buffer !== 0 ||
        !record(value.keep) || !keysAre(value.keep, ['tokens']) || value.keep.tokens !== 0) fail('invalid fixture compaction');
  }
  const scripts: string[] = [];
  if (parsed.mcp !== undefined) {
    if (!record(parsed.mcp) || !keysAre(parsed.mcp, ['servers']) || !record(parsed.mcp.servers) ||
        !keysAre(parsed.mcp.servers, ['fixture_direct', 'fixture_code']) || !Object.keys(parsed.mcp.servers).length) fail('invalid fixture MCP servers');
    for (const [name, server] of Object.entries(parsed.mcp.servers)) {
      if (!record(server) || !keysAre(server, ['type', 'command', 'cwd', 'protocol', 'codemode']) ||
          server.type !== 'local' || server.cwd !== root || server.protocol !== 'legacy' ||
          server.codemode !== (name === 'fixture_code') || !Array.isArray(server.command) ||
          server.command.length !== 3 || server.command[0] !== '/usr/bin/bun' || server.command[1] !== '--no-env-file' ||
          typeof server.command[2] !== 'string' || !contained(root, server.command[2])) fail('invalid fixture MCP server');
      scripts.push(server.command[2]);
    }
  }
  return scripts;
}

async function checkPath(root: string, path: string, expected: 'directory' | 'file' | 'database', inspect: Inspect): Promise<void> {
  const parts = relative(root, path).split(sep);
  let current = root;
  for (let index = 0; index <= parts.length; index++) {
    if (index > 0) current = resolve(current, parts[index - 1]);
    const state = await inspect(current);
    const leaf = index === parts.length;
    if (!leaf || expected === 'directory') {
      if (state !== 'directory') fail(`expected directory: ${current}`);
    } else if (expected === 'file' ? state !== 'file' : state !== 'file' && state !== 'missing') {
      fail(`invalid file: ${current}`);
    }
  }
}

export async function prepareIsolatedLaunch(input: IsolationInput, inspect: Inspect): Promise<LaunchSpec> {
  // Snapshot caller-owned data before the first asynchronous inspection.
  const { root, cwd, config, providerOrigin, password, host, port } = input;
  const paths = { ...input.paths };
  const executable = input.hostEnvironment.OPENCODE_TEST_BINARY;
  if (typeof executable !== 'string' || !executable || executable.includes('\0') || !isAbsolute(executable) || normalize(executable) !== executable) fail('invalid binary selector');
  if (!contained('/tmp/opencode', root) || !contained(root, cwd)) fail('invalid root or workspace');
  if (host !== '127.0.0.1' || port !== 0 || typeof password !== 'string' || !password) fail('invalid bind or password');
  const match = /^http:\/\/127\.0\.0\.1:([1-9]\d{0,4})$/.exec(providerOrigin);
  if (!match || Number(match[1]) > 65535) fail('invalid fixture provider origin');
  if (typeof config !== 'string' || !config) fail('missing fixture configuration');
  const scripts = validateConfig(config, providerOrigin, root);

  const envPaths: Record<string, string> = {};
  for (const selector of [...directorySelectors, ...fileSelectors]) {
    const path = paths[selector];
    if (typeof path !== 'string' || !contained(root, path)) fail(`invalid ${selector}`);
    envPaths[selector] = path;
  }
  if (await inspect('/etc/opencode') !== 'missing') fail('system configuration is not definitely absent');
  await checkPath(root, cwd, 'directory', inspect);
  for (const selector of directorySelectors) await checkPath(root, envPaths[selector], 'directory', inspect);
  await checkPath(root, envPaths.OPENCODE_DB, 'database', inspect);
  await checkPath(root, envPaths.GIT_CONFIG_GLOBAL, 'file', inspect);
  for (const script of scripts) await checkPath(root, script, 'file', inspect);

  return {
    executable,
    args: ['serve', '--hostname', '127.0.0.1', '--port', '0'],
    cwd,
    env: {
      ...envPaths, OPENCODE_CONFIG_CONTENT: config, OPENCODE_CONFIG_PROJECT_DISABLE: '1',
      OPENCODE_DISABLE_CLAUDE_CODE: '1', OPENCODE_DISABLE_MODELS_FETCH: '1', OPENCODE_DISABLE_FREE_MODELS: '1',
      OPENCODE_DISABLE_AUTOUPDATE: '1', OPENCODE_DISABLE_FILEWATCHER: '1', OPENCODE_DISABLE_FFF: '1',
      OPENCODE_PASSWORD: password, PATH: '/usr/bin:/bin', GIT_CONFIG_NOSYSTEM: '1',
    },
  };
}

export async function launchIsolated(input: IsolationInput, inspect: Inspect, launch: Launch): Promise<void> {
  const spec = await prepareIsolatedLaunch(input, inspect);
  await launch(spec);
}
