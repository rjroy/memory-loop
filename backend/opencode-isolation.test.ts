import { describe, expect, it, vi } from 'vitest';
import { launchIsolated, prepareIsolatedLaunch } from '../tests/opencode/isolation';
import type { Inspect, IsolationInput, Metadata } from '../tests/opencode/isolation';

const root = '/tmp/opencode/test-owned-guard-fixture';
const providerOrigin = 'http://127.0.0.1:18491';
const password = 'fixture-only-password-controlled';
const executable = '/opt/test-owned/opencode-2.2.2';
const paths = {
  HOME: `${root}/home`, OPENCODE_TEST_HOME: `${root}/home`,
  XDG_CONFIG_HOME: `${root}/xdg-config`, XDG_DATA_HOME: `${root}/data`,
  XDG_CACHE_HOME: `${root}/cache`, XDG_STATE_HOME: `${root}/state`, TMPDIR: `${root}/tmp`,
  OPENCODE_CONFIG_DIR: `${root}/config`, OPENCODE_DB: `${root}/db/opencode.db`,
  GIT_CONFIG_GLOBAL: `${root}/empty.gitconfig`,
};
const baseConfig = {
  model: 'fixture-provider/fixture-model', update: 'disable', share: 'disabled', snapshots: false,
  providers: {
    'fixture-provider': {
      env: [], package: '@opencode/ai/providers/openai-compatible',
      settings: { baseURL: `${providerOrigin}/v1`, apiKey: 'fixture-only' },
      models: { 'fixture-model': { type: 'chat', capabilities: { tools: true, input: ['text'], output: ['text'] }, limit: { context: 131072, output: 2048 } } },
    },
  },
};
const config = JSON.stringify(baseConfig);
const agentProfile = {
  permissions: [{ action: '*', resource: '*', effect: 'deny' }],
  agents: {
    fixture_parent: { mode: 'primary', permissions: [{ action: 'subagent', resource: 'fixture_child', effect: 'allow' }, { action: 'read', resource: '*', effect: 'deny' }] },
    fixture_child: { mode: 'subagent', permissions: [{ action: 'read', resource: '*', effect: 'deny' }] },
  },
  compaction: { auto: false, keep: { tokens: 0 }, buffer: 0 },
};
const script = `${root}/mcp.ts`;
const localMcp = { type: 'local', command: ['/usr/bin/bun', '--no-env-file', script], cwd: root, protocol: 'legacy' };
const mcpProfile = { mcp: { servers: { fixture_direct: { ...localMcp, codemode: false }, fixture_code: { ...localMcp, codemode: true } } } };
function input(): IsolationInput {
  return { root, cwd: `${root}/workspace`, paths: { ...paths }, config, providerOrigin, password, host: '127.0.0.1', port: 0,
    hostEnvironment: { OPENCODE_TEST_BINARY: executable, HOME: '/host/private', OPENAI_API_KEY: 'host-provider-secret', OPENCODE_CONFIG: '/host/config', PATH: '/host/bin', UNRELATED: 'host-secret' } };
}
function metadata(overrides: Record<string, Metadata> = {}): Inspect {
  return vi.fn(async (path: string): Promise<Metadata> => {
    if (Object.hasOwn(overrides, path)) return overrides[path];
    if (path === '/etc/opencode') return 'missing';
    if (path === paths.GIT_CONFIG_GLOBAL || path === script) return 'file';
    if (path === paths.OPENCODE_DB) return 'missing';
    return path === root || path.startsWith(`${root}/`) ? 'directory' : 'missing';
  });
}
async function expectDenied(value: IsolationInput, inspect: Inspect = metadata()) {
  const launch = vi.fn(async () => {});
  await expect(launchIsolated(value, inspect, launch)).rejects.toThrow();
  expect(launch).not.toHaveBeenCalled();
}

// Linux-only for now: the isolation guard models POSIX paths (/etc/opencode, absolute binaries, link checks).
// Native Windows OpenCode needs its own isolated setup; see docs/windows-verification.md "Think conversation gate".
describe.skipIf(process.platform === 'win32')('OpenCode isolated launch guard', () => {
  it('prepares a fixed foreground loopback spec from a complete isolated fixture without spawning', async () => {
    const inspect = metadata();
    const spec = await prepareIsolatedLaunch(input(), inspect);
    expect(inspect).toHaveBeenCalledWith('/etc/opencode');
    expect(spec.executable).toBe(executable);
    expect(spec.args).toEqual(['serve', '--hostname', '127.0.0.1', '--port', '0']);
    expect(spec.cwd).toBe(`${root}/workspace`);
    expect(spec.env).toEqual({
      ...paths, OPENCODE_CONFIG_CONTENT: config, OPENCODE_CONFIG_PROJECT_DISABLE: '1',
      OPENCODE_DISABLE_CLAUDE_CODE: '1', OPENCODE_DISABLE_MODELS_FETCH: '1', OPENCODE_DISABLE_FREE_MODELS: '1',
      OPENCODE_DISABLE_AUTOUPDATE: '1', OPENCODE_DISABLE_FILEWATCHER: '1', OPENCODE_DISABLE_FFF: '1',
      OPENCODE_PASSWORD: password, PATH: '/usr/bin:/bin', GIT_CONFIG_NOSYSTEM: '1',
    });
    const output = JSON.stringify({ executable: spec.executable, args: spec.args, cwd: spec.cwd, env: spec.env });
    expect(output).not.toContain('host-provider-secret');
    expect(output).not.toContain('/host/private');
    expect(output).not.toContain('/host/config');
    expect(output).not.toContain('host-secret');
    expect(JSON.stringify(spec.args)).not.toContain(password);
  });

  it.each([
    ['controlled agents and compaction', agentProfile],
    ['owned stdio MCP servers', mcpProfile],
  ])('accepts the %s fixture profile without spawning', async (_label, profile) => {
    const value = input();
    value.config = JSON.stringify({ ...baseConfig, ...profile });
    const inspect = metadata();
    const spec = await prepareIsolatedLaunch(value, inspect);
    expect(spec.env.OPENCODE_CONFIG_CONTENT).toBe(value.config);
    expect(spec.executable).toBe(executable);
    expect(inspect).toHaveBeenCalledWith('/etc/opencode');
    if ('mcp' in profile) expect(inspect).toHaveBeenCalledWith(script);
  });

  it('rejects unknown agent fields instead of expanding the fixture profile', async () => {
    const value = input();
    value.config = JSON.stringify({ ...baseConfig, ...agentProfile, agents: { ...agentProfile.agents, fixture_child: { ...agentProfile.agents.fixture_child, shell: '/bin/sh' } } });
    await expectDenied(value);
  });

  it.each([undefined, '', 'opencode', './opencode'])('rejects a missing or relative binary selector before launching: %s', async selector => {
    const value = input();
    value.hostEnvironment.OPENCODE_TEST_BINARY = selector;
    await expectDenied(value);
  });

  it('uses the explicit absolute binary selector without leaking it into the child environment', async () => {
    const value = input();
    value.hostEnvironment.OPENCODE_TEST_BINARY = '/opt/other-owned/opencode';
    const spec = await prepareIsolatedLaunch(value, metadata());
    expect(spec.executable).toBe('/opt/other-owned/opencode');
    expect(spec.env).not.toHaveProperty('OPENCODE_TEST_BINARY');
  });

  it.each([
    ['unknown server', { ...localMcp, codemode: false }, 'unexpected_server'],
    ['outside script', { ...localMcp, command: ['/usr/bin/bun', '--no-env-file', '/tmp/elsewhere/mcp.ts'], codemode: false }, 'fixture_direct'],
    ['package runner', { ...localMcp, command: ['/usr/bin/npm', 'exec', script], codemode: false }, 'fixture_direct'],
    ['unexpected Bun flags', { ...localMcp, command: ['/usr/bin/bun', 'run', script], codemode: false }, 'fixture_direct'],
  ])('rejects %s in a stdio MCP profile before launching', async (_label, server, name) => {
    const value = input();
    value.config = JSON.stringify({ ...baseConfig, mcp: { servers: { [name]: server } } });
    await expectDenied(value);
  });

  it.each(['symlink', 'directory', 'missing', 'error'] as const)('requires the fixture MCP script to be a regular non-link file, not %s', async state => {
    const value = input();
    value.config = JSON.stringify({ ...baseConfig, ...mcpProfile });
    const inspect = metadata({ [script]: state });
    await expectDenied(value, inspect);
    expect(inspect).toHaveBeenCalledWith(script);
  });

  it.each([
    ['root', (value: IsolationInput) => { value.root = ''; }],
    ['cwd', (value: IsolationInput) => { value.cwd = ''; }],
    ['provider', (value: IsolationInput) => { value.providerOrigin = ''; }],
    ['config', (value: IsolationInput) => { value.config = ''; }],
    ['password', (value: IsolationInput) => { value.password = ''; }],
    ['config directory selector', (value: IsolationInput) => { delete value.paths.OPENCODE_CONFIG_DIR; }],
    ['database selector', (value: IsolationInput) => { delete value.paths.OPENCODE_DB; }],
    ['home selector', (value: IsolationInput) => { delete value.paths.OPENCODE_TEST_HOME; }],
  ])('fails closed without launching when %s is missing', async (_label, mutate) => {
    const value = input(); mutate(value);
    await expectDenied(value);
  });

  it.each([
    ['outside cwd', (value: IsolationInput) => { value.cwd = '/tmp/outside/workspace'; }],
    ['traversal', (value: IsolationInput) => { value.paths.XDG_DATA_HOME = `${root}/../outside`; }],
    ['outside database', (value: IsolationInput) => { value.paths.OPENCODE_DB = '/tmp/elsewhere/opencode.db'; }],
    ['outside root', (value: IsolationInput) => { value.root = '/home/fixture'; }],
  ])('rejects %s without launching', async (_label, mutate) => {
    const value = input(); mutate(value);
    await expectDenied(value);
  });

  it.each(['directory', 'file', 'symlink', 'error'] as const)('requires /etc/opencode to be definitely absent, not %s', async state => {
    const inspect = metadata({ '/etc/opencode': state });
    await expectDenied(input(), inspect);
    expect(inspect).toHaveBeenCalledWith('/etc/opencode');
  });

  it.each([`${root}/workspace`, `${root}/home`, `${root}/db`, `${root}/empty.gitconfig`])('rejects symlinked isolation path %s', async path => {
    await expectDenied(input(), metadata({ [path]: 'symlink' }));
  });

  it.each(['localhost', '0.0.0.0', '127.0.0.2'])('rejects nonnumeric-exact daemon bind host %s', async host => {
    await expectDenied({ ...input(), host });
  });
  it('rejects a fixed daemon port', async () => { await expectDenied({ ...input(), port: 3001 }); });
  it.each(['https://example.invalid:443', 'http://localhost:1234', 'http://127.0.0.1:0', 'http://user:secret@127.0.0.1:18491', 'http://127.0.0.1:18491/path', 'http://127.0.0.1:18491?x=1'])('rejects unsafe provider origin %s', async origin => {
    await expectDenied({ ...input(), providerOrigin: origin });
  });
  it('rejects provider configuration pointing elsewhere than the owned fixture origin', async () => {
    const value = input();
    value.config = value.config.replace(providerOrigin, 'https://external.example');
    await expectDenied(value);
  });
});
