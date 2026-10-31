import { createHash, randomUUID } from 'node:crypto';
import { appendFile, lstat, mkdir, readFile, readdir, realpath, rename, writeFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { relative } from 'node:path';
import { OpenCode } from '@opencode/client';
import { Service } from '@opencode/client/service';
import { expect, it, vi } from 'vitest';
import { chromium, type Browser, type Page, type Route } from '@playwright/test';
import { fixtureLargeResponse, launchThinkFixture } from '../tests/think-fixture';

const forbidden = new Set([3000, 3001, 9443, 4173, 4317, 48763]);
const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

it('Phase 2 Ground quick action creates an editable unsent native Think draft', async () => {
  const binary = process.env.OPENCODE_TEST_BINARY;
  if (!binary) throw new Error('OPENCODE_TEST_BINARY is required for the native fixture');
  const fixture = await launchThinkFixture({ binary });
  let browser: Browser | undefined;
  try {
    const directory = `${fixture.workspace}/03_Resources/Memory-Loop`;
    await mkdir(directory, { recursive: true });
    await writeFile(`${directory}/quick-actions.md`, '## @fixture-skill\nA fictional fixture action.\n');
    await writeFile(`${directory}/prompts.md`, '## Question\nWhat is a fixture question?\n');
    const endpoint = await Service.discover({ file: `${fixture.root}/service-discovery.json`, version: '2.2.2' });
    if (!endpoint) throw new Error('owned native registration unavailable');
    const native = OpenCode.make({ baseUrl: endpoint.url, headers: Service.headers(endpoint) });
    browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage();
    const forbiddenPosts: string[] = [];
    page.on('request', request => {
      const url = new URL(request.url());
      if (request.method() === 'POST' && /^\/api\/think\/conversations\/[^/]+\/(messages|stop)$/.test(url.pathname)) forbiddenPosts.push(url.pathname);
    });
    const before = fixture.control.info();
    await page.goto(new URL('/ground', fixture.webUrl).href);
    await page.getByRole('button', { name: /A fictional fixture action.*@fixture-skill/ }).click();
    await page.waitForURL(/\/think\?conversation=[0-9a-f-]{36}$/);
    const id = new URL(page.url()).searchParams.get('conversation');
    if (!id) throw new Error('fixture conversation missing');
    const sid = `ses_memoryloop_${id.replaceAll('-', '')}`;
    const editor = page.getByRole('textbox', { name: 'Message' });
    await vi.waitFor(async () => expect(await editor.inputValue()).toBe('@fixture-skill'), { timeout: 30000 });
    await vi.waitFor(async () => expect(await page.getByRole('button', { name: 'Send', exact: true }).isEnabled()).toBe(true), { timeout: 30000 });
    await editor.fill('@fixture-skill edited before send');
    expect(await editor.inputValue()).toBe('@fixture-skill edited before send');
    expect(await page.getByRole('button', { name: 'Stop', exact: true }).count()).toBe(0);
    expect((await native.message.list({ sessionID: sid, order: 'asc', limit: 50 }, { signal: AbortSignal.timeout(5000) })).data).toEqual([]);
    expect((await native.session.active({ signal: AbortSignal.timeout(5000) }))[sid]?.type).not.toBe('running');
    expect(fixture.control.info()).toEqual(before);
    expect(forbiddenPosts).toEqual([]);
  } finally {
    try { await browser?.close(); } finally { await fixture.close(); }
    await expect(lstat(fixture.root)).rejects.toMatchObject({ code: 'ENOENT' });
  }
}, 240000);

it('Phase 5 real UI preserves newer draft across held acknowledgement and background transcript conflict', async () => {
  const binary = process.env.OPENCODE_TEST_BINARY;
  if (!binary) throw new Error('OPENCODE_TEST_BINARY is required for the native fixture');
  const fixture = await launchThinkFixture({ binary });
  let browser: Browser | undefined;
  let releaseAck: () => void = () => {};
  let handlerDone: Promise<void> | undefined;
  let original: Buffer | undefined;
  let transcriptPath: string | undefined;
  let originalInode: number | undefined;
  try {
    const endpoint = await Service.discover({ file: `${fixture.root}/service-discovery.json`, version: '2.2.2' });
    if (!endpoint) throw new Error('owned native registration unavailable');
    const native = OpenCode.make({ baseUrl: endpoint.url, headers: Service.headers(endpoint) });
    browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(new URL('/think', fixture.webUrl).href);
    await page.waitForURL(/\/think\?conversation=[0-9a-f-]{36}$/);
    const id = new URL(page.url()).searchParams.get('conversation');
    if (!id || !/^[0-9a-f-]{36}$/.test(id)) throw new Error('fixture conversation missing');
    const sid = `ses_memoryloop_${id.replaceAll('-', '')}`;
    const editor = page.getByRole('textbox', { name: 'Message' });
    const send = page.getByRole('button', { name: 'Send', exact: true });
    const conversation = page.getByRole('region', { name: 'Conversation' });
    const heldText = 'fixture-hold acknowledgement original';
    await editor.fill(heldText);
    await vi.waitFor(async () => expect(await send.isEnabled()).toBe(true), { timeout: 30000 });
    let acceptedStatus: number | undefined;
    const release = new Promise<void>(resolve => { releaseAck = resolve; });
    const path = `/api/think/conversations/${id}/messages`;
    const matches = (url: URL) => url.origin === new URL(fixture.webUrl).origin && url.pathname === path;
    const intercept = (route: Route) => {
      if (route.request().method() !== 'POST' || handlerDone) return route.continue();
      handlerDone = (async () => {
        const response = await route.fetch({ maxRetries: 0, timeout: 5000 });
        acceptedStatus = response.status();
        await release;
        await route.fulfill({ response });
        await response.dispose();
      })();
      return handlerDone;
    };
    await page.route(matches, intercept);
    try {
      await send.click();
      await vi.waitFor(() => expect(acceptedStatus).toBe(202), { timeout: 10000 });
      await editor.fill('newer unsent draft');
      await vi.waitFor(async () => expect(await conversation.getByRole('article', { name: /^You, message / }).filter({ hasText: heldText }).count()).toBe(1), { timeout: 30000 });
      releaseAck();
      if (handlerDone) await handlerDone;
    } finally {
      releaseAck();
      try { if (handlerDone) await handlerDone; } finally { await page.unroute(matches, intercept); }
    }
    await page.getByRole('button', { name: 'Stop', exact: true }).waitFor({ timeout: 30000 });
    expect(await editor.inputValue()).toBe('newer unsent draft');
    await vi.waitFor(() => expect(fixture.control.info().held).toBeGreaterThan(0), { timeout: 30000 });
    const fetchState = () => page.evaluate(async url => {
      const response = await fetch(url);
      if (!response.ok) throw new Error('fixture snapshot failed');
      return await response.json() as { transcript?: { state?: string } };
    }, `/api/think/conversations/${id}`);
    await vi.waitFor(async () => expect((await fetchState()).transcript?.state).toBe('up-to-date'), { timeout: 30000 });
    const ownedPath = `${fixture.workspace}/Conversations/Memory Loop/think-${id}.md`;
    transcriptPath = ownedPath;
    await vi.waitFor(async () => { original = await readFile(ownedPath); expect(original.toString('utf8')).toContain(heldText); }, { timeout: 30000 });
    if (!original) throw new Error('fixture transcript unavailable');
    originalInode = (await lstat(transcriptPath)).ino;
    await appendFile(transcriptPath, 'fixture external edit');
    const form = await native.session.form.create({ sessionID: sid, title: 'Fixture background question', fields: [{ key: 'answer', type: 'string', title: 'Answer', required: true }] }, { signal: AbortSignal.timeout(5000) });
    await page.getByRole('heading', { name: 'Fixture background question' }).waitFor({ timeout: 30000 });
    await page.getByRole('textbox', { name: 'Answer (required)' }).fill('fixture answer');
    await page.getByRole('button', { name: 'Send answer' }).click();
    await vi.waitFor(async () => expect((await native.session.form.get({ sessionID: sid, formID: form.id }, { signal: AbortSignal.timeout(5000) })).state.status).toBe('answered'), { timeout: 30000 });
    await page.getByText('Transcript needs attention: file changed.').waitFor({ timeout: 30000 });
    expect(await editor.inputValue()).toBe('newer unsent draft');
    expect(await page.getByRole('button', { name: 'Stop', exact: true }).isEnabled()).toBe(true);
    expect(await page.getByRole('button', { name: /retry logging/i }).count()).toBe(0);
    expect(await readFile(transcriptPath)).toEqual(Buffer.concat([original, Buffer.from('fixture external edit')]));
    await page.getByRole('button', { name: 'New chat', exact: true }).click();
    await page.getByRole('button', { name: 'Discard & start' }).click();
    await vi.waitFor(() => expect(new URL(page.url()).searchParams.get('conversation')).not.toBe(id), { timeout: 30000 });
    await page.getByText('Some transcripts need attention.').waitFor({ timeout: 30000 });
    expect((await native.session.active({ signal: AbortSignal.timeout(5000) }))[sid]).toMatchObject({ type: 'running' });
    const newId = new URL(page.url()).searchParams.get('conversation');
    if (!newId || !/^[0-9a-f-]{36}$/.test(newId)) throw new Error('fixture new conversation missing');
    await editor.fill('fixture new chat healthy');
    await vi.waitFor(async () => expect(await page.getByRole('button', { name: 'Send', exact: true }).isEnabled()).toBe(true), { timeout: 30000 });
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await vi.waitFor(async () => expect((await readFile(`${fixture.workspace}/Conversations/Memory Loop/think-${newId}.md`, 'utf8'))).toContain('fixture new chat healthy'), { timeout: 30000 });
    expect(await page.getByText('Some transcripts need attention.').count()).toBe(1);
    await editor.fill('new conversation draft');
    expect((await lstat(transcriptPath)).ino).toBe(originalInode);
    await writeFile(transcriptPath, original);
    await vi.waitFor(async () => expect(await page.getByText('Some transcripts need attention.').count()).toBe(0), { timeout: 30000 });
    expect(await editor.inputValue()).toBe('new conversation draft');
    const caughtUp = await readFile(transcriptPath, 'utf8');
    expect(caughtUp).toContain('fixture answer');
    expect(caughtUp).not.toContain('fixture external edit');
    const history = await native.message.list({ sessionID: sid, order: 'asc', limit: 50 }, { signal: AbortSignal.timeout(5000) });
    expect(history.data.filter(message => message.type === 'user' && message.text === heldText)).toHaveLength(1);
    fixture.control.release();
  } finally {
    releaseAck();
    if (handlerDone) await handlerDone.catch(() => {});
    if (transcriptPath && original && originalInode !== undefined) {
      const stat = await lstat(transcriptPath).catch(() => undefined);
      if (stat?.ino === originalInode) {
        const current = await readFile(transcriptPath);
        if (current.equals(Buffer.concat([original, Buffer.from('fixture external edit')]))) await writeFile(transcriptPath, original);
      }
    }
    try { await browser?.close(); } finally { await fixture.close(); }
    await expect(lstat(fixture.root)).rejects.toMatchObject({ code: 'ENOENT' });
  }
}, 240000);

it('Phase 5 actual Think UI owns creation, tool work, questions and reconnect across browser navigation', async () => {
  const binary = process.env.OPENCODE_TEST_BINARY;
  if (!binary) throw new Error('OPENCODE_TEST_BINARY is required for the native fixture');
  const fixture = await launchThinkFixture({ binary });
  let browser: Browser | undefined;
  try {
    const endpoint = await Service.discover({ file: `${fixture.root}/service-discovery.json`, version: '2.2.2' });
    if (!endpoint) throw new Error('owned native registration unavailable');
    const native = OpenCode.make({ baseUrl: endpoint.url, headers: Service.headers(endpoint) });
    browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    await page.goto(new URL('/think', fixture.webUrl).href);
    await page.waitForURL(/\/think\?conversation=[0-9a-f-]{36}$/);
    const id = new URL(page.url()).searchParams.get('conversation');
    if (!id || !/^[0-9a-f-]{36}$/.test(id)) throw new Error('fixture conversation missing');
    const sid = `ses_memoryloop_${id.replaceAll('-', '')}`;
    const editor = page.getByRole('textbox', { name: 'Message' });
    const sendButton = page.getByRole('button', { name: 'Send', exact: true });
    await editor.waitFor();
    await editor.fill('fixture-read actual UI original');
    await vi.waitFor(async () => expect(await sendButton.isEnabled()).toBe(true), { timeout: 30000 });
    const editorBox = await editor.boundingBox();
    const sendBox = await sendButton.boundingBox();
    if (!editorBox || !sendBox) throw new Error('fixture composer bounds missing');
    expect(sendBox.x).toBeGreaterThanOrEqual(editorBox.x + editorBox.width - 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await sendButton.click();
    const conversation = page.getByRole('region', { name: 'Conversation' });
    const userMessage = conversation.getByRole('article', { name: /^You, message / }).filter({ hasText: 'fixture-read actual UI original' });
    const aiResponses = conversation.getByRole('article', { name: /^AI, message / }).filter({ hasText: 'fixture-read-complete' });
    await vi.waitFor(async () => expect(await userMessage.count()).toBe(1), { timeout: 30000 });
    await vi.waitFor(async () => expect(await aiResponses.count()).toBe(1), { timeout: 30000 });
    await vi.waitFor(async () => expect((await native.message.list({ sessionID: sid, order: 'asc', limit: 50 }, { signal: AbortSignal.timeout(5000) })).data.some(message => message.type === 'assistant' && message.content.some(part => part.type === 'tool' && part.name === 'read' && part.state.status === 'completed'))).toBe(true), { timeout: 30000 });
    expect(await page.locator('body').innerText()).not.toContain('sentinel.env');
    const form = await native.session.form.create({ sessionID: sid, title: 'Fixture UI question', fields: [{ key: 'answer', type: 'string', title: 'Answer', required: true }] }, { signal: AbortSignal.timeout(5000) });
    await page.getByRole('heading', { name: 'Fixture UI question' }).waitFor({ timeout: 30000 });
    await page.getByRole('textbox', { name: 'Answer (required)' }).fill('fixture UI answer');
    await page.getByRole('button', { name: 'Send answer' }).click();
    await vi.waitFor(async () => expect((await native.session.form.get({ sessionID: sid, formID: form.id }, { signal: AbortSignal.timeout(5000) })).state).toEqual({ status: 'answered', answer: { answer: 'fixture UI answer' } }), { timeout: 30000 });
    await editor.fill('fixture-hold UI background');
    await vi.waitFor(async () => expect(await sendButton.isEnabled()).toBe(true), { timeout: 30000 });
    await sendButton.click();
    await page.getByRole('button', { name: 'Stop', exact: true }).waitFor({ timeout: 30000 });
    await vi.waitFor(() => expect(fixture.control.info().held).toBeGreaterThan(0), { timeout: 30000 });
    await editor.fill('unsent through navigation');
    await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Ground' }).click();
    await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Think' }).click();
    await vi.waitFor(async () => expect(await editor.inputValue()).toBe('unsent through navigation'), { timeout: 30000 });
    expect(new URL(page.url()).searchParams.get('conversation')).toBe(id);
    expect((await native.session.active({ signal: AbortSignal.timeout(5000) }))[sid]).toMatchObject({ type: 'running' });
    await context.setOffline(true);
    fixture.control.release();
    await vi.waitFor(async () => {
      expect((await native.session.active({ signal: AbortSignal.timeout(5000) }))[sid]?.type).not.toBe('running');
      expect((await native.session.get({ sessionID: sid }, { signal: AbortSignal.timeout(5000) })).outcome).toBe('succeeded');
    }, { timeout: 30000 });
    await context.setOffline(false);
    await vi.waitFor(async () => expect(await editor.inputValue()).toBe('unsent through navigation'), { timeout: 30000 });
    await vi.waitFor(async () => expect(await sendButton.isEnabled()).toBe(true), { timeout: 30000 });
    await vi.waitFor(async () => expect(await aiResponses.count()).toBeGreaterThanOrEqual(2), { timeout: 30000 });
    const history = await native.message.list({ sessionID: sid, order: 'asc', limit: 50 }, { signal: AbortSignal.timeout(5000) });
    expect(history.data.filter(message => message.type === 'user' && message.text === 'fixture-hold UI background')).toHaveLength(1);
    await page.reload();
    await vi.waitFor(async () => expect(await editor.inputValue()).toBe(''), { timeout: 30000 });
    expect(new URL(page.url()).searchParams.get('conversation')).toBe(id);
    expect((await native.message.list({ sessionID: sid, order: 'asc', limit: 50 }, { signal: AbortSignal.timeout(5000) })).data.filter(message => message.type === 'user' && message.text === 'fixture-hold UI background')).toHaveLength(1);
    await editor.fill('fixture-hold UI old chat');
    await vi.waitFor(async () => expect(await sendButton.isEnabled()).toBe(true), { timeout: 30000 });
    await sendButton.click();
    await page.getByRole('button', { name: 'Stop', exact: true }).waitFor({ timeout: 30000 });
    await vi.waitFor(() => expect(fixture.control.info().held).toBeGreaterThan(0), { timeout: 30000 });
    await editor.fill('draft to protect');
    await page.getByRole('button', { name: 'New chat', exact: true }).click();
    await page.getByRole('button', { name: 'Keep writing' }).click();
    expect(await editor.inputValue()).toBe('draft to protect');
    expect(await editor.evaluate(element => element === document.activeElement)).toBe(true);
    await page.getByRole('button', { name: 'New chat', exact: true }).click();
    await page.getByRole('button', { name: 'Discard & start' }).click();
    await vi.waitFor(() => expect(new URL(page.url()).searchParams.get('conversation')).not.toBe(id), { timeout: 30000 });
    expect((await native.session.active({ signal: AbortSignal.timeout(5000) }))[sid]).toMatchObject({ type: 'running' });
    fixture.control.release();
  } finally {
    try { await browser?.close(); } finally { await fixture.close(); }
    await expect(lstat(fixture.root)).rejects.toMatchObject({ code: 'ENOENT' });
  }
}, 240000);

it('PH3-R1 keeps a quiet watch alive across two default heartbeats on the canonical Bun listener', async () => {
  const binary = process.env.OPENCODE_TEST_BINARY;
  if (!binary) throw new Error('OPENCODE_TEST_BINARY is required for the native fixture');
  const fixture = await launchThinkFixture({ binary });
  const abort = new AbortController();
  const phase: { createAccepted: boolean; sendAccepted: boolean; watchStatus: number | null; snapshotSeen: boolean; heartbeatCount: number; lastFrameType: string | null; watchStarted: number | null; lastFrameAt: number | null } = {
    createAccepted: false, sendAccepted: false, watchStatus: null, snapshotSeen: false, heartbeatCount: 0, lastFrameType: null, watchStarted: null, lastFrameAt: null,
  };
  try {
    const origin = new URL(fixture.daemonUrl);
    if (origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1' || !origin.port || forbidden.has(Number(origin.port))) throw new Error('invalid fixture daemon listener');
    const request = (path: string, body?: object, signal: AbortSignal = AbortSignal.timeout(5000)) => new Promise<import('node:http').IncomingMessage>((resolve, reject) => {
      const payload = body === undefined ? undefined : JSON.stringify(body);
      const req = httpRequest(new URL(path, origin), {
        method: body === undefined ? 'GET' : 'POST',
        headers: { ...fixture.headers, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, signal,
      }, resolve);
      req.on('error', reject);
      req.end(payload);
    });
    const call = async (path: string, body?: object) => {
      const response = await request(path, body);
      let text = '';
      response.setEncoding('utf8');
      for await (const chunk of response) {
        text += chunk;
        if (text.length > 128 * 1024) throw new Error('fixture response limit');
      }
      expect(response.statusCode).toBe(body === undefined ? 200 : 202);
      return JSON.parse(text) as Record<string, unknown>;
    };
    const conversationId = randomUUID();
    const base = `/api/think/conversations/${conversationId}`;
    await call('/api/think/conversations', { conversationId, clientCommandId: randomUUID() });
    phase.createAccepted = true;
    const poll = async (path: string, predicate: (value: Record<string, unknown>) => boolean) => {
      const deadline = Date.now() + 30000;
      while (Date.now() < deadline) {
        const value = await call(path);
        if (predicate(value)) return value;
        if (value.creation === 'rejected' || value.state === 'failed') throw new Error('fixture operation failed');
        await delay(50);
      }
      throw new Error('fixture operation timed out');
    };
    await poll(base, value => value.creation === 'ready');
    const commandId = randomUUID();
    await call(`${base}/messages`, { clientCommandId: commandId, text: 'fixture-hold quiet watch' });
    phase.sendAccepted = true;
    await poll(`${base}/commands/${commandId}`, value => value.state === 'admitted');
    const deadline = Date.now() + 20000;
    while (fixture.control.info().held === 0) {
      if (Date.now() >= deadline) throw new Error('fixture provider hold timed out');
      await delay(50);
    }
    const requests = fixture.control.info().requests;
    phase.watchStarted = performance.now();
    const response = await request(`${base}/events`, undefined, AbortSignal.any([abort.signal, AbortSignal.timeout(50000)]));
    phase.watchStatus = response.statusCode ?? null;
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/event-stream');
    response.setEncoding('utf8');
    let buffer = '';
    let lastFrame = performance.now();
    let snapshot = false;
    let heartbeats = 0;
    try {
      for await (const chunk of response) {
        buffer += String(chunk).replaceAll('\r\n', '\n');
        if (buffer.length > 128 * 1024) throw new Error('fixture watch frame too large');
        let end: number;
        while ((end = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          const now = performance.now();
          const event = /^event: ?(.+)$/m.exec(frame)?.[1];
          phase.lastFrameAt = now;
          phase.lastFrameType = event === 'snapshot' || event === 'revision' || event === 'heartbeat' ? event : 'other';
          if (!snapshot) { expect(event).toBe('snapshot'); snapshot = true; phase.snapshotSeen = true; }
          else if (event === 'heartbeat') {
            expect(now - lastFrame).toBeGreaterThan(10000);
            heartbeats++;
            phase.heartbeatCount = heartbeats;
          }
          lastFrame = now;
        }
        if (heartbeats >= 2) break;
      }
      if (heartbeats < 2) throw new Error(`quiet watch closed after ${heartbeats} heartbeats`);
    } finally { abort.abort(); response.destroy(); }
    expect(fixture.control.info().requests).toBe(requests);
    expect(fixture.control.info().held).toBeGreaterThan(0);
    expect((await call(`${base}/commands/${commandId}`)).state).toBe('admitted');
    const endpoint = await Service.discover({ file: `${fixture.root}/service-discovery.json`, version: '2.2.2' });
    if (!endpoint) throw new Error('owned native registration unavailable');
    const native = OpenCode.make({ baseUrl: endpoint.url, headers: Service.headers(endpoint) });
    expect((await native.session.active({ signal: AbortSignal.timeout(5000) }))[`ses_memoryloop_${conversationId.replaceAll('-', '')}`]).toMatchObject({ type: 'running' });
  } catch (error: unknown) {
    const now = performance.now();
    const code = error instanceof Error && 'code' in error ? error.code : undefined;
    const errorCategory = code === 'ECONNRESET' || code === 'ABORT_ERR' || code === 'ERR_STREAM_PREMATURE_CLOSE' ? code : error instanceof Error && error.name === 'AssertionError' ? 'assertion' : 'other';
    console.error(JSON.stringify({ createAccepted: phase.createAccepted, sendAccepted: phase.sendAccepted, watchStatus: phase.watchStatus,
      snapshotSeen: phase.snapshotSeen, heartbeatCount: phase.heartbeatCount, lastFrameType: phase.lastFrameType,
      msSinceLastFrame: phase.lastFrameAt === null ? null : Math.round(now - phase.lastFrameAt),
      totalWatchMs: phase.watchStarted === null ? null : Math.round(now - phase.watchStarted), errorCategory }));
    throw error;
  } finally { await fixture.close(); await expect(lstat(fixture.root)).rejects.toMatchObject({ code: 'ENOENT' }); }
}, 240000);

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

    // The writer and Recall use the same owned fixture vault, not a synthetic export.
    const loggingReady = (value: Record<string, unknown>) => typeof value.transcript === 'object' && value.transcript !== null && 'state' in value.transcript && value.transcript.state === 'up-to-date';
    await poll(toolChat.base, loggingReady, 'initial transcript');
    const directory = `${fixture.workspace}/Conversations`;
    const moved = `${fixture.workspace}/Conversations-fixture-moved`;
    const noteId = ['Conversations', 'Memory Loop', `think-${toolChat.id}.md`];
    const initialPath = `${fixture.workspace}/${noteId.join('/')}`;
    let initial = '';
    await vi.waitFor(async () => { initial = await readFile(initialPath, 'utf8'); expect(initial).toContain('fixture answer'); }, { timeout: 30000 });
    expect(initial).toContain('fixture-read');
    expect(initial).toContain('fixture-read-complete');
    expect(initial).toContain('File read');
    expect(initial).toContain('fixture answer');
    expect(initial).not.toContain('sentinel.env');
    const tree = await call('/api/vault/tree');
    expect(JSON.stringify(tree)).toContain(noteId[2]);
    const noteQuery = new URLSearchParams({ id: JSON.stringify(noteId) });
    expect(await call(`/api/vault/note?${noteQuery}`)).toMatchObject({ markdown: initial });

    const faultChat = await createChat();
    const sentinel = `${fixture.workspace}/fixture-transcript-sentinel.txt`;
    await writeFile(sentinel, 'fixture sentinel', { flag: 'wx' });
    let movedDirectory = false;
    const faultStarted = performance.now();
    try {
      await rename(directory, moved);
      movedDirectory = true;
      const faultId = randomUUID();
      const faultCaller = new AbortController();
      expect(await call(`${faultChat.base}/messages`, 'POST', { clientCommandId: faultId, text: 'fixture-read fault-owned original Ω' }, faultCaller.signal)).toMatchObject({ state: 'registered' });
      faultCaller.abort();
      await poll(`${faultChat.base}/commands/${faultId}`, value => value.state === 'completed', 'faulted logging send');
      const faultHistory = await client.message.list({ sessionID: faultChat.nativeId, order: 'asc', limit: 50 }, { signal: AbortSignal.timeout(5000) });
      expect(faultHistory.data.flatMap(message => message.type === 'assistant' ? message.content.filter(part => part.type === 'tool' && part.name === 'read' && part.state.status === 'completed') : [])).toHaveLength(1);
      await poll(faultChat.base, value => typeof value.transcript === 'object' && value.transcript !== null && 'reason' in value.transcript && value.transcript.reason === 'conflict', 'logging conflict');
      expect(await readFile(`${moved}/Memory Loop/${noteId[2]}`, 'utf8')).toBe(initial);
      expect(await readFile(sentinel, 'utf8')).toBe('fixture sentinel');
      await rename(moved, directory);
      movedDirectory = false;
      await poll(faultChat.base, loggingReady, 'automatic transcript catch-up');
      const faultNoteId = ['Conversations', 'Memory Loop', `think-${faultChat.id}.md`];
      const note = await call(`/api/vault/note?${new URLSearchParams({ id: JSON.stringify(faultNoteId) })}`);
      if (typeof note.markdown !== 'string') throw new Error('fixture Recall transcript missing');
      expect(note.markdown.split('fixture-read fault-owned original Ω')).toHaveLength(2);
      expect(note.markdown.split('fixture-read-complete')).toHaveLength(2);
      expect(note.markdown).toContain('File read');
      expect(note.markdown).not.toContain('sentinel.env');
      const after = await client.message.list({ sessionID: faultChat.nativeId, order: 'asc', limit: 50 }, { signal: AbortSignal.timeout(5000) });
      expect(after.data.filter(message => message.type === 'user' && message.id === `msg_memoryloop_${faultId.replaceAll('-', '')}`)).toHaveLength(1);
      expect(after.data.flatMap(message => message.type === 'assistant' ? message.content.filter(part => part.type === 'tool' && part.name === 'read' && part.state.status === 'completed') : [])).toHaveLength(1);
      process.stdout.write(`${JSON.stringify({ event: 'phase4_fixture_transcript', transcriptBytes: Buffer.byteLength(note.markdown), entries: (note.markdown.match(/<!-- memory-loop-entry /g) ?? []).length, catchupMs: Math.round(performance.now() - faultStarted) })}\n`);
    } finally {
      if (movedDirectory) await rename(moved, directory);
    }
  } finally {
    await fixture.close();
    await expect(lstat(fixture.root)).rejects.toMatchObject({ code: 'ENOENT' });
    for (const pid of pids) {
      try { process.kill(-pid, 0); throw new Error('owned fixture process group remains'); }
      catch (error: unknown) { if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) throw error; }
    }
  }
}, 240000);

it('recovers large immutable content across two real browser watches without resending', async () => {
  const binary = process.env.OPENCODE_TEST_BINARY;
  if (!binary) throw new Error('OPENCODE_TEST_BINARY is required for the native fixture');
  const fixture = await launchThinkFixture({ binary });
  let browser: Browser | undefined;
  let ownedPids: number[] = [];
  const observerAbort = new AbortController();
  try {
    const rootRelative = relative('/tmp/opencode', fixture.root);
    if (!rootRelative || rootRelative.startsWith('..') || rootRelative.startsWith('/') || await realpath(fixture.root) !== fixture.root) throw new Error('invalid owned fixture root');
    const web = new URL(fixture.webUrl);
    if (web.protocol !== 'http:' || web.hostname !== '127.0.0.1' || !web.port || forbidden.has(Number(web.port)) || web.pathname !== '/') throw new Error('invalid fixture web listener');
    const receipts: unknown = JSON.parse(await readFile(`${fixture.root}/process-receipts.json`, 'utf8'));
    if (!Array.isArray(receipts) || !receipts.every((entry: unknown) => typeof entry === 'object' && entry !== null && 'pid' in entry && typeof entry.pid === 'number' && Number.isSafeInteger(entry.pid) && entry.pid > 1 && entry.pid !== process.pid)) throw new Error('invalid owned process receipt');
    ownedPids = receipts.map(entry => entry.pid);
    const pidFor = (operation: string) => {
      const entry: unknown = receipts.find((item: unknown) => typeof item === 'object' && item !== null && 'operation' in item && item.operation === operation);
      if (!entry || typeof entry !== 'object' || !('pid' in entry) || typeof entry.pid !== 'number' || !Number.isSafeInteger(entry.pid) || entry.pid <= 1 || entry.pid === process.pid) throw new Error('invalid owned process identity');
      return entry.pid;
    };
    const nativePid = pidFor('native');
    const daemonPid = pidFor('daemon');
    const endpoint = await Service.discover({ file: `${fixture.root}/service-discovery.json`, version: '2.2.2' });
    if (!endpoint) throw new Error('owned native registration unavailable');
    const native = OpenCode.make({ baseUrl: endpoint.url, headers: Service.headers(endpoint) });
    const info = await native.server.info({ signal: AbortSignal.timeout(5000) });
    expect(info.pid).toBe(nativePid);
    expect(info.version).toBe('2.2.2');
    browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    // The app root redirects to /ground; this transport-only probe must not race
    // shell navigation. Only this inert document is intercepted, never API/SSE.
    const probeUrl = new URL('/__think_phase3_probe__', fixture.webUrl).href;
    for (const context of [contextA, contextB]) {
      await context.route(probeUrl, async route => {
        const request = route.request();
        if (request.method() !== 'GET' || !request.isNavigationRequest() || request.url() !== probeUrl) { await route.continue(); return; }
        await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8',
          headers: { 'cache-control': 'no-store', 'content-security-policy': "default-src 'self'; connect-src 'self'" },
          body: '<!doctype html><html><head><title>Fixture transport probe</title></head><body></body></html>' });
      });
    }
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();
    await Promise.all([pageA.goto(probeUrl), pageB.goto(probeUrl)]);
    expect(pageA.url()).toBe(probeUrl);
    expect(pageB.url()).toBe(probeUrl);
    async function browserJson(page: Page, path: string, body?: object) {
      const result = await page.evaluate(async ({ path, body }) => {
        const response = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
        return { status: response.status, value: await response.json() as unknown };
      }, { path, body });
      expect(result.status).toBe(body === undefined ? 200 : 202);
      if (!result.value || typeof result.value !== 'object' || Array.isArray(result.value)) throw new Error('invalid browser fixture response');
      return Object.fromEntries(Object.entries(result.value));
    }
    async function poll(page: Page, path: string, predicate: (value: Record<string, unknown>) => boolean) {
      const deadline = Date.now() + 30000;
      while (Date.now() < deadline) {
        const value = await browserJson(page, path);
        if (predicate(value)) return value;
        if (value.state === 'failed' || value.state === 'monitor-unavailable' || value.creation === 'rejected') throw new Error('fixture browser operation failed');
        await delay(50);
      }
      throw new Error('fixture browser operation timed out');
    }
    async function watch(page: Page, path: string) {
      return page.evaluate(async path => {
        const source = new EventSource(path);
        const observations: Array<{ event: string; revision?: number; conversationId?: string; epoch?: string; bytes: number }> = [];
        Reflect.set(globalThis, '__fixtureWatch', { source, observations });
        const snapshot = await new Promise<unknown>((resolve, reject) => {
          const timer = setTimeout(() => { source.close(); reject(new Error('fixture snapshot timeout')); }, 15000);
          source.addEventListener('snapshot', event => {
            try {
              const data: unknown = JSON.parse((event as MessageEvent<string>).data);
              const revision = typeof data === 'object' && data !== null && 'revision' in data && typeof data.revision === 'number' ? data.revision : undefined;
              observations.push({ event: 'snapshot', revision, bytes: new TextEncoder().encode((event as MessageEvent<string>).data).length });
              clearTimeout(timer); resolve(data);
            } catch (error) { clearTimeout(timer); reject(error); }
          }, { once: true });
          source.addEventListener('revision', event => {
            const text = (event as MessageEvent<string>).data;
            const data: unknown = JSON.parse(text);
            observations.push({ event: 'revision', revision: typeof data === 'object' && data !== null && 'revision' in data && typeof data.revision === 'number' ? data.revision : undefined,
              conversationId: typeof data === 'object' && data !== null && 'conversationId' in data && typeof data.conversationId === 'string' ? data.conversationId : undefined,
              epoch: typeof data === 'object' && data !== null && 'epoch' in data && typeof data.epoch === 'string' ? data.epoch : undefined,
              bytes: new TextEncoder().encode(text).length });
          });
          source.addEventListener('error', () => { clearTimeout(timer); reject(new Error('fixture watch failed')); }, { once: true });
        });
        return snapshot;
      }, path);
    }
    async function closeWatch(page: Page) {
      await page.evaluate(() => {
        const value: unknown = Reflect.get(globalThis, '__fixtureWatch');
        if (typeof value !== 'object' || value === null || !('source' in value) || !(value.source instanceof EventSource)) throw new Error('fixture watch missing');
        value.source.close();
      });
    }
    function entries(value: unknown): Record<string, unknown>[] {
      if (!value || typeof value !== 'object' || !('entries' in value) || !Array.isArray(value.entries)) throw new Error('fixture manifest missing');
      return value.entries.map((entry: unknown) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('invalid fixture manifest entry');
        return Object.fromEntries(Object.entries(entry));
      });
    }
    function refOf(entry: Record<string, unknown>) {
      const value = entry.body;
      if (!value || typeof value !== 'object' || !('contentId' in value) || typeof value.contentId !== 'string' || !('generation' in value) || typeof value.generation !== 'string' || !('through' in value) || typeof value.through !== 'number') throw new Error('invalid fixture body reference');
      return { contentId: value.contentId, generation: value.generation, through: value.through };
    }
    const conversationId = randomUUID();
    const commandId = randomUUID();
    const base = `/api/think/conversations/${conversationId}`;
    await browserJson(pageA, '/api/think/conversations', { conversationId, clientCommandId: randomUUID() });
    await poll(pageA, base, value => value.creation === 'ready');
    const firstSnapshot = await watch(pageA, `${base}/events`);
    expect(firstSnapshot).toMatchObject({ conversationId, epoch: expect.any(String), revision: expect.any(Number) });
    const input = `fixture-hold fixture-large ${'漢🧠'.repeat(34000)}`;
    await browserJson(pageA, `${base}/messages`, { clientCommandId: commandId, text: input });
    const heldDeadline = Date.now() + 20000;
    while (fixture.control.info().held === 0) { if (Date.now() >= heldDeadline) throw new Error('fixture provider hold timed out'); await delay(50); }
    const before = await poll(pageA, base, value => Array.isArray(value.entries) && value.entries.some((entry: unknown) => typeof entry === 'object' && entry !== null && 'kind' in entry && entry.kind === 'original'));
    const originalBefore = entries(before).find(entry => entry.kind === 'original' && entry.clientCommandId === commandId);
    if (!originalBefore) throw new Error('fixture original manifest missing');
    const originalRef = refOf(originalBefore);
    expect(originalRef.through).toBeGreaterThan(128 * 1024);
    await pageA.waitForFunction(() => {
      const watch: unknown = Reflect.get(globalThis, '__fixtureWatch');
      return typeof watch === 'object' && watch !== null && 'observations' in watch && Array.isArray(watch.observations) && watch.observations.some((entry: unknown) => typeof entry === 'object' && entry !== null && 'event' in entry && entry.event === 'revision');
    }, undefined, { timeout: 15000 });
    const observed: unknown = await pageA.evaluate(() => {
      const watch: unknown = Reflect.get(globalThis, '__fixtureWatch');
      if (!watch || typeof watch !== 'object' || !('observations' in watch)) throw new Error('fixture watch observations missing');
      return watch.observations;
    });
    if (!Array.isArray(observed)) throw new Error('fixture observations invalid');
    let previousRevision = -1;
    let controlMaxFrameBytes = 0;
    for (const item of observed) {
      if (!item || typeof item !== 'object' || !('revision' in item) || typeof item.revision !== 'number' || !('bytes' in item) || typeof item.bytes !== 'number') throw new Error('invalid fixture watch observation');
      expect(item.bytes + 32).toBeLessThanOrEqual(64 * 1024);
      controlMaxFrameBytes = Math.max(controlMaxFrameBytes, item.bytes + 32);
      expect(item.revision).toBeGreaterThan(previousRevision);
      previousRevision = item.revision;
      if ('event' in item && item.event === 'revision') expect(item).toMatchObject({ conversationId, epoch: before.epoch });
    }
    await closeWatch(pageA);
    const nativeId = `ses_memoryloop_${conversationId.replaceAll('-', '')}`;
    expect((await native.session.active({ signal: AbortSignal.timeout(5000) }))[nativeId]).toMatchObject({ type: 'running' });

    const bodyDirectory = `${fixture.root}/daemon-app/.memory-loop`;
    const assistantHash = createHash('sha256').update(fixtureLargeResponse).digest('hex');
    async function hasAssistantFile() {
      for (const item of await readdir(bodyDirectory, { withFileTypes: true })) {
        if (!item.isDirectory() || !item.name.startsWith('think-bodies-')) continue;
        const dir = `${bodyDirectory}/${item.name}`;
        for (const file of await readdir(dir, { withFileTypes: true })) {
          if (!file.isFile()) continue;
          try {
            const data = await readFile(`${dir}/${file.name}`);
            if (data.length === Buffer.byteLength(fixtureLargeResponse) && createHash('sha256').update(data).digest('hex') === assistantHash) return true;
          } catch (error: unknown) {
            if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
          }
        }
      }
      return false;
    }
    const eviction = (async () => {
      const deadline = Date.now() + 30000;
      let resident = false;
      while (Date.now() < deadline && !observerAbort.signal.aborted) {
        const exists = await hasAssistantFile();
        if (exists) resident = true;
        else if (resident) return true;
        await delay(25);
      }
      throw new Error('fixture canonical eviction not observed');
    })();
    void eviction.catch(() => {});
    fixture.control.release();
    await poll(pageB, `${base}/commands/${commandId}`, value => value.state === 'completed');
    const freshSnapshot = await watch(pageB, `${base}/events`);
    controlMaxFrameBytes = Math.max(controlMaxFrameBytes, Buffer.byteLength(JSON.stringify(freshSnapshot)) + 32);
    expect(freshSnapshot).toMatchObject({ conversationId, epoch: before.epoch, revision: expect.any(Number) });
    const watchOriginal = entries(freshSnapshot).find(entry => entry.kind === 'original' && entry.clientCommandId === commandId);
    if (!watchOriginal) throw new Error('reconnected watch lost original identity');
    expect(refOf(watchOriginal)).toEqual(originalRef);
    expect(entries(freshSnapshot)).toContainEqual(expect.objectContaining({ kind: 'lifecycle', clientCommandId: commandId, state: 'completed' }));
    await eviction;
    const current = await browserJson(pageB, base);
    const manifest = entries(current);
    const originalAfter = manifest.find(entry => entry.kind === 'original' && entry.clientCommandId === commandId);
    const assistant = manifest.find(entry => entry.kind === 'assistant-text' && entry.closure === 'closed');
    if (!originalAfter || !assistant) throw new Error('fixture content manifest missing');
    expect(refOf(originalAfter)).toEqual(originalRef);
    const assistantRef = refOf(assistant);
    expect(assistantRef.through).toBeGreaterThan(128 * 1024);
    const watchAssistant = entries(freshSnapshot).find(entry => entry.kind === 'assistant-text' && entry.messageId === assistant.messageId && entry.ordinal === assistant.ordinal);
    if (!watchAssistant) throw new Error('reconnected watch lost assistant identity');
    expect(refOf(watchAssistant)).toEqual(assistantRef);
    const rss = async (pid: number) => {
      const status = await readFile(`/proc/${pid}/status`, 'utf8');
      const value = /^VmRSS:\s+(\d+)\s+kB$/m.exec(status)?.[1];
      return value ? Number(value) * 1024 : 0;
    };
    const nativeRssBefore = await rss(nativePid);
    const daemonRssBefore = await rss(daemonPid);
    const decodeStarted = performance.now();
    const history = await native.message.list({ sessionID: nativeId, order: 'asc', limit: 50 }, { signal: AbortSignal.timeout(10000) });
    const nativeDecodeMs = performance.now() - decodeStarted;
    expect(history.data.filter(message => message.type === 'user' && message.id === `msg_memoryloop_${commandId.replaceAll('-', '')}`)).toHaveLength(1);
    expect(history.data.some(message => message.type === 'assistant' && message.content.some(part => part.type === 'text' && part.text === fixtureLargeResponse))).toBe(true);
    const assemble = async (ref: { contentId: string; generation: string; through: number }, reconnect: boolean) => {
      const matchesContent = (url: URL) => url.origin === web.origin && url.pathname === `${base}/content/${ref.contentId}`;
      let dropped: { offset: number; transfer: string; upstreamStatus: number } | undefined;
      let dropFinished: Promise<void> | undefined;
      const dropOnce = (route: Route) => {
        const url = new URL(route.request().url());
        const transfer = url.searchParams.get('transfer');
        const offset = Number(url.searchParams.get('offset'));
        if (route.request().method() !== 'GET' || dropped || !transfer || !Number.isSafeInteger(offset) || offset <= 0 ||
            url.searchParams.get('generation') !== ref.generation || url.searchParams.get('through') !== String(ref.through)) {
          return route.continue();
        }
        // Fetch the real Next response once, then discard it before Chromium sees it.
        dropFinished = (async () => {
          const upstream = await route.fetch({ maxRetries: 0, timeout: 5000 });
          dropped = { offset, transfer, upstreamStatus: upstream.status() };
          await upstream.dispose();
          await route.abort('failed');
        })();
        return dropFinished;
      };
      if (reconnect) await pageB.route(matchesContent, dropOnce);
      try {
        const result = await pageB.evaluate(async ({ base, ref, reconnect }) => {
      const started = performance.now();
      const memory: unknown = Reflect.get(performance, 'memory');
      const heap = () => typeof memory === 'object' && memory !== null && 'usedJSHeapSize' in memory && typeof memory.usedJSHeapSize === 'number' ? memory.usedJSHeapSize : null;
      const heapBefore = heap();
      async function chunk(offset: number, transfer?: string, signal?: AbortSignal) {
        const query = new URLSearchParams({ generation: ref.generation, through: String(ref.through), offset: String(offset), ...(transfer ? { transfer } : {}) });
        const response = await fetch(`${base}/content/${encodeURIComponent(ref.contentId)}?${query}`, { signal });
        if (!response.ok) throw new Error('fixture chunk failed');
        const value: unknown = await response.json();
        if (!value || typeof value !== 'object' || !('bytes' in value) || typeof value.bytes !== 'string' || !('transfer' in value) || typeof value.transfer !== 'string' || !('nextOffset' in value) || typeof value.nextOffset !== 'number') throw new Error('invalid fixture chunk');
        const decoded = Uint8Array.from(atob(value.bytes), char => char.charCodeAt(0));
        if (decoded.length > 65536 || value.nextOffset !== offset + decoded.length || value.nextOffset > ref.through || (offset < ref.through && decoded.length === 0)) throw new Error('invalid fixture chunk bounds');
        return { bytes: value.bytes, decoded, transfer: value.transfer, nextOffset: value.nextOffset };
      }
      const first = await chunk(0);
      const repeat = await chunk(0, first.transfer);
      if (repeat.bytes !== first.bytes || repeat.nextOffset !== first.nextOffset || repeat.transfer !== first.transfer) throw new Error('fixture retry changed bytes');
      let failedOnce = false;
      if (reconnect) {
        try { await chunk(first.nextOffset, first.transfer); }
        catch (error: unknown) { if (!(error instanceof TypeError)) throw error; failedOnce = true; }
        if (!failedOnce) throw new Error('fixture expected dropped chunk response');
      }
      let reconnectSnapshotBytes = 0;
      if (reconnect) {
        const current: unknown = Reflect.get(globalThis, '__fixtureWatch');
        if (!current || typeof current !== 'object' || !('source' in current) || !(current.source instanceof EventSource)) throw new Error('fixture watch missing');
        current.source.close();
        const next = new EventSource(`${base}/events`);
        const snapshot = await new Promise<unknown>((resolve, reject) => {
          const timer = setTimeout(() => { next.close(); reject(new Error('fixture reconnect timeout')); }, 15000);
          next.addEventListener('snapshot', event => {
            const raw = (event as MessageEvent<string>).data;
            reconnectSnapshotBytes = new TextEncoder().encode(raw).length + 32;
            clearTimeout(timer); resolve(JSON.parse(raw) as unknown);
          }, { once: true });
          next.addEventListener('error', () => { clearTimeout(timer); reject(new Error('fixture reconnect failed')); }, { once: true });
        });
        if (!snapshot || typeof snapshot !== 'object' || !('entries' in snapshot) || !Array.isArray(snapshot.entries) || !snapshot.entries.some((entry: unknown) => typeof entry === 'object' && entry !== null && 'body' in entry && typeof entry.body === 'object' && entry.body !== null && 'contentId' in entry.body && entry.body.contentId === ref.contentId && 'generation' in entry.body && entry.body.generation === ref.generation)) throw new Error('fixture reconnect changed content');
        Reflect.set(globalThis, '__fixtureWatch', { source: next, observations: [] });
      }
      const decoder = new TextDecoder('utf-8', { fatal: true });
      let text = decoder.decode(first.decoded, { stream: true });
      let offset = first.nextOffset;
      let count = 1;
      while (offset < ref.through) {
        const part = await chunk(offset, first.transfer);
        if (part.transfer !== first.transfer) throw new Error('fixture transfer identity changed');
        text += decoder.decode(part.decoded, { stream: true });
        offset = part.nextOffset;
        count++;
      }
      const heapAfter = heap();
      return { text: text + decoder.decode(), count, failedOnce, failedOffset: first.nextOffset, failedTransfer: first.transfer, reconnectSnapshotBytes, elapsedMs: performance.now() - started,
         heapDelta: heapBefore === null || heapAfter === null ? null : heapAfter - heapBefore };
        }, { base, ref, reconnect });
        if (reconnect) {
          expect(dropped?.upstreamStatus).toBe(200);
          expect(dropped?.offset === result.failedOffset && dropped.transfer === result.failedTransfer).toBe(true);
        }
        return result;
      } finally {
        if (reconnect) {
          try { await dropFinished; } finally { await pageB.unroute(matchesContent, dropOnce); }
        }
      }
    };
    const userAssembly = await assemble(originalRef, false);
    expect(userAssembly.text).toBe(input);
    expect(userAssembly.count).toBeGreaterThan(1);
    const assistantAssembly = await assemble(assistantRef, true);
    expect(assistantAssembly.text).toBe(fixtureLargeResponse);
    expect(assistantAssembly.count).toBeGreaterThan(1);
    expect(assistantAssembly.failedOnce).toBe(true);
    controlMaxFrameBytes = Math.max(controlMaxFrameBytes, assistantAssembly.reconnectSnapshotBytes);
    expect(controlMaxFrameBytes).toBeLessThanOrEqual(64 * 1024);
    const daemonRssAfter = await rss(daemonPid);
    const nativeRssAfter = await rss(nativePid);
    process.stdout.write(`${JSON.stringify({ event: 'phase3_fixture_metrics', userBytes: originalRef.through, assistantBytes: assistantRef.through,
      controlMaxFrameBytes, nativeClientDecodeMs: nativeDecodeMs, nativeRssBeforeBytes: nativeRssBefore, nativeRssAfterBytes: nativeRssAfter,
      daemonRssBeforeBytes: daemonRssBefore, daemonRssAfterBytes: daemonRssAfter, browserUserAssemblyMs: userAssembly.elapsedMs,
      browserAssistantAssemblyMs: assistantAssembly.elapsedMs, browserUserHeapDeltaBytes: userAssembly.heapDelta,
      browserAssistantHeapDeltaBytes: assistantAssembly.heapDelta })}\n`);
    await closeWatch(pageB);
    expect(fixture.control.info().requests).toBeGreaterThan(0);
  } finally {
    observerAbort.abort();
    try { await browser?.close(); } finally { await fixture.close(); }
    await expect(lstat(fixture.root)).rejects.toMatchObject({ code: 'ENOENT' });
    for (const pid of ownedPids) {
      try { process.kill(-pid, 0); throw new Error('owned fixture process group remains'); }
      catch (error: unknown) { if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) throw error; }
    }
  }
}, 240000);
