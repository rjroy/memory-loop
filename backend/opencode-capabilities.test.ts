import { createHash, randomBytes } from 'node:crypto';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createReadStream, writeFileSync } from 'node:fs';
import { chmod, copyFile, lstat, mkdir, mkdtemp, open, readFile, readlink, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import { isAbsolute, join, normalize, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OpenCode } from '@opencode/client';
import type { SessionMessageInfo } from '@opencode/client';
import { Service } from '@opencode/client/service';
import { expect, it } from 'vitest';
import { prepareIsolatedLaunch, type Inspect } from '../tests/opencode/isolation';
import { readinessFromOutput } from '../tests/opencode/readiness';

const anchor = '/tmp/opencode';
const forbiddenPorts = new Set([3000, 3001, 9443, 4173, 4317, 48763]);
const cliSuffix = '/@opencode+cli@2.2.2/node_modules/@opencode/cli/bin/opencode.exe';

async function hashFile(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

async function preflightExecutable(executable: string): Promise<void> {
  if (process.platform !== 'linux' || process.arch !== 'x64') throw new Error('unsupported native fixture platform');
  if (!isAbsolute(executable) || normalize(executable) !== executable || executable.includes('\0') || !executable.endsWith(cliSuffix)) throw new Error('invalid native binary selector');
  const install = executable.slice(0, -cliSuffix.length);
  const cliPackage = join(install, '@opencode+cli@2.2.2/node_modules/@opencode/cli');
  const platformPackage = join(install, '@opencode+cli-linux-x64@2.2.2/node_modules/@opencode/cli-linux-x64');
  const platformExecutable = join(platformPackage, 'bin/opencode');
  for (const path of [cliPackage, platformPackage, executable, platformExecutable, join(cliPackage, 'package.json'), join(platformPackage, 'package.json')]) {
    if (await realpath(path) !== path) throw new Error('native installation contains a symlink');
  }
  const [cliStat, platformStat, cliRaw, platformRaw] = await Promise.all([
    lstat(executable), lstat(platformExecutable), readFile(join(cliPackage, 'package.json'), 'utf8'), readFile(join(platformPackage, 'package.json'), 'utf8'),
  ]);
  if (!cliStat.isFile() || !platformStat.isFile() || !(cliStat.mode & 0o111) || !(platformStat.mode & 0o111)) throw new Error('native executable is not an executable regular file');
  const file = await open(executable, 'r');
  try {
    const signature = Buffer.alloc(4);
    const { bytesRead } = await file.read(signature, 0, 4, 0);
    if (bytesRead !== 4 || !signature.equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) throw new Error('native executable is not ELF');
  } finally { await file.close(); }
  const cli: unknown = JSON.parse(cliRaw);
  const platform: unknown = JSON.parse(platformRaw);
  if (typeof cli !== 'object' || cli === null || !('name' in cli) || cli.name !== '@opencode/cli' || !('version' in cli) || cli.version !== '2.2.2' ||
      typeof platform !== 'object' || platform === null || !('name' in platform) || platform.name !== '@opencode/cli-linux-x64' || !('version' in platform) || platform.version !== '2.2.2') {
    throw new Error('native package metadata mismatch');
  }
  if (cliStat.dev !== platformStat.dev || cliStat.ino !== platformStat.ino) {
    if (await hashFile(executable) !== await hashFile(platformExecutable)) throw new Error('native binary does not match installed platform package');
  }
}

const inspect: Inspect = async path => {
  try {
    const stat = await lstat(path);
    return stat.isSymbolicLink() ? 'symlink' : stat.isDirectory() ? 'directory' : stat.isFile() ? 'file' : 'error';
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'error';
  }
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

async function bounded<T>(promise: Promise<T>, label: string, ms = 12000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}

function isOwnedAbort(error: unknown, signal: AbortSignal): boolean {
  return signal.aborted && (error === signal.reason || (error instanceof Error && error.name === 'ClientError' &&
    'reason' in error && error.reason === 'Transport' && error.cause === signal.reason));
}

async function stopChild(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.pid === undefined) throw new Error('owned child has no PID');
  const exited: Promise<void> = child.exitCode !== null || child.signalCode !== null
    ? Promise.resolve() : once(child, 'exit').then(() => {});
  try { process.kill(-child.pid, 'SIGTERM'); }
  catch (error: unknown) { if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) throw error; }
  try { await bounded(exited, 'child termination', 3000); }
  catch {
    try { process.kill(-child.pid, 'SIGKILL'); }
    catch (error: unknown) { if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) throw error; }
    await bounded(exited, 'child kill', 3000);
  }
  try { process.kill(-child.pid, 'SIGKILL'); }
  catch (error: unknown) { if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) throw error; }
}

it.each(['baseline', 'agent', 'mcp'] as const)('characterizes native capabilities using the %s fixture profile', async profile => {
  // No contents of the system configuration are read, even when inspection fails.
  if (await inspect('/etc/opencode') !== 'missing') throw new Error('system OpenCode configuration is not definitely absent');
  if (await inspect(anchor) !== 'directory' || await realpath(anchor) !== anchor) throw new Error('untrusted fixture anchor');
  const executable = process.env.OPENCODE_TEST_BINARY;
  if (!executable) throw new Error('OPENCODE_TEST_BINARY is required');
  await preflightExecutable(executable);
  const root = await mkdtemp(join(anchor, 'native-capability-'));
  const receipt = join(anchor, `native-receipt-${randomBytes(16).toString('hex')}.json`);
  let receiptState: Record<string, string | number> = { status: 'prepared' };
  writeFileSync(receipt, JSON.stringify(receiptState), { mode: 0o600, flag: 'wx' });
  const recordReceipt = (update: Record<string, string | number>) => {
    receiptState = { ...receiptState, ...update };
    writeFileSync(receipt, JSON.stringify(receiptState), { mode: 0o600 });
  };
  const release = deferred<void>();
  const stopRelease = deferred<void>();
  const requestSeen = deferred<void>();
  const readRequested = deferred<void>();
  const readResultSeen = deferred<void>();
  const stopPartial = deferred<void>();
  const sentinelPath = join(root, 'owned-external', 'sentinel.env');
  let allowInterruption = false;
  let readAdvertised = false;
  let fixturePassword = '';
  let phase = 'recovery';
  const cleanupAbort = new Error('fixture follower cleanup');
  const watchers: Array<{ controller: AbortController; outcome: Promise<{ kind: 'complete' } | { kind: 'error'; error: unknown }> }> = [];
  let diagnostics: (() => Promise<void>) | undefined;
  let child: ChildProcessWithoutNullStreams | undefined;
  const pending = new Set<ServerResponse>();
  let requests = 0;
  let responsesFinished = 0;
  let responsesClosed = 0;
  const eventCounts: Record<string, number> = {};
  let badRequest = false;
  const providerReasons: Record<string, number> = {};
  const providerPhases: Record<string, Record<string, number>> = {};
  const mcpRequestShapes: Array<Record<string, string | number | boolean>> = [];
  let invalidMcpToolWarnings = 0;
  let invalidRegistrationWarnings = 0;
  const countProvider = (requestPhase: string, category: string) => {
    const counts = providerPhases[requestPhase] ??= {};
    counts[category] = (counts[category] ?? 0) + 1;
  };
  const rejectProvider = (requestPhase: string, reason: string) => {
    badRequest = true;
    const key = `${requestPhase}:${reason}`;
    providerReasons[key] = (providerReasons[key] ?? 0) + 1;
  };
  const recordProvider = () => recordReceipt({ providerReasonCounts: JSON.stringify(providerReasons), providerPhaseCounts: JSON.stringify(providerPhases), providerBadRequest: badRequest ? 1 : 0, mcpRequestShapes: JSON.stringify(mcpRequestShapes), invalidMcpToolWarnings, invalidRegistrationWarnings });
  const largeText = 'L'.repeat(80 * 1024);
  const compactSummary = '## Objective\nPreserve the fixture conversation.\n\n## Work State\n### Completed\n- Completed the fixture exchange.\n\n## Next Move\n1. Continue fixture checks.';
  const stub = createServer((request, response) => {
    const requestPhase = phase;
    countProvider(requestPhase, 'received');
    response.once('finish', () => countProvider(requestPhase, 'finished'));
    response.once('close', () => countProvider(requestPhase, 'closed'));
    if (request.method !== 'POST') { rejectProvider(requestPhase, 'bad-method'); response.writeHead(404).end(); return; }
    if (request.url !== '/v1/chat/completions') { rejectProvider(requestPhase, 'bad-path'); response.writeHead(404).end(); return; }
    let body = '';
    let oversized = false;
    request.setEncoding('utf8');
    request.on('data', chunk => {
      body += chunk;
      if (body.length > 1_000_000 && !oversized) { oversized = true; rejectProvider(requestPhase, 'body-limit'); request.destroy(); }
    });
    request.on('aborted', () => {
      if (oversized) return;
      if (requestPhase === 'interrupt') countProvider(requestPhase, 'interrupt-request-aborted');
      else rejectProvider(requestPhase, 'request-aborted');
    });
    request.on('error', () => { if (!oversized && !request.aborted) rejectProvider(requestPhase, 'request-error'); });
    request.on('end', () => {
      let parsed: unknown;
      try { parsed = JSON.parse(body); } catch { rejectProvider(requestPhase, 'invalid-json'); response.writeHead(400).end(); return; }
      if (!parsed || typeof parsed !== 'object') { rejectProvider(requestPhase, 'invalid-json-shape'); response.writeHead(400).end(); return; }
      if (!('model' in parsed) || parsed.model !== 'fixture-model') { rejectProvider(requestPhase, 'invalid-model'); response.writeHead(400).end(); return; }
      if (!('messages' in parsed) || !Array.isArray(parsed.messages)) { rejectProvider(requestPhase, 'invalid-messages'); response.writeHead(400).end(); return; }
      countProvider(requestPhase, !('stream' in parsed) ? 'stream-absent' : parsed.stream === true ? 'stream-true' : parsed.stream === false ? 'stream-false' : 'stream-other');
      const messages: unknown[] = parsed.messages;
      const user = [...messages].reverse().find(message => typeof message === 'object' && message !== null && 'role' in message && message.role === 'user');
      const userText = user && typeof user === 'object' && 'content' in user ? JSON.stringify(user.content) : '';
      const readTurn = userText.includes('fixture-read-request');
      const stopTurn = userText.includes('fixture-stop-request');
      const childTurn = userText.includes('fixture-child-read');
      const parentTurn = userText.includes('fixture-parent-delegate');
      const largeTurn = userText.includes('fixture-large-request');
      const directTurn = userText.includes('fixture-mcp-direct-request');
      const codeTurn = userText.includes('fixture-mcp-code-request');
      const toolResult = messages.find(message => typeof message === 'object' && message !== null && 'role' in message && message.role === 'tool' &&
        'tool_call_id' in message && message.tool_call_id === 'fixture-read-call' && 'content' in message && JSON.stringify(message.content).includes('fixture-read-ok'));
      const childResult = messages.find(message => typeof message === 'object' && message !== null && 'role' in message && message.role === 'tool' &&
        'tool_call_id' in message && message.tool_call_id === 'fixture-child-call' && 'content' in message && JSON.stringify(message.content).includes('fixture-child-complete'));
      const tools = 'tools' in parsed && Array.isArray(parsed.tools) ? parsed.tools : [];
      const instructions = JSON.stringify(messages.filter(message => typeof message === 'object' && message !== null && 'role' in message && (message.role === 'system' || message.role === 'developer')));
      const codeNamespaceInInstructions = instructions.includes('fixture_code');
      const hasRead = () => tools.some((tool: unknown) => typeof tool === 'object' && tool !== null && 'function' in tool && typeof tool.function === 'object' && tool.function !== null && 'name' in tool.function && tool.function.name === 'read');
      const hasTool = (name: string) => tools.some((tool: unknown) => typeof tool === 'object' && tool !== null && 'function' in tool && typeof tool.function === 'object' && tool.function !== null && 'name' in tool.function && tool.function.name === name);
      if (profile === 'mcp' && mcpRequestShapes.length < 24) {
        const allText = JSON.stringify(messages);
        const last = messages.at(-1);
        const scrub = (value: string) => {
          let cleaned = value.replaceAll(root, '[fixture-root]').replace(/\b(?:ses|msg|evt)_[A-Za-z0-9_-]+/g, '[native-id]');
          if (fixturePassword) cleaned = cleaned.replaceAll(fixturePassword, '[credential]');
          return cleaned.replace(/[\x00-\x1f\x7f]/g, ' ');
        };
        const functions = tools.flatMap((tool: unknown) => typeof tool === 'object' && tool !== null && 'function' in tool && typeof tool.function === 'object' && tool.function !== null ? [tool.function] : []);
        const names = functions.flatMap(fn => 'name' in fn && typeof fn.name === 'string' && /^[A-Za-z0-9_.-]{1,128}$/.test(fn.name) ? [scrub(fn.name)] : []).slice(0, 32);
        mcpRequestShapes.push({
          phase: requestPhase, markerDirect: allText.includes('fixture-mcp-direct-request'), markerCode: allText.includes('fixture-mcp-code-request'),
          directLatestUser: directTurn, codeLatestUser: codeTurn,
          latestMessageIsUser: typeof last === 'object' && last !== null && 'role' in last && last.role === 'user',
          toolCount: Math.min(tools.length, 1000), read: hasTool('read'), subagent: hasTool('subagent'), execute: hasTool('execute'),
          directEcho: hasTool('fixture_direct_echo'), codeEcho: hasTool('fixture_code_echo'),
          functionNames: JSON.stringify(names), codeNamespaceInInstructions,
        });
      }
      const resultFor = (id: string, marker: string) => messages.some(message => typeof message === 'object' && message !== null && 'role' in message && message.role === 'tool' && 'tool_call_id' in message && message.tool_call_id === id && 'content' in message && JSON.stringify(message.content).includes(marker));
      requests++;
      pending.add(response);
      response.once('finish', () => { responsesFinished++; });
      response.once('close', () => { pending.delete(response); responsesClosed++; });
      const emit = (delta: object, finish: 'stop' | 'tool_calls') => {
        if (response.destroyed || response.writableEnded) return;
        response.writeHead(200, { 'content-type': 'text/event-stream' });
        const frame = (data: object) => response.write(`data: ${JSON.stringify(data)}\n\n`);
        frame({ id: 'fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture-model', choices: [{ index: 0, delta, finish_reason: null }] });
        frame({ id: 'fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture-model', choices: [{ index: 0, delta: {}, finish_reason: finish }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
        response.end('data: [DONE]\n\n');
      };
      if (profile === 'mcp' && directTurn && resultFor('fixture-direct-call', 'direct-fixture-ok')) {
        countProvider(requestPhase, 'mcp-direct-result'); emit({ content: 'fixture-direct-complete' }, 'stop');
      } else if (profile === 'mcp' && directTurn && requestPhase === 'mcp-direct' && hasTool('fixture_direct_echo')) {
        countProvider(requestPhase, 'mcp-direct-call'); emit({ tool_calls: [{ index: 0, id: 'fixture-direct-call', type: 'function', function: { name: 'fixture_direct_echo', arguments: JSON.stringify({ text: 'direct-fixture-ok' }) } }] }, 'tool_calls');
      } else if (profile === 'mcp' && codeTurn && resultFor('fixture-code-call', 'code-fixture-ok')) {
        countProvider(requestPhase, 'mcp-code-result'); emit({ content: 'fixture-code-complete' }, 'stop');
      } else if (profile === 'mcp' && codeTurn && requestPhase === 'mcp-code' && hasTool('execute') && codeNamespaceInInstructions) {
        countProvider(requestPhase, 'mcp-code-call'); emit({ tool_calls: [{ index: 0, id: 'fixture-code-call', type: 'function', function: { name: 'execute', arguments: JSON.stringify({ code: 'return await tools.fixture_code.echo({text:"code-fixture-ok"});' }) } }] }, 'tool_calls');
      } else if (profile === 'agent' && phase === 'agent-compact') {
        countProvider(requestPhase, 'compaction-response');
        emit({ content: compactSummary }, 'stop');
      } else if (profile === 'agent' && childTurn && toolResult) {
        countProvider(requestPhase, 'child-read-result');
        emit({ content: 'fixture-child-complete' }, 'stop');
      } else if (profile === 'agent' && childTurn) {
        if (!hasRead()) { rejectProvider(requestPhase, 'child-read-not-advertised'); response.writeHead(400).end(); return; }
        countProvider(requestPhase, 'child-read-call');
        emit({ tool_calls: [{ index: 0, id: 'fixture-read-call', type: 'function', function: { name: 'read', arguments: JSON.stringify({ path: sentinelPath }) } }] }, 'tool_calls');
      } else if (profile === 'agent' && parentTurn && childResult) {
        countProvider(requestPhase, 'parent-child-result');
        emit({ content: 'fixture-parent-complete' }, 'stop');
      } else if (profile === 'agent' && parentTurn) {
        if (!tools.some((tool: unknown) => typeof tool === 'object' && tool !== null && 'function' in tool && typeof tool.function === 'object' && tool.function !== null && 'name' in tool.function && tool.function.name === 'subagent')) { rejectProvider(requestPhase, 'parent-subagent-not-advertised'); response.writeHead(400).end(); return; }
        countProvider(requestPhase, 'parent-subagent-call');
        emit({ tool_calls: [{ index: 0, id: 'fixture-child-call', type: 'function', function: { name: 'subagent', arguments: JSON.stringify({ agent: 'fixture_child', description: 'Read fixture sentinel', prompt: `fixture-child-read ${sentinelPath}`, background: false }) } }] }, 'tool_calls');
      } else if (profile === 'agent' && largeTurn) {
        countProvider(requestPhase, 'large-response');
        emit({ content: largeText }, 'stop');
      } else if (readTurn && toolResult && (requestPhase === 'read-tool' || requestPhase === 'agent-root-read')) {
        countProvider(requestPhase, 'read-result');
        readResultSeen.resolve();
        emit({ content: 'fixture-read-complete' }, 'stop');
      } else if (readTurn && (requestPhase === 'read-tool' || requestPhase === 'agent-root-read') && hasRead()) {
        readAdvertised = hasRead();
        if (!readAdvertised) { rejectProvider(requestPhase, 'read-not-advertised'); response.writeHead(400).end(); return; }
        countProvider(requestPhase, 'read-call');
        readRequested.resolve();
        emit({ tool_calls: [{ index: 0, id: 'fixture-read-call', type: 'function', function: { name: 'read', arguments: JSON.stringify({ path: sentinelPath }) } }] }, 'tool_calls');
      } else if (readTurn) {
        countProvider(requestPhase, 'read-marker-auxiliary');
        emit({ content: 'fixture-aux' }, 'stop');
      } else if (stopTurn) {
        countProvider(requestPhase, 'stop-response');
        response.writeHead(200, { 'content-type': 'text/event-stream' });
        response.write(`data: ${JSON.stringify({ id: 'fixture-stop', object: 'chat.completion.chunk', created: 1, model: 'fixture-model', choices: [{ index: 0, delta: { content: 'fixture-stop-partial' }, finish_reason: null }] })}\n\n`);
        void stopRelease.promise.then(() => { if (!response.destroyed && !response.writableEnded) response.end('data: [DONE]\n\n'); });
      } else if (userText.includes('fixture prompt')) {
        countProvider(requestPhase, 'recovery-response');
        requestSeen.resolve();
        void release.promise.then(() => emit({ content: 'fixture-ok' }, 'stop'));
      } else { countProvider(requestPhase, 'auxiliary-response'); emit({ content: 'fixture-aux' }, 'stop'); }
    });
  });
  try {
    await Promise.all(['home', 'xdg-config', 'data', 'cache', 'state', 'tmp', 'config', 'db', 'workspace'].map(dir => mkdir(join(root, dir), { mode: 0o700 })));
    await mkdir(join(root, 'owned-external'), { mode: 0o700 });
    await writeFile(sentinelPath, 'fixture-read-ok', { mode: 0o600, flag: 'wx' });
    await writeFile(join(root, 'empty.gitconfig'), '', { mode: 0o600, flag: 'wx' });
    if (profile === 'mcp') {
      await copyFile(fileURLToPath(new URL('../tests/opencode/mcp-fixture.ts', import.meta.url)), join(root, 'mcp.ts'));
      await chmod(join(root, 'mcp.ts'), 0o600);
      await writeFile(join(root, 'mcp-witness.jsonl'), '', { mode: 0o600, flag: 'wx' });
      await symlink(fileURLToPath(new URL('../node_modules', import.meta.url)), join(root, 'node_modules'), 'dir');
    }
    stub.listen(0, '127.0.0.1');
    await bounded(once(stub, 'listening'), 'fixture provider startup');
    const address = stub.address();
    if (!address || typeof address === 'string' || address.address !== '127.0.0.1' || forbiddenPorts.has(address.port)) throw new Error('invalid fixture provider address');
    const origin = `http://127.0.0.1:${address.port}`;
    const password = randomBytes(24).toString('hex');
    fixturePassword = password;
    const paths = {
      HOME: join(root, 'home'), OPENCODE_TEST_HOME: join(root, 'home'), XDG_CONFIG_HOME: join(root, 'xdg-config'),
      XDG_DATA_HOME: join(root, 'data'), XDG_CACHE_HOME: join(root, 'cache'), XDG_STATE_HOME: join(root, 'state'),
      TMPDIR: join(root, 'tmp'), OPENCODE_CONFIG_DIR: join(root, 'config'), OPENCODE_DB: join(root, 'db/opencode.db'),
      GIT_CONFIG_GLOBAL: join(root, 'empty.gitconfig'),
    };
    const config = JSON.stringify({ model: 'fixture-provider/fixture-model', update: 'disable', share: 'disabled', snapshots: false,
      ...(profile === 'agent' ? {
        permissions: [{ action: '*', resource: '*', effect: 'deny' }],
        agents: {
          fixture_parent: { mode: 'primary', permissions: [{ action: 'subagent', resource: 'fixture_child', effect: 'allow' }, { action: 'read', resource: '*', effect: 'deny' }] },
          fixture_child: { mode: 'subagent', permissions: [{ action: 'read', resource: '*', effect: 'deny' }] },
        },
        compaction: { auto: false, keep: { tokens: 0 }, buffer: 0 },
      } : {}),
      ...(profile === 'mcp' ? { mcp: { servers: {
        fixture_direct: { type: 'local', command: ['/usr/bin/bun', '--no-env-file', join(root, 'mcp.ts')], cwd: root, protocol: 'legacy', codemode: false },
        fixture_code: { type: 'local', command: ['/usr/bin/bun', '--no-env-file', join(root, 'mcp.ts')], cwd: root, protocol: 'legacy', codemode: true },
      } } } : {}),
      providers: { 'fixture-provider': { env: [], package: '@opencode/ai/providers/openai-compatible', settings: { baseURL: `${origin}/v1`, apiKey: 'fixture-only' },
        models: { 'fixture-model': { type: 'chat', capabilities: { tools: true, input: ['text'], output: ['text'] }, limit: { context: 131072, output: 2048 } } } } } });
    const cwd = join(root, 'workspace');
    const spec = await prepareIsolatedLaunch({ root, cwd, paths, config, providerOrigin: origin, password, host: '127.0.0.1', port: 0, hostEnvironment: { OPENCODE_TEST_BINARY: executable } }, inspect);
    if (spec.executable !== executable) throw new Error('guard selected an unverified executable');
    recordReceipt({ status: 'version-attempt', versionStatus: 'attempt' });
    const versionStarted = Date.now();
    const versionChild = spawn(spec.executable, ['--version'], { cwd: spec.cwd, env: spec.env as NodeJS.ProcessEnv, detached: true, stdio: 'pipe' });
    let versionOutput = '';
    let versionBytes = 0;
    let versionOverflow = false;
    let versionCode: number | 'not-observed' = 'not-observed';
    let versionSignal: string = 'not-observed';
    let versionStatus = 'pending';
    const versionDetails = () => {
      const text = versionOutput.trim();
      const bare = /^(\d{1,4}\.\d{1,4}\.\d{1,4})$/.exec(text);
      const prefixed = /^opencode\s+v(\d{1,4}\.\d{1,4}\.\d{1,4})$/.exec(text);
      const token = bare?.[1] ?? prefixed?.[1];
      return {
        versionStatus, versionElapsedMs: Date.now() - versionStarted, versionOutputBytes: versionBytes,
        versionExitCode: versionCode, versionSignal, versionOverflow: versionOverflow ? 'yes' : 'no',
        versionOutputShape: versionOverflow ? 'overflow' : bare ? 'bare-version' : prefixed ? 'opencode-v-version' : 'unrecognized',
        ...(token ? { versionParsed: token } : {}),
      };
    };
    const collectVersion = (chunk: Buffer) => {
      versionBytes += chunk.length;
      if (versionBytes > 4096) { versionOverflow = true; return; }
      versionOutput += chunk.toString();
    };
    versionChild.stdout.on('data', collectVersion);
    versionChild.stderr.on('data', collectVersion);
    try {
      if (versionChild.pid === undefined) throw new Error('version process did not provide an owned PID');
      recordReceipt({ status: 'version-running', versionPid: versionChild.pid, versionProcessGroup: versionChild.pid });
      const [code, signal] = await bounded(once(versionChild, 'close'), 'native version', 5000);
      versionCode = typeof code === 'number' ? code : 'not-observed';
      versionSignal = typeof signal === 'string' ? signal : 'none';
      if (signal !== null) versionStatus = 'signal';
      else if (code !== 0) versionStatus = 'exit-nonzero';
      else if (versionOverflow) versionStatus = 'output-cap';
      else if (versionOutput.trim() !== 'opencode v2.2.2') versionStatus = 'unexpected-format-or-version';
      else versionStatus = 'verified';
      if (versionStatus !== 'verified') throw new Error(`native version ${versionStatus}`);
      recordReceipt({ status: 'version-verified', ...versionDetails() });
    } catch (error) {
      if (versionStatus === 'pending') versionStatus = error instanceof Error && error.message === 'native version timed out' ? 'timeout' : 'spawn-or-observation-error';
      const details = versionDetails();
      recordReceipt({ status: 'version-failed', ...details });
      throw new Error(`native version ${versionStatus} (${JSON.stringify(details)})`);
    } finally {
      try {
        await stopChild(versionChild);
        recordReceipt({ versionCleanup: 'leader-exited-group-kill-sent' });
      } catch (error) {
        recordReceipt({ status: 'cleanup-failed', versionCleanup: 'failed' });
        throw error;
      }
    }
    const owned = spawn(spec.executable, spec.args, { cwd: spec.cwd, env: spec.env as NodeJS.ProcessEnv, detached: true, stdio: 'pipe' });
    child = owned;
    if (owned.pid === undefined) throw new Error('native process did not provide an owned PID');
    recordReceipt({ status: 'running', pid: owned.pid, processGroup: owned.pid });
    const started = deferred<string>();
    let output = '';
    const onOutput = (chunk: Buffer) => {
      output += chunk.toString();
      if (output.length > 65536) output = output.slice(-65536);
      invalidMcpToolWarnings = (output.match(/skipping invalid MCP tool/gi) ?? []).length;
      invalidRegistrationWarnings = (output.match(/skipping invalid tool registration/gi) ?? []).length;
      const address = readinessFromOutput(output);
      if (address) started.resolve(address);
    };
    owned.stdout.on('data', onOutput);
    owned.stderr.on('data', onOutput);
    let url: string;
    try {
      url = await bounded(Promise.race([started.promise, once(owned, 'exit').then(() => { throw new Error('native process exited before listening'); })]), 'native startup');
    } catch {
      const markers = ['migration', 'database', 'download', 'install', 'initializ', 'plugin', 'server listening on', 'error']
        .filter(marker => output.toLowerCase().includes(marker));
      throw new Error(`native startup failed (output bytes: ${output.length}, markers: ${markers.join(', ') || 'none'})`);
    }
    const client = OpenCode.make({ baseUrl: url, headers: Service.headers({ url, auth: { type: 'basic', username: 'opencode', password } }) });
    const info = await bounded(client.server.info({ signal: AbortSignal.timeout(10000) }), 'native readiness');
    expect(info.version).toBe('2.2.2');
    expect(info.pid).toBe(owned.pid);
    const tempRelative = relative(root, info.paths.tmp);
    expect(tempRelative && !tempRelative.startsWith('..') && !tempRelative.startsWith('/')).toBe(true);
    const location = { directory: cwd };
    const models = await bounded(client.model.list({ location, types: ['chat'] }, { signal: AbortSignal.timeout(10000) }), 'catalog');
    const enabled = models.data.filter(model => model.enabled && model.type === 'chat');
    expect(enabled.map(model => [model.providerID, model.id])).toEqual([['fixture-provider', 'fixture-model']]);
    const defaultModel = await client.model.default({ location }, { signal: AbortSignal.timeout(10000) });
    expect([defaultModel.data?.providerID, defaultModel.data?.id]).toEqual(['fixture-provider', 'fixture-model']);
    phase = 'public-resources';
    const descriptor = join(root, 'service-discovery.json');
    const wrongDescriptor = join(root, 'service-discovery-wrong.json');
    await writeFile(descriptor, JSON.stringify({ url, pid: info.pid, version: info.version, password }), { mode: 0o600, flag: 'wx' });
    await writeFile(wrongDescriptor, JSON.stringify({ url, pid: info.pid, version: info.version, password: 'fixture-wrong-password' }), { mode: 0o600, flag: 'wx' });
    const endpoint = await bounded(Service.discover({ file: descriptor, version: '2.2.2' }), 'explicit discovery');
    expect(endpoint).toBeDefined();
    if (!endpoint) throw new Error('fixture discovery failed');
    const discovered = OpenCode.make({ baseUrl: endpoint.url, headers: Service.headers(endpoint) });
    const discoveredInfo = await bounded(discovered.server.info({ signal: AbortSignal.timeout(3000) }), 'discovered service info');
    expect(discoveredInfo.pid).toBe(info.pid);
    expect(discoveredInfo.version).toBe(info.version);
    expect(await bounded(Service.discover({ file: wrongDescriptor, version: '2.2.2' }), 'wrong-auth discovery')).toBeUndefined();
    recordReceipt({ explicitDiscovery: 'verified', wrongAuthDiscovery: 'denied' });

    const resourceSessionId = `ses_fixture_${randomBytes(12).toString('hex')}`;
    const resourcePromptId = `msg_fixture_${randomBytes(12).toString('hex')}`;
    const resourceInput = { id: resourceSessionId, location, model: { providerID: 'fixture-provider', id: 'fixture-model' }, permissions: [{ action: '*', resource: '*', effect: 'allow' as const }] };
    const resource = await client.session.create(resourceInput, { signal: AbortSignal.timeout(10000) });
    expect(resource.id).toBe(resourceSessionId);
    const repeated = await client.session.create({ ...resourceInput, title: 'Different fixture title' }, { signal: AbortSignal.timeout(10000) });
    expect(repeated.id).toBe(resource.id);
    expect(repeated.model).toEqual(resource.model);
    expect(repeated.location).toEqual(resource.location);
    expect(repeated.title).toBe(resource.title);
    expect(requests).toBe(0);
    const firstAdmission = await client.session.prompt({ sessionID: resource.id, id: resourcePromptId, text: 'first fixture text', resume: false }, { signal: AbortSignal.timeout(10000) });
    const duplicateAdmission = await client.session.prompt({ sessionID: resource.id, id: resourcePromptId, text: 'different fixture text', resume: false }, { signal: AbortSignal.timeout(10000) });
    expect(firstAdmission.id).toBe(resourcePromptId);
    expect(firstAdmission.payload.text).toBe('first fixture text');
    expect(duplicateAdmission.id).toBe(firstAdmission.id);
    expect(duplicateAdmission.payload).toEqual(firstAdmission.payload);
    const inbox = await client.session.inbox.list({ sessionID: resource.id }, { signal: AbortSignal.timeout(10000) });
    expect(inbox.filter(item => item.id === resourcePromptId)).toHaveLength(1);
    expect((await client.session.active({ signal: AbortSignal.timeout(3000) }))[resource.id]).toBeUndefined();
    expect(requests).toBe(0);
    await client.session.inbox.cancel({ sessionID: resource.id, inboxID: resourcePromptId }, { signal: AbortSignal.timeout(10000) });
    expect((await client.session.inbox.list({ sessionID: resource.id }, { signal: AbortSignal.timeout(10000) })).some(item => item.id === resourcePromptId)).toBe(false);
    recordReceipt({ suppliedSessionId: 'verified', duplicateAdmission: 'first-wins', resourceProviderRequests: requests });

    const form = await client.session.form.create({ sessionID: resource.id, title: 'Fixture question', fields: [{ key: 'answer', type: 'string', title: 'Answer', required: true }] }, { signal: AbortSignal.timeout(10000) });
    expect((await client.session.form.list({ sessionID: resource.id }, { signal: AbortSignal.timeout(10000) })).some(item => item.id === form.id)).toBe(true);
    expect((await client.session.form.get({ sessionID: resource.id, formID: form.id }, { signal: AbortSignal.timeout(10000) })).state.status).toBe('pending');
    await client.session.form.reply({ sessionID: resource.id, formID: form.id, answer: { answer: 'fixture answer' } }, { signal: AbortSignal.timeout(10000) });
    expect((await client.session.form.list({ sessionID: resource.id }, { signal: AbortSignal.timeout(10000) })).some(item => item.id === form.id)).toBe(false);
    expect((await client.session.form.get({ sessionID: resource.id, formID: form.id }, { signal: AbortSignal.timeout(10000) })).state).toEqual({ status: 'answered', answer: { answer: 'fixture answer' } });
    let secondReply = 'idempotent';
    try {
      await client.session.form.reply({ sessionID: resource.id, formID: form.id, answer: { answer: 'different fixture answer' } }, { signal: AbortSignal.timeout(10000) });
    } catch (error: unknown) {
      if (typeof error !== 'object' || error === null || !('_tag' in error) || error._tag !== 'FormAlreadySettledError') throw error;
      secondReply = 'already-settled';
    }
    expect((await client.session.form.get({ sessionID: resource.id, formID: form.id }, { signal: AbortSignal.timeout(10000) })).state).toEqual({ status: 'answered', answer: { answer: 'fixture answer' } });
    expect((await client.session.form.list({ sessionID: resource.id }, { signal: AbortSignal.timeout(10000) })).some(item => item.id === form.id)).toBe(false);
    expect(requests).toBe(0);
    recordReceipt({ formLifecycle: 'verified', repeatFormReply: secondReply });

    phase = 'recovery';
    const session = await client.session.create({ location, ...(profile === 'agent' ? { agent: 'fixture_parent' } : {}), model: { providerID: 'fixture-provider', id: 'fixture-model' }, permissions: [{ action: '*', resource: '*', effect: 'allow' }] }, { signal: AbortSignal.timeout(10000) });
    const subscriberTypes = ['session.execution.started', 'session.text.delta', 'session.text.ended', 'session.execution.succeeded', 'session.execution.failed', 'session.execution.interrupted'] as const;
    const makeWatcher = () => {
      const watcherClient = OpenCode.make({ baseUrl: url, headers: Service.headers({ url, auth: { type: 'basic', username: 'opencode', password } }) });
      const controller = new AbortController();
      const connected = deferred<void>();
      const started = deferred<void>();
      const watch = (async () => {
        for await (const event of watcherClient.event.subscribe({ types: subscriberTypes, signal: controller.signal })) {
          if (event.type === 'server.connected') { connected.resolve(); continue; }
          if (event.data.sessionID !== session.id) continue;
          eventCounts[event.type] = (eventCounts[event.type] ?? 0) + 1;
          if (event.type === 'session.execution.started') started.resolve();
          if (event.type === 'session.text.delta' && event.data.delta.includes('fixture-stop-partial')) stopPartial.resolve();
          if (event.type === 'session.execution.failed' || (event.type === 'session.execution.interrupted' && !allowInterruption)) throw new Error(`native ${event.type}`);
        }
        if (!controller.signal.aborted) throw new Error('native subscriber ended unexpectedly');
      })();
      const outcome = watch.then(() => ({ kind: 'complete' as const }), error => ({ kind: 'error' as const, error }));
      watchers.push({ controller, outcome });
      const stopped = outcome.then(result => {
        if (result.kind === 'error') throw result.error;
        throw new Error('native subscriber ended before expected event');
      });
      return { controller, connected: connected.promise, started: started.promise, outcome, stopped };
    };
    const daemonWatch = makeWatcher();
    const browserWatch = makeWatcher();
    const allHistory = async (reader: typeof client, sessionID = session.id): Promise<SessionMessageInfo[]> => {
      const messages: SessionMessageInfo[] = [];
      let cursor: string | undefined;
      const seen = new Set<string>();
      for (let page = 0; page < 100; page++) {
        const result = await reader.message.list(cursor ? { sessionID, cursor, limit: 50 } : { sessionID, order: 'asc', limit: 50 }, { signal: AbortSignal.timeout(3000) });
        messages.push(...result.data);
        const next = result.cursor.next;
        if (!next || result.data.length === 0) return messages;
        if (seen.has(next)) throw new Error('native history cursor repeated');
        seen.add(next); cursor = next;
      }
      throw new Error('native history page limit exceeded');
    };
    const textOf = (message: Extract<SessionMessageInfo, { type: 'assistant' }>) => message.content.filter(part => part.type === 'text').map(part => part.text).join('');
    diagnostics = async () => {
      if (profile === 'mcp') {
        try {
          const catalog = await bounded(client.mcp.list({ location }, { signal: AbortSignal.timeout(2000) }), 'fixture MCP status', 2500);
          const statuses = Object.fromEntries(catalog.data.filter(item => item.name === 'fixture_direct' || item.name === 'fixture_code').map(item => [item.name, item.status.status]));
          recordReceipt({ mcpStatuses: JSON.stringify(statuses) });
        } catch { recordReceipt({ mcpStatuses: 'unavailable' }); }
        try {
          const witness = await readFile(join(root, 'mcp-witness.jsonl'), 'utf8');
          const records: unknown[] = witness.trim().split('\n').filter(Boolean).slice(0, 100).map(line => JSON.parse(line));
          const categories = ['start', 'transport-connected', 'rpc-ready', 'tools-list', 'call', 'stop'];
          const counts = Object.fromEntries(categories.map(category => [category, records.filter(item => typeof item === 'object' && item !== null && 'event' in item && item.event === category).length]));
          recordReceipt({ mcpWitnessCounts: JSON.stringify(counts) });
        } catch { recordReceipt({ mcpWitnessCounts: 'unavailable' }); }
      }
      try {
        const [state, active, history] = await bounded(Promise.all([
          client.session.get({ sessionID: session.id }, { signal: AbortSignal.timeout(2000) }),
          client.session.active({ signal: AbortSignal.timeout(2000) }), allHistory(client),
        ]), 'safe diagnostics', 3000);
        const users = history.filter(message => message.type === 'user');
        const assistants = history.filter(message => message.type === 'assistant');
        recordReceipt({ phase, diagnosticStatus: 'available', nativeOutcome: state.outcome ?? 'unknown', nativeActive: active[session.id] ? 1 : 0,
          userCount: users.length, assistantCount: assistants.length,
          assistantTextLengths: JSON.stringify(assistants.map(message => textOf(message).length)),
          assistantFixtureMatches: assistants.filter(message => textOf(message) === 'fixture-ok').length,
          assistantFinish: JSON.stringify(assistants.map(message => message.finish ?? 'none')),
          assistantErrors: assistants.filter(message => message.error !== undefined).length,
          readAdvertised: readAdvertised ? 1 : 0,
          toolStates: JSON.stringify(assistants.flatMap(message => message.content.filter(part => part.type === 'tool').map(part => part.state.status))) });
      } catch { recordReceipt({ diagnosticStatus: 'unavailable' }); }
      recordReceipt({ eventCounts: JSON.stringify(eventCounts), providerRequests: requests, providerFinished: responsesFinished, providerClosed: responsesClosed });
    };
    if (profile === 'mcp') {
      await bounded(Promise.race([Promise.all([daemonWatch.connected, browserWatch.connected]), daemonWatch.stopped, browserWatch.stopped]), 'MCP subscriber connections');
      const readinessStarted = Date.now();
      let readinessPolls = 0;
      let connected = false;
      while (Date.now() - readinessStarted < 10000) {
        readinessPolls++;
        const catalog = await bounded(client.mcp.list({ location }, { signal: AbortSignal.timeout(2000) }), 'fixture MCP readiness', 2500);
        connected = ['fixture_direct', 'fixture_code'].every(name => catalog.data.some(item => item.name === name && item.status.status === 'connected'));
        if (connected) break;
        await bounded(Promise.race([new Promise<void>(resolve => setTimeout(resolve, 50)), daemonWatch.stopped]), 'MCP readiness poll', 3000);
      }
      const witnessBefore = await readFile(join(root, 'mcp-witness.jsonl'), 'utf8');
      const readyRecords: unknown[] = witnessBefore.trim().split('\n').filter(Boolean).slice(0, 100).map(line => JSON.parse(line));
      const listCount = readyRecords.filter(item => typeof item === 'object' && item !== null && 'event' in item && item.event === 'tools-list').length;
      recordReceipt({ mcpReadyConnected: connected ? 1 : 0, mcpReadyPolls: readinessPolls, mcpReadyElapsedMs: Date.now() - readinessStarted, mcpReadyListCount: listCount });
      if (!connected) throw new Error('fixture MCP servers did not become connected');
      // Fixture experiment only: allow the native 100ms registry debounce to settle.
      await bounded(Promise.race([new Promise<void>(resolve => setTimeout(resolve, 250)), daemonWatch.stopped]), 'fixture MCP registry settling', 3000);
      recordReceipt({ mcpPrepromptElapsedMs: Date.now() - readinessStarted, mcpFixtureSettleMs: 250 });
      for (const scenario of [
        { phase: 'mcp-code', prompt: 'fixture-mcp-code-request', tool: 'execute', marker: 'code-fixture-ok', final: 'fixture-code-complete' },
        { phase: 'mcp-direct', prompt: 'fixture-mcp-direct-request', tool: 'fixture_direct_echo', marker: 'direct-fixture-ok', final: 'fixture-direct-complete' },
      ] as const) {
        phase = scenario.phase;
        const scenarioWatch = makeWatcher();
        await bounded(Promise.race([scenarioWatch.connected, daemonWatch.stopped, scenarioWatch.stopped]), 'MCP scenario subscriber');
        const promptID = `msg_fixture_mcp_${randomBytes(12).toString('hex')}`;
        const admitted = await client.session.prompt({ sessionID: session.id, id: promptID, text: scenario.prompt }, { signal: AbortSignal.timeout(10000) });
        expect(admitted.id).toBe(promptID);
        await bounded(Promise.race([scenarioWatch.started, daemonWatch.stopped, scenarioWatch.stopped]), 'MCP scenario started');
        const deadline = Date.now() + 25000;
        let result: SessionMessageInfo[] | undefined;
        while (Date.now() < deadline) {
          const [state, active, history] = await Promise.race([
            Promise.all([client.session.get({ sessionID: session.id }, { signal: AbortSignal.timeout(3000) }), client.session.active({ signal: AbortSignal.timeout(3000) }), allHistory(client)]),
            daemonWatch.stopped, scenarioWatch.stopped,
          ]);
          if (state.outcome === 'failed' || state.outcome === 'interrupted') throw new Error('native MCP execution did not succeed');
          const user = history.find(message => message.type === 'user' && message.id === admitted.id);
          const final = history.find(message => message.type === 'assistant' && message.finish === 'stop' && !message.error && textOf(message) === scenario.final);
          if (!active[session.id] && state.outcome === 'succeeded' && user && final) { result = history; break; }
          const userIndex = history.findIndex(message => message.type === 'user' && message.id === admitted.id);
          const completedAfterUser = userIndex >= 0 && history.slice(userIndex + 1).some(message => message.type === 'assistant' && message.time.completed !== undefined);
          if (!active[session.id] && state.outcome === 'succeeded' && completedAfterUser && !final) {
            recordProvider();
            throw new Error(`native ${scenario.phase} completed without expected fixture result`);
          }
          await bounded(Promise.race([new Promise<void>(resolve => setTimeout(resolve, 50)), daemonWatch.stopped, scenarioWatch.stopped]), 'MCP completion poll', 3000);
        }
        if (!result) throw new Error('native MCP completion conditions not reached');
        const tool = result.flatMap(message => message.type === 'assistant' ? message.content : []).find(part => part.type === 'tool' && part.name === scenario.tool && part.state.status === 'completed' && JSON.stringify(part.state.content).includes(scenario.marker));
        if (!tool || tool.type !== 'tool' || tool.state.status !== 'completed') throw new Error('missing completed MCP tool result');
        if (scenario.tool === 'execute') {
          const metadata: unknown = tool.state.metadata;
          if (!metadata || typeof metadata !== 'object' || !('toolCalls' in metadata) || !Array.isArray(metadata.toolCalls)) throw new Error('missing CodeMode inner tool metadata');
          expect('error' in metadata && metadata.error === true).toBe(false);
          expect(metadata.toolCalls.some((call: unknown) => typeof call === 'object' && call !== null && 'tool' in call && call.tool === 'fixture_code.echo' && 'status' in call && call.status === 'completed')).toBe(true);
        }
        const witness = await readFile(join(root, 'mcp-witness.jsonl'), 'utf8');
        const records: unknown[] = witness.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
        const starts = records.flatMap(item => typeof item === 'object' && item !== null && 'event' in item && item.event === 'start' && 'pid' in item && typeof item.pid === 'number' ? [item.pid] : []);
        expect(records.some(item => typeof item === 'object' && item !== null && 'event' in item && item.event === 'call' && 'marker' in item && item.marker === scenario.marker && 'pid' in item && typeof item.pid === 'number' && starts.includes(item.pid))).toBe(true);
        recordReceipt({ mcpOwnedPids: JSON.stringify(starts) });
        expect(await client.permission.list({ sessionID: session.id }, { signal: AbortSignal.timeout(3000) })).toEqual([]);
      }
      recordReceipt({ phase: 'mcp-completed', mcpDirect: 'verified', mcpCode: 'verified' });
      recordProvider();
      expect(badRequest).toBe(false);
      return;
    }
    if (profile === 'agent') {
      await bounded(Promise.race([Promise.all([daemonWatch.connected, browserWatch.connected]), daemonWatch.stopped, browserWatch.stopped]), 'agent subscriber connections');
      const awaitHistory = async (label: string, accepts: (history: SessionMessageInfo[]) => boolean) => {
        const deadline = Date.now() + 25000;
        while (Date.now() < deadline) {
          const [state, active, history] = await Promise.race([
            Promise.all([client.session.get({ sessionID: session.id }, { signal: AbortSignal.timeout(3000) }), client.session.active({ signal: AbortSignal.timeout(3000) }), allHistory(client)]),
            daemonWatch.stopped,
          ]);
          if (state.outcome === 'failed' || state.outcome === 'interrupted') throw new Error(`${label} did not succeed`);
          if (!active[session.id] && state.outcome === 'succeeded' && accepts(history)) return history;
          await bounded(Promise.race([new Promise<void>(resolve => setTimeout(resolve, 50)), daemonWatch.stopped]), `${label} poll`, 3000);
        }
        throw new Error(`${label} completion conditions not reached`);
      };
      phase = 'agent-root-read';
      const rootRead = await client.session.prompt({ sessionID: session.id, text: 'fixture-read-request' }, { signal: AbortSignal.timeout(10000) });
      await bounded(Promise.race([Promise.all([readRequested.promise, readResultSeen.promise]), daemonWatch.stopped]), 'agent root read', 25000);
      await awaitHistory('agent root read', history => history.some(message => message.type === 'user' && message.id === rootRead.id) && history.some(message => message.type === 'assistant' && textOf(message) === 'fixture-read-complete' && message.finish === 'stop'));
      expect(await client.permission.list({ sessionID: session.id }, { signal: AbortSignal.timeout(3000) })).toEqual([]);

      phase = 'agent-child';
      const parentAdmission = await client.session.prompt({ sessionID: session.id, text: 'fixture-parent-delegate' }, { signal: AbortSignal.timeout(10000) });
      const parentHistory = await awaitHistory('agent delegation', history => history.some(message => message.type === 'user' && message.id === parentAdmission.id) && history.some(message => message.type === 'assistant' && message.finish === 'stop' && textOf(message) === 'fixture-parent-complete'));
      const rootTool = parentHistory.flatMap(message => message.type === 'assistant' ? message.content : []).find(part => part.type === 'tool' && part.name === 'subagent' && part.state.status === 'completed');
      expect(rootTool?.type === 'tool' && rootTool.state.status === 'completed').toBe(true);
      const children = (await client.session.list({ parentID: session.id, directory: cwd }, { signal: AbortSignal.timeout(3000) })).data;
      expect(children).toHaveLength(1);
      const childSession = children[0];
      expect(childSession.parentID).toBe(session.id);
      expect(childSession.agent).toBe('fixture_child');
      expect(childSession.location.directory).toBe(cwd);
      expect(childSession.permissions).toContainEqual({ action: '*', resource: '*', effect: 'allow' });
      expect(JSON.stringify(rootTool?.type === 'tool' && rootTool.state.status === 'completed' ? rootTool.state.metadata : undefined)).toContain(childSession.id);
      const childHistory = await allHistory(client, childSession.id);
      expect(childHistory.some(message => message.type === 'assistant' && message.content.some(part => part.type === 'tool' && part.name === 'read' && part.state.status === 'completed' && JSON.stringify(part.state.content).includes('fixture-read-ok')))).toBe(true);
      expect(childHistory.some(message => message.type === 'assistant' && textOf(message) === 'fixture-child-complete')).toBe(true);
      expect(await client.permission.list({ sessionID: childSession.id }, { signal: AbortSignal.timeout(3000) })).toEqual([]);

      phase = 'agent-large';
      const largeAdmission = await client.session.prompt({ sessionID: session.id, text: 'fixture-large-request' }, { signal: AbortSignal.timeout(10000) });
      const beforeCompact = await awaitHistory('large canonical text', history => history.some(message => message.type === 'user' && message.id === largeAdmission.id) && history.some(message => message.type === 'assistant' && message.finish === 'stop' && textOf(message) === largeText));
      const heapBefore = process.memoryUsage().heapUsed;
      const decodeStarted = performance.now();
      const measured = await allHistory(client);
      const decodeMs = performance.now() - decodeStarted;
      const heapDelta = process.memoryUsage().heapUsed - heapBefore;
      const largeMessage = measured.find(message => message.type === 'assistant' && textOf(message) === largeText);
      expect(largeMessage?.type).toBe('assistant');
      if (!largeMessage || largeMessage.type !== 'assistant') throw new Error('missing fixture large assistant part');
      expect(Buffer.byteLength(textOf(largeMessage), 'utf8')).toBeGreaterThan(64 * 1024);
      expect(largeMessage.content.some(part => part.type === 'text' && Buffer.byteLength(part.text, 'utf8') > 64 * 1024)).toBe(true);
      recordReceipt({ largeBytes: Buffer.byteLength(largeText, 'utf8'), largeDecodeMs: Math.round(decodeMs), largeHeapDelta: heapDelta });

      phase = 'agent-compact';
      const compactionId = `msg_fixture_compaction_${randomBytes(12).toString('hex')}`;
      const compaction = await client.session.compact({ sessionID: session.id, id: compactionId }, { signal: AbortSignal.timeout(10000) });
      expect(compaction.id).toBe(compactionId);
      const afterCompact = await awaitHistory('manual compaction', history => history.some(message => message.type === 'compaction' && message.id === compaction.id && message.status === 'completed'));
      for (const previous of beforeCompact) {
        if (previous.type === 'user') expect(afterCompact.find(message => message.type === 'user' && message.id === previous.id)).toEqual(previous);
        if (previous.type === 'assistant') {
          const restored = afterCompact.find(message => message.type === 'assistant' && message.id === previous.id);
          expect(restored?.type === 'assistant' ? textOf(restored) : undefined).toBe(textOf(previous));
        }
      }
      const context = await client.session.context({ sessionID: session.id }, { signal: AbortSignal.timeout(3000) });
      expect(context.length).toBeLessThan(afterCompact.length);
      expect(await client.permission.list({ sessionID: session.id }, { signal: AbortSignal.timeout(3000) })).toEqual([]);
      recordReceipt({ phase: 'agent-completed', rootRead: 'verified', childRead: 'verified', compaction: 'verified', catalogLimitation: 'ordinary-parent-subagent-allow-required' });
      recordProvider();
      expect(badRequest).toBe(false);
      return;
    }
    await bounded(Promise.race([Promise.all([daemonWatch.connected, browserWatch.connected]), daemonWatch.stopped, browserWatch.stopped]), 'subscriber connections');
    const admitted = await bounded(client.session.prompt({ sessionID: session.id, text: 'fixture prompt' }, { signal: AbortSignal.timeout(10000) }), 'prompt admission');
    await bounded(Promise.race([Promise.all([daemonWatch.started, browserWatch.started, requestSeen.promise]), daemonWatch.stopped, browserWatch.stopped]), 'native execution started');
    expect((await client.session.active({ signal: AbortSignal.timeout(3000) }))[session.id]?.type).toBe('running');
    browserWatch.controller.abort(cleanupAbort);
    const browserResult = await bounded(browserWatch.outcome, 'browser subscriber cleanup', 5000);
    if (browserResult.kind === 'error' && !isOwnedAbort(browserResult.error, browserWatch.controller.signal)) throw browserResult.error;
    expect((await client.session.active({ signal: AbortSignal.timeout(3000) }))[session.id]?.type).toBe('running');
    release.resolve();
    let finalHistory: SessionMessageInfo[] | undefined;
    const deadline = Date.now() + 25000;
    while (Date.now() < deadline) {
      const [state, active, history] = await Promise.race([
        Promise.all([client.session.get({ sessionID: session.id }, { signal: AbortSignal.timeout(3000) }), client.session.active({ signal: AbortSignal.timeout(3000) }), allHistory(client)]),
        daemonWatch.stopped,
      ]);
      if (state.outcome === 'failed' || state.outcome === 'interrupted') throw new Error(`native execution ${state.outcome}`);
      const user = history.find(message => message.type === 'user' && message.id === admitted.id && message.text === 'fixture prompt');
      const assistant = history.find(message => message.type === 'assistant' && message.time.completed !== undefined && message.finish === 'stop' && !message.error && textOf(message) === 'fixture-ok');
      if (!active[session.id] && state.outcome === 'succeeded' && user && assistant) { finalHistory = history; break; }
      await bounded(Promise.race([new Promise<void>(resolve => setTimeout(resolve, 50)), daemonWatch.stopped]), 'completion poll', 3000);
    }
    if (!finalHistory) throw new Error('native completion conditions not reached');
    const reconnect = OpenCode.make({ baseUrl: url, headers: Service.headers({ url, auth: { type: 'basic', username: 'opencode', password } }) });
    const recovered = await allHistory(reconnect);
    const project = (messages: SessionMessageInfo[]) => messages.flatMap<{ type: 'user' | 'assistant'; id: string; text: string }>(message => message.type === 'user' ? [{ type: message.type, id: message.id, text: message.text }] : message.type === 'assistant' ? [{ type: message.type, id: message.id, text: textOf(message) }] : []);
    expect(project(recovered)).toEqual(project(finalHistory));
    expect((await reconnect.session.get({ sessionID: session.id }, { signal: AbortSignal.timeout(3000) })).outcome).toBe('succeeded');
    const smokeEnv: Record<string, string> = {
      HOME: paths.HOME, TMPDIR: paths.TMPDIR, PATH: '/usr/bin:/bin',
      OPENCODE_TEST_URL: url, OPENCODE_TEST_PASSWORD: password, OPENCODE_TEST_SESSION_ID: session.id,
      OPENCODE_TEST_MESSAGE_ID: admitted.id, OPENCODE_TEST_SERVER_PID: String(info.pid),
    };
    const smoke = spawn('/usr/bin/bun', ['--no-env-file', fileURLToPath(new URL('../tests/opencode/bun-client-smoke.ts', import.meta.url))], {
      cwd, detached: true, stdio: 'pipe', env: smokeEnv as NodeJS.ProcessEnv,
    });
    let smokeOutput = '';
    let smokeBytes = 0;
    const collectSmoke = (chunk: Buffer) => {
      smokeBytes += chunk.length;
      if (smokeBytes <= 4096) smokeOutput += chunk.toString();
    };
    smoke.stdout.on('data', collectSmoke);
    smoke.stderr.on('data', collectSmoke);
    try {
      if (smoke.pid === undefined) throw new Error('Bun smoke did not provide an owned PID');
      recordReceipt({ bunSmoke: 'running', bunSmokePid: smoke.pid, bunSmokeProcessGroup: smoke.pid });
      const [code, signal] = await bounded(once(smoke, 'close'), 'Bun smoke', 12000);
      if (code !== 0 || signal !== null || smokeBytes > 4096 || smokeOutput.trim() !== 'owned Bun client smoke verified') throw new Error('Bun client smoke failed');
      recordReceipt({ bunSmoke: 'verified' });
    } catch (error) {
      recordReceipt({ bunSmoke: 'failed' });
      throw error;
    } finally {
      try { await stopChild(smoke); recordReceipt({ bunSmokeCleanup: 'leader-exited-group-kill-sent' }); }
      catch (error) { recordReceipt({ bunSmokeCleanup: 'failed' }); throw error; }
    }
    phase = 'read-tool';
    const readWatch = makeWatcher();
    await bounded(Promise.race([readWatch.connected, daemonWatch.stopped, readWatch.stopped]), 'read subscriber connected');
    const readAdmission = await client.session.prompt({ sessionID: session.id, text: 'fixture-read-request' }, { signal: AbortSignal.timeout(10000) });
    await bounded(Promise.race([Promise.all([readWatch.started, readRequested.promise, readResultSeen.promise]), daemonWatch.stopped, readWatch.stopped]), 'builtin read result', 25000);
    let readHistory: SessionMessageInfo[] | undefined;
    const readDeadline = Date.now() + 25000;
    while (Date.now() < readDeadline) {
      const [state, active, history] = await Promise.race([
        Promise.all([client.session.get({ sessionID: session.id }, { signal: AbortSignal.timeout(3000) }), client.session.active({ signal: AbortSignal.timeout(3000) }), allHistory(client)]),
        daemonWatch.stopped, readWatch.stopped,
      ]);
      if (state.outcome === 'failed' || state.outcome === 'interrupted') throw new Error('native read execution did not succeed');
      const user = history.find(message => message.type === 'user' && message.id === readAdmission.id);
      const completed = history.find(message => message.type === 'assistant' && message.time.completed !== undefined && message.finish === 'stop' && !message.error && textOf(message) === 'fixture-read-complete');
      const tool = history.some(message => message.type === 'assistant' && message.content.some(part => part.type === 'tool' && part.name === 'read' && part.state.status === 'completed' && part.time.completed !== undefined && JSON.stringify(part.state.content).includes('fixture-read-ok')));
      if (!active[session.id] && state.outcome === 'succeeded' && user && completed && tool) { readHistory = history; break; }
      await bounded(Promise.race([new Promise<void>(resolve => setTimeout(resolve, 50)), daemonWatch.stopped, readWatch.stopped]), 'read completion poll', 3000);
    }
    if (!readHistory) throw new Error('native read completion conditions not reached');
    expect(readAdvertised).toBe(true);
    expect(await client.permission.list({ sessionID: session.id }, { signal: AbortSignal.timeout(3000) })).toEqual([]);
    phase = 'interrupt';
    const stopWatch = makeWatcher();
    await bounded(Promise.race([stopWatch.connected, daemonWatch.stopped, stopWatch.stopped]), 'stop subscriber connected');
    allowInterruption = true;
    const stopAdmission = await client.session.prompt({ sessionID: session.id, text: 'fixture-stop-request' }, { signal: AbortSignal.timeout(10000) });
    await bounded(Promise.race([Promise.all([stopWatch.started, stopPartial.promise]), daemonWatch.stopped, stopWatch.stopped]), 'stop partial and fresh start', 25000);
    expect((await client.session.active({ signal: AbortSignal.timeout(3000) }))[session.id]?.type).toBe('running');
    const interruption = await client.session.interrupt({ sessionID: session.id, resume: false }, { signal: AbortSignal.timeout(10000) });
    expect(interruption.interrupted).toBe(true);
    let stopHistory: SessionMessageInfo[] | undefined;
    const stopDeadline = Date.now() + 20000;
    while (Date.now() < stopDeadline) {
      const [state, active, history] = await Promise.race([
        Promise.all([client.session.get({ sessionID: session.id }, { signal: AbortSignal.timeout(3000) }), client.session.active({ signal: AbortSignal.timeout(3000) }), allHistory(client)]),
        daemonWatch.stopped, stopWatch.stopped,
      ]);
      if (state.outcome === 'failed') throw new Error('native interruption failed');
      const user = history.find(message => message.type === 'user' && message.id === stopAdmission.id);
      const partial = history.find(message => message.type === 'assistant' && textOf(message).includes('fixture-stop-partial'));
      if (!active[session.id] && state.outcome === 'interrupted' && user && partial) { stopHistory = history; break; }
      await bounded(Promise.race([new Promise<void>(resolve => setTimeout(resolve, 50)), daemonWatch.stopped, stopWatch.stopped]), 'interruption poll', 3000);
    }
    if (!stopHistory) throw new Error('native interruption conditions not reached');
    recordReceipt({ phase: 'completed', readAdvertised: readAdvertised ? 1 : 0, readCompleted: 1, stopInterrupted: 1, stopPartialRetained: 1 });
    expect(requests).toBeGreaterThan(0);
    recordProvider();
    expect(badRequest).toBe(false);
  } catch (error) {
    recordProvider();
    if (diagnostics) await diagnostics();
    else recordReceipt({ phase, diagnosticStatus: 'session-unavailable', eventCounts: JSON.stringify(eventCounts), providerRequests: requests, providerFinished: responsesFinished, providerClosed: responsesClosed });
    throw error;
  } finally {
    for (const watcher of watchers) watcher.controller.abort(cleanupAbort);
    release.resolve();
    stopRelease.resolve();
    for (const response of pending) response.destroy();
    try {
      const outcomes = await Promise.allSettled(watchers.map(async watcher => {
        const outcome = await bounded(watcher.outcome, 'subscriber cleanup', 5000);
        if (outcome.kind === 'error') {
          if (!isOwnedAbort(outcome.error, watcher.controller.signal)) throw outcome.error;
        }
      }));
      const failed = outcomes.find(result => result.status === 'rejected');
      if (failed?.status === 'rejected') throw failed.reason;
    } finally {
    try {
      let mcpPids: number[] = [];
      try { if (profile === 'mcp') {
        try {
          const witness = await readFile(join(root, 'mcp-witness.jsonl'), 'utf8');
          const records: unknown[] = witness.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
          mcpPids = records.flatMap(item => typeof item === 'object' && item !== null && 'event' in item && item.event === 'start' && 'pid' in item && typeof item.pid === 'number' && Number.isSafeInteger(item.pid) && item.pid > 1 ? [item.pid] : []);
          recordReceipt({ mcpOwnedPids: JSON.stringify(mcpPids) });
        } catch (error: unknown) {
          if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
        }
      } } finally { if (child) await stopChild(child); }
      for (const pid of new Set(mcpPids)) {
        try {
          const [cwd, command, environment] = await Promise.all([readlink(`/proc/${pid}/cwd`), readFile(`/proc/${pid}/cmdline`, 'utf8'), readFile(`/proc/${pid}/environ`, 'utf8')]);
          if (cwd !== root || !command.split('\0').includes(join(root, 'mcp.ts')) || !environment.split('\0').includes(`OPENCODE_TEST_HOME=${join(root, 'home')}`)) throw new Error('MCP fixture PID no longer matches owned process');
          process.kill(pid, 'SIGTERM');
          const deadline = Date.now() + 3000;
          while (Date.now() < deadline) {
            try { process.kill(pid, 0); } catch (error: unknown) { if (error instanceof Error && 'code' in error && error.code === 'ESRCH') break; throw error; }
            await new Promise(resolve => setTimeout(resolve, 25));
          }
          try { process.kill(pid, 0); throw new Error('owned MCP process did not exit'); }
          catch (error: unknown) { if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) throw error; }
        } catch (error: unknown) {
          if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
        }
      }
      recordReceipt({ status: child ? 'leader-exited-group-kill-sent' : receiptState.status, ...(child?.pid === undefined ? {} : { pid: child.pid, processGroup: child.pid }) });
    } catch (error) {
      recordReceipt({ status: 'cleanup-failed', ...(child?.pid === undefined ? {} : { pid: child.pid, processGroup: child.pid }) });
      throw error;
    } finally {
      try { if (stub.listening) { stub.closeAllConnections(); await bounded(new Promise<void>((resolve, reject) => stub.close(error => error ? reject(error) : resolve())), 'fixture shutdown'); } }
      finally { await rm(root, { recursive: true, force: true }); }
    }
    }
  }
}, 120000);
