import { randomUUID } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { relative } from 'node:path';
import { OpenCode } from '@opencode/client';
import { Service } from '@opencode/client/service';
import { expect, it } from 'vitest';
import { launchThinkFixture } from '../tests/think-fixture';

const forbidden = new Set([3000, 3001, 9443, 4173, 4317, 48763]);
const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

it('runs the owned Node Next → Bun daemon → native fixture command lifecycle', async () => {
  const binary = process.env.OPENCODE_TEST_BINARY;
  if (!binary) throw new Error('OPENCODE_TEST_BINARY is required for the native fixture');
  const fixture = await launchThinkFixture({ binary });
  let pids: number[] = [];
  try {
    const rel = relative('/tmp/opencode', fixture.root);
    if (!rel || rel.startsWith('..') || rel.startsWith('/') || await realpath(fixture.root) !== fixture.root) throw new Error('invalid owned fixture root');
    const web = new URL(fixture.webUrl);
    if (web.protocol !== 'http:' || web.hostname !== '127.0.0.1' || forbidden.has(Number(web.port)) || !web.port || web.pathname !== '/') throw new Error('invalid fixture web listener');
    const receipt: unknown = JSON.parse(await readFile(`${fixture.root}/process-receipts.json`, 'utf8'));
    if (!Array.isArray(receipt) || !receipt.every((entry: unknown) => typeof entry === 'object' && entry !== null && 'pid' in entry && typeof entry.pid === 'number' && Number.isSafeInteger(entry.pid) && entry.pid > 1 && entry.pid !== process.pid)) throw new Error('invalid owned process receipt');
    pids = receipt.map(entry => entry.pid);
    const descriptor = `${fixture.root}/service-discovery.json`;
    const endpoint = await Service.discover({ file: descriptor, version: '2.2.2' });
    if (!endpoint) throw new Error('owned native registration unavailable');
    const client = OpenCode.make({ baseUrl: endpoint.url, headers: Service.headers(endpoint) });
    const nativeInfo = await client.server.info({ signal: AbortSignal.timeout(5000) });
    expect(nativeInfo.version).toBe('2.2.2');
    expect(pids).toContain(nativeInfo.pid);

    async function call(path: string, method = 'GET', body?: object, signal?: AbortSignal): Promise<Record<string, unknown>> {
      const payload = body === undefined ? undefined : JSON.stringify(body);
      const response = await new Promise<{ status: number | undefined; body: string }>((resolve, reject) => {
        const req = httpRequest({ hostname: web.hostname, port: Number(web.port), path, method, signal,
          headers: { host: web.host, ...(payload === undefined ? {} : { 'content-type': 'application/json' }) } }, res => {
          let text = '';
          res.setEncoding('utf8');
          res.on('data', chunk => { text += chunk; if (text.length > 128 * 1024) req.destroy(new Error('fixture response limit')); });
          res.on('end', () => resolve({ status: res.statusCode, body: text }));
          res.on('error', reject);
        });
        req.setTimeout(5000, () => req.destroy(new Error('fixture HTTP timeout')));
        req.on('error', reject);
        req.end(payload);
      });
      expect(response.status).toBe(method === 'POST' ? 202 : 200);
      const parsed: unknown = JSON.parse(response.body);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid fixture response');
      return Object.fromEntries(Object.entries(parsed));
    }
    async function poll(path: string, predicate: (value: Record<string, unknown>) => boolean, label: string) {
      const deadline = Date.now() + 30000;
      while (Date.now() < deadline) {
        const value = await call(path);
        if (predicate(value)) return value;
        if (value.state === 'failed' || value.state === 'monitor-unavailable' || value.creation === 'rejected' || value.creation === 'upstream-unconfirmed') throw new Error(`${label} failed`);
        await delay(50);
      }
      throw new Error(`${label} timed out`);
    }
    async function createChat() {
      const id = randomUUID();
      await call('/api/think/conversations', 'POST', { conversationId: id, clientCommandId: randomUUID() });
      const base = `/api/think/conversations/${id}`;
      await poll(base, value => value.creation === 'ready', 'fixture creation');
      return { id, base, nativeId: `ses_memoryloop_${id.replaceAll('-', '')}` };
    }
    async function waitHeld() {
      const deadline = Date.now() + 20000;
      while (fixture.control.info().held === 0) { if (Date.now() >= deadline) throw new Error('fixture provider hold timed out'); await delay(50); }
    }

    const chat = await createChat();
    const nativeSession = await client.session.get({ sessionID: chat.nativeId }, { signal: AbortSignal.timeout(5000) });
    expect(nativeSession.parentID).toBeUndefined();
    expect(nativeSession.location.directory).toBe(fixture.workspace);
    expect(nativeSession.permissions).toEqual([{ action: '*', resource: '*', effect: 'allow' }]);
    const firstId = randomUUID();
    const caller = new AbortController();
    const firstText = 'fixture-hold full-stack original';
    const first = await call(`${chat.base}/messages`, 'POST', { clientCommandId: firstId, text: firstText }, caller.signal);
    expect(first).toMatchObject({ kind: 'send', state: 'registered', clientCommandId: firstId });
    caller.abort();
    await waitHeld();
    const other = await createChat();
    expect(other.id).not.toBe(chat.id);
    expect((await client.session.active({ signal: AbortSignal.timeout(5000) }))[chat.nativeId]).toMatchObject({ type: 'running' });
    fixture.control.release();
    await poll(`${chat.base}/commands/${firstId}`, value => value.state === 'completed', 'first send');
    const history = await client.message.list({ sessionID: chat.nativeId, order: 'asc', limit: 50 }, { signal: AbortSignal.timeout(5000) });
    expect(history.data.some(message => message.type === 'user' && message.id === `msg_memoryloop_${firstId.replaceAll('-', '')}` && message.text === firstText)).toBe(true);

    const stopSendId = randomUUID();
    const stopSend = await call(`${chat.base}/messages`, 'POST', { clientCommandId: stopSendId, text: 'fixture-stop' });
    if (typeof stopSend.runId !== 'string') throw new Error('missing fixture run identity');
    await waitHeld();
    await poll(`${chat.base}/commands/${stopSendId}`, value => value.state === 'admitted', 'stop send admission');
    expect((await client.session.active({ signal: AbortSignal.timeout(5000) }))[chat.nativeId]).toMatchObject({ type: 'running' });
    const stopId = randomUUID();
    expect(await call(`${chat.base}/runs/${stopSend.runId}/stop`, 'POST', { clientCommandId: stopId })).toMatchObject({ kind: 'stop', state: 'registered' });
    await poll(`${chat.base}/commands/${stopId}`, value => value.state === 'requested', 'stop request');
    await poll(`${chat.base}/commands/${stopSendId}`, value => value.state === 'interrupted', 'interrupted send');
    expect((await client.session.get({ sessionID: chat.nativeId }, { signal: AbortSignal.timeout(5000) })).outcome).toBe('interrupted');

    const toolChat = await createChat();
    const toolId = randomUUID();
    await call(`${toolChat.base}/messages`, 'POST', { clientCommandId: toolId, text: 'fixture-read' });
    await poll(`${toolChat.base}/commands/${toolId}`, value => value.state === 'completed', 'fixture read send');
    const toolHistory = await client.message.list({ sessionID: toolChat.nativeId, order: 'asc', limit: 50 }, { signal: AbortSignal.timeout(5000) });
    expect(toolHistory.data.some(message => message.type === 'assistant' && message.content.some(part => part.type === 'tool' && part.name === 'read' && part.state.status === 'completed' && JSON.stringify(part.state.content).includes('fixture-read-ok')))).toBe(true);

    const form = await client.session.form.create({ sessionID: toolChat.nativeId, title: 'Fixture question', fields: [{ key: 'answer', type: 'string', title: 'Answer', required: true }] }, { signal: AbortSignal.timeout(5000) });
    const decisions = await call(`${toolChat.base}/decisions`);
    expect(decisions).toMatchObject({ decisions: [expect.objectContaining({ kind: 'form', decisionId: form.id })] });
    expect(await call(`${toolChat.base}/decisions/${encodeURIComponent(form.id)}`)).toMatchObject({ kind: 'form', decisionId: form.id });
    const replyId = randomUUID();
    await call(`${toolChat.base}/decisions/${encodeURIComponent(form.id)}/reply`, 'POST', { clientCommandId: replyId, answer: { answer: 'fixture answer' } });
    await poll(`${toolChat.base}/commands/${replyId}`, value => value.state === 'replied', 'form reply');
    expect((await client.session.form.get({ sessionID: toolChat.nativeId, formID: form.id }, { signal: AbortSignal.timeout(5000) })).state).toEqual({ status: 'answered', answer: { answer: 'fixture answer' } });
  } finally {
    await fixture.close();
    await expect(lstat(fixture.root)).rejects.toMatchObject({ code: 'ENOENT' });
    for (const pid of pids) {
      try { process.kill(-pid, 0); throw new Error('owned fixture process group remains'); }
      catch (error: unknown) { if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) throw error; }
    }
  }
}, 240000);
