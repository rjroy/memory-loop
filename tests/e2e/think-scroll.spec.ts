import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { expect, test } from './recall-fixture';

test.use({ video: 'on', trace: 'on' });

// This is a presentation-boundary fixture: real React and layout, not the
// network/session projection. Hiding Latest does not suppress React state.
async function openThinkShell(page: Page) {
  const conversationId = '11111111-1111-4111-8111-111111111111';
  const epoch = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const snapshot = { conversationId, epoch, revision: 1, creation: 'ready', sendEligibility: 'available', entries: [] };
  await page.addInitScript(value => {
    class FixtureWatch extends EventTarget {
      constructor() {
        super();
        (window as unknown as { fixtureRevision: (revision: number) => void }).fixtureRevision = revision => this.dispatchEvent(new MessageEvent('revision', { data: JSON.stringify({ ...value, entries: undefined, revision, sendEligibility: 'busy' }) }));
        queueMicrotask(() => this.dispatchEvent(new MessageEvent('snapshot', { data: JSON.stringify(value) })));
      }
      close() {}
    }
    Object.defineProperty(window, 'EventSource', { value: FixtureWatch });
  }, snapshot);
  const token = 'fixture_view_token_012345678901234567890123456789';
  const expiresAt = new Date(Date.now() + 120_000).toISOString();
  let selected: string | null = null;
  let revision = 0;
  await page.route('**/api/think/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const base = `/api/think/conversations/${conversationId}`;
    if (path === '/api/think/views' && request.method() === 'POST') await route.fulfill({ status: 201, json: { viewToken: token, selectionRevision: 0, conversationId: null, expiresAt } });
    else if (path === '/api/think/selection' && request.method() === 'GET') await route.fulfill({ json: { selectionRevision: revision, conversationId: selected, expiresAt } });
    else if (path === '/api/think/selection' && request.method() === 'POST') {
      const body = request.postDataJSON() as { conversationId: string | null };
      if (selected !== body.conversationId) { selected = body.conversationId; revision++; }
      await route.fulfill({ json: { selectionRevision: revision, conversationId: selected, expiresAt } });
    } else if (path === base && request.method() === 'GET') await route.fulfill({ json: snapshot });
    else if (path === `${base}/decisions` && request.method() === 'GET') await route.fulfill({ json: { decisions: [] } });
    else await route.abort();
  });
  await page.goto(`/think?conversation=${conversationId}`);
  await expect(page.getByRole('button', { name: 'New chat' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Conversation' })).toBeVisible();
}

for (const viewport of [{ name: 'desktop', width: 1280, height: 800, zoom: 100 }, { name: 'mobile', width: 375, height: 700, zoom: 100 }, { name: 'narrow-enlarged', width: 320, height: 1200, zoom: 200 }]) {
  for (const suppressLatest of [false, true]) {
  test(`${viewport.name}: active preview replacement while untouched at bottom (Latest ${suppressLatest ? 'hidden' : 'normal'})`, async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    await page.setViewportSize(viewport);
    await openThinkShell(page);
    if (viewport.zoom !== 100) await page.addStyleTag({ content: `:root { font-size: ${viewport.zoom}% !important; }` });
    if (suppressLatest) await page.addStyleTag({ content: '.think-latest { display: none !important; }' });
    const conversationId = '11111111-1111-4111-8111-111111111111';
    const epoch = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const runId = '22222222-2222-4222-8222-222222222222';
    const originalId = '55555555-5555-4555-8555-555555555555';
    const previewId = '88888888-8888-4888-8888-888888888888';
    const generation = '66666666-6666-4666-8666-666666666666';
    const transfer = '77777777-7777-4777-8777-777777777777';
    const prompt = Buffer.from('Owned fixture prompt');
    let commandId = '';
    let revision = 2;
    let response = Array.from({ length: 25 }, (_, i) => `Initial fixture paragraph ${i}: ${'owned response words '.repeat(5)}`).join('\n\n');
    let preview = Buffer.from(response);
    let release: (() => void) | undefined;
    let intercepted: (() => void) | undefined;
    let gate: Promise<void> | undefined;
    await page.route(`**/api/think/conversations/${conversationId}`, async route => {
      if (!commandId) { await route.fallback(); return; }
      const original = { key: { conversationId, owner: { kind: 'original', clientCommandId: commandId, messageId: 'msg_fixture' } }, epoch, contentId: originalId, generation, through: prompt.length, kind: 'canonical', sha256: createHash('sha256').update(prompt).digest('hex') };
      const body = { key: { conversationId, owner: { kind: 'assistant-text', messageId: 'msg_answer', ordinal: 0 } }, epoch, contentId: previewId, generation, through: preview.length, kind: 'preview' };
      await route.fulfill({ json: { conversationId, epoch, revision, creation: 'ready', sendEligibility: 'busy', entries: [
        { kind: 'original', displayOrder: 1, clientCommandId: commandId, messageId: 'msg_fixture', body: original },
        { kind: 'assistant-text', displayOrder: 2, messageId: 'msg_answer', ordinal: 0, body, closure: 'open', capture: 'complete', runId },
      ] } });
    });
    await page.route(`**/api/think/conversations/${conversationId}/content/**`, async route => {
      const url = new URL(route.request().url());
      const contentId = url.pathname.split('/').at(-1);
      const data = contentId === originalId ? prompt : contentId === previewId ? preview : undefined;
      if (!data || url.searchParams.get('through') !== String(data.length) || url.searchParams.get('generation') !== generation || url.searchParams.get('offset') !== '0') { await route.abort(); return; }
      if (contentId === previewId && gate) { intercepted?.(); await gate; }
      await route.fulfill({ json: { conversationId, epoch, contentId, generation, through: data.length, offset: 0, bytes: data.toString('base64'), nextOffset: data.length, transfer } });
    });
    await page.route(`**/api/think/conversations/${conversationId}/messages`, async route => {
      commandId = (route.request().postDataJSON() as { clientCommandId: string }).clientCommandId;
      await route.fulfill({ status: 202, json: { conversationId, epoch, clientCommandId: commandId, kind: 'send', runId, state: 'admitted' } });
    });
    await page.route(`**/api/think/conversations/${conversationId}/commands/*`, async route => {
      await route.fulfill({ json: { conversationId, epoch, clientCommandId: commandId, kind: 'send', runId, state: 'admitted' } });
    });
    await page.getByRole('textbox', { name: 'Message' }).fill(prompt.toString());
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeEnabled();
    const reader = page.getByRole('region', { name: 'Conversation' });
    await expect.poll(() => reader.evaluate(element => getComputedStyle(element).overflowY)).toBe('auto');
    const answer = reader.locator('[data-think-anchor="part:msg_answer:0"]');
    await expect(answer).toContainText('Initial fixture paragraph 24');
    await expect(answer.locator('.think-stream-mark')).toHaveAttribute('aria-hidden', 'true');
    await reader.evaluate(element => { element.scrollTop = element.scrollHeight; });
    await expect.poll(() => reader.evaluate(element => element.scrollHeight - element.clientHeight - element.scrollTop)).toBeLessThanOrEqual(12);

    await page.evaluate(() => {
      const reader = document.querySelector<HTMLElement>('.think-conversation');
      const composer = document.querySelector<HTMLElement>('.think-compose-area');
      if (!reader || !composer) throw new Error('Missing Think layout');
      const ids = new WeakMap<Element, number>(); let nextId = 1;
      const id = (node: Element | null) => { if (!node) return null; if (!ids.has(node)) ids.set(node, nextId++); return ids.get(node) ?? null; };
      const frames: Array<Record<string, number | boolean | null>> = [];
      let recording = true;
      const sample = () => {
        if (!recording) return;
        const part = document.querySelector<HTMLElement>('[data-think-anchor="part:msg_answer:0"]');
        const status = part?.querySelector<HTMLElement>('.think-part-status') ?? null;
        const latest = document.querySelector<HTMLElement>('.think-latest');
        const r = reader.getBoundingClientRect(), c = composer.getBoundingClientRect(), p = part?.getBoundingClientRect(), s = status?.getBoundingClientRect();
        frames.push({ time: performance.now(), scroll: reader.scrollTop, documentScroll: window.scrollY, gap: reader.scrollHeight - reader.clientHeight - reader.scrollTop,
          readerTop: r.top, readerBottom: r.bottom, composerTop: c.top, composerBottom: c.bottom,
          partId: id(part), partTop: p?.top ?? null, partBottom: p?.bottom ?? null, statusId: id(status), statusTop: s?.top ?? null, statusBottom: s?.bottom ?? null,
          latest: !!latest, latestDisplayed: !!latest && getComputedStyle(latest).display !== 'none' });
        requestAnimationFrame(sample);
      };
      (window as unknown as { finishFixtureCapture: () => typeof frames }).finishFixtureCapture = () => { recording = false; return frames; };
      requestAnimationFrame(sample);
    });
    const frameBoundary = async (count: number) => page.evaluate(async n => {
      for (let i = 0; i < n; i++) await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    }, count);
    const updates: Array<{ revision: number; through: number; readyHeight: number; replacingHeight: number }> = [];
    try {
      for (let i = 1; i <= 60; i++) {
        const readyHeight = await answer.evaluate(element => element.getBoundingClientRect().height);
        const retainedText = await answer.locator('.markdown-document').textContent();
        response += `\n\nFixture streamed paragraph ${i}: ${'new owned response words '.repeat(5)}`;
        preview = Buffer.from(response);
        revision++;
        gate = new Promise<void>(resolve => { release = resolve; });
        const requestArrived = new Promise<void>(resolve => { intercepted = resolve; });
        await page.evaluate(value => (window as unknown as { fixtureRevision: (value: number) => void }).fixtureRevision(value), revision);
        await requestArrived;
        await expect(answer.getByText('Updating message…')).toBeVisible();
        await expect(answer).toContainText(i === 1 ? 'Initial fixture paragraph 24' : `Fixture streamed paragraph ${i - 1}:`);
        expect(await answer.locator('.markdown-document').textContent()).toBe(retainedText);
        await frameBoundary(2); // Observe the intentionally pending body before releasing it.
        const replacingHeight = await answer.evaluate(element => element.getBoundingClientRect().height);
        release?.(); gate = undefined; release = undefined; intercepted = undefined;
        await expect(answer).toContainText(`Fixture streamed paragraph ${i}:`);
        await expect(answer.getByText('Updating message…')).not.toBeVisible();
        await expect(answer.locator('.think-stream-mark')).toHaveAttribute('aria-hidden', 'true');
        updates.push({ revision, through: preview.length, readyHeight, replacingHeight });
        await frameBoundary(2); // Capture settled frames before the next owned update.
      }
    } finally { release?.(); }
    const frames = await page.evaluate(() => (window as unknown as { finishFixtureCapture: () => Array<Record<string, number | boolean | null>> }).finishFixtureCapture());
    await writeFile(testInfo.outputPath('active-preview-measurements.json'), JSON.stringify({ viewport, suppressLatest, updates, frames }, null, 2));
    await page.screenshot({ path: testInfo.outputPath('active-preview.png') });
    expect(updates).toHaveLength(60);
    expect(frames.some(frame => frame.statusId !== null)).toBe(true);
    expect(new Set(frames.map(frame => frame.partId)).size).toBe(1);
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeEnabled();
    // One sixty-fourth of a CSS pixel is Chromium's layout-unit precision, not a
    // tolerance for visible movement. Retained text has not changed yet.
    const tolerance = 1 / 64;
    const heightChanges = updates.map(item => item.replacingHeight - item.readyHeight);
    const maxHeightChange = Math.max(...heightChanges.map(Math.abs));
    const backward = frames.slice(1).flatMap((frame, index) => {
      const previous = frames[index].scroll, current = frame.scroll;
      return typeof previous === 'number' && typeof current === 'number' && current < previous - tolerance
        ? [{ frame: index + 1, delta: current - previous }] : [];
    });
    expect.soft(maxHeightChange, 'unchanged retained text must occupy the same part height while updating').toBeLessThanOrEqual(tolerance);
    expect.soft(backward.length, `untouched bottom follower moved backward: ${JSON.stringify(backward.slice(0, 5))}`).toBe(0);
  });
  }
}

// Exercise the real browser session and command receipt path while an admitted
// run remains active. Native reasoning is not projected as visible text, so
// this models a waiting run, not invented reasoning deltas or provider timing.
for (const viewport of [{ name: 'desktop', width: 1280, height: 800 }, { name: 'mobile', width: 375, height: 700 }]) {
  for (const mode of ['following', 'reading'] as const) {
    test(`${viewport.name}: sustained admitted run while ${mode}`, async ({ page }, testInfo) => {
      test.setTimeout(90_000);
      const results = [];
      for (const suppressLatest of [false, true]) {
        await page.setViewportSize(viewport);
        await openThinkShell(page);
        if (suppressLatest) await page.addStyleTag({ content: '.think-latest { display: none !important; }' });
        const conversationId = '11111111-1111-4111-8111-111111111111';
        const epoch = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
        const runId = '22222222-2222-4222-8222-222222222222';
        const contentId = '55555555-5555-4555-8555-555555555555';
        const generation = '66666666-6666-4666-8666-666666666666';
        const transfer = '77777777-7777-4777-8777-777777777777';
        const prompt = Array.from({ length: 36 }, (_, i) => `Owned prompt paragraph ${i}: ${'controlled fixture words '.repeat(8)}`).join('\n\n');
        const bytes = Buffer.from(prompt);
        let commandId = '';
        let receiptReads = 0;
        await page.route(`**/api/think/conversations/${conversationId}`, async route => {
          if (!commandId) { await route.fallback(); return; }
          const body = { key: { conversationId, owner: { kind: 'original', clientCommandId: commandId, messageId: 'msg_fixture' } }, epoch, contentId, generation, through: bytes.length, kind: 'canonical', sha256: createHash('sha256').update(bytes).digest('hex') };
          await route.fulfill({ json: { conversationId, epoch, revision: 2, creation: 'ready', sendEligibility: 'busy', entries: [{ kind: 'original', displayOrder: 1, clientCommandId: commandId, messageId: 'msg_fixture', body }] } });
        });
        await page.route(`**/api/think/conversations/${conversationId}/content/${contentId}**`, async route => {
          await route.fulfill({ json: { conversationId, epoch, contentId, generation, through: bytes.length, offset: 0, bytes: bytes.toString('base64'), nextOffset: bytes.length, transfer } });
        });
        await page.route(`**/api/think/conversations/${conversationId}/messages`, async route => {
          if (route.request().method() !== 'POST') { await route.abort(); return; }
          commandId = (route.request().postDataJSON() as { clientCommandId: string }).clientCommandId;
          await route.fulfill({ status: 202, json: { conversationId, epoch, clientCommandId: commandId, kind: 'send', runId, state: 'admitted' } });
        });
        await page.route(`**/api/think/conversations/${conversationId}/commands/*`, async route => {
          receiptReads++;
          await route.fulfill({ json: { conversationId, epoch, clientCommandId: commandId, kind: 'send', runId, state: 'admitted' } });
        });
        const editor = page.getByRole('textbox', { name: 'Message' });
        await editor.fill(prompt);
        await page.getByRole('button', { name: 'Send', exact: true }).click();
        await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeEnabled();
        const reader = page.getByRole('region', { name: 'Conversation' });
        await expect(reader.getByText('Owned prompt paragraph 35:', { exact: false })).toBeVisible();
        await expect(reader.locator('[data-think-anchor="message:msg_fixture"]')).toBeVisible();
        await reader.evaluate((element, reading) => {
          if (reading) element.dispatchEvent(new WheelEvent('wheel', { deltaY: -1, bubbles: true }));
          element.scrollTop = reading ? 100 : element.scrollHeight;
        }, mode === 'reading');
        const capture = await page.evaluate(async () => {
          const reader = document.querySelector<HTMLElement>('.think-conversation');
          const composer = document.querySelector<HTMLElement>('.think-compose-area');
          const message = document.querySelector<HTMLElement>('.think-message');
          const paragraph = message?.querySelector<HTMLElement>('.markdown-document p');
          if (!reader || !composer || !message || !paragraph) throw new Error('Missing real session fixture elements');
          const measure = (phase: string) => {
            const r = reader.getBoundingClientRect(), c = composer.getBoundingClientRect();
            const m = message.getBoundingClientRect(), p = paragraph.getBoundingClientRect();
            const latest = document.querySelector<HTMLElement>('.think-latest');
            const b = latest?.getBoundingClientRect();
            return { phase, time: performance.now(), scroll: reader.scrollTop, documentScroll: window.scrollY,
              gap: reader.scrollHeight - reader.clientHeight - reader.scrollTop,
              readerTop: r.top, readerBottom: r.bottom, composerTop: c.top, composerBottom: c.bottom,
              messageTop: m.top, messageBottom: m.bottom, paragraphTop: p.top, paragraphBottom: p.bottom,
              sameMessage: message.isConnected, sameParagraph: paragraph.isConnected,
              latest: !!latest, latestDisplayed: !!latest && getComputedStyle(latest).display !== 'none',
              latestBox: b ? { top: b.top, bottom: b.bottom, left: b.left, right: b.right } : null };
          };
          const observations: ReturnType<typeof measure>[] = [];
          const observer = new ResizeObserver(() => observations.push(measure('resize-observer')));
          observer.observe(reader); observer.observe(composer); observer.observe(message);
          const frames: ReturnType<typeof measure>[] = [];
          const start = performance.now();
          while (performance.now() - start < 10_500) {
            await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
            frames.push(measure('animation-frame'));
          }
          observer.disconnect();
          return { frames, observations };
        });
        expect(capture.frames.every(frame => frame.sameMessage && frame.sameParagraph)).toBe(true);
        expect(await page.getByRole('button', { name: 'Stop', exact: true }).isEnabled()).toBe(true);
        if (mode === 'reading') expect(capture.frames.some(frame => frame.latest)).toBe(true);
        if (suppressLatest) expect(capture.frames.every(frame => !frame.latestDisplayed)).toBe(true);
        const metrics = Object.fromEntries((['scroll', 'documentScroll', 'gap', 'readerTop', 'readerBottom', 'composerTop', 'composerBottom', 'messageTop', 'messageBottom', 'paragraphTop', 'paragraphBottom'] as const).map(key => {
          const movements = capture.frames.slice(1).flatMap((frame, i) => {
            const delta = frame[key] - capture.frames[i][key];
            return delta === 0 ? [] : [{ delta, time: frame.time }];
          });
          const reversals = movements.slice(1).filter((move, i) => move.delta * movements[i].delta < 0);
          return [key, { maxFrameDelta: Math.max(0, ...movements.map(move => Math.abs(move.delta))), reversalCount: reversals.length, movements }];
        }));
        results.push({ suppressLatest, receiptReads, metrics, ...capture });
        await page.screenshot({ path: testInfo.outputPath(suppressLatest ? 'waiting-hidden.png' : 'waiting-visible.png') });
        await page.unrouteAll({ behavior: 'wait' });
      }
      await writeFile(testInfo.outputPath('waiting-measurements.json'), JSON.stringify({ viewport, mode, results }, null, 2));
      expect(results.every(result => result.receiptReads > 0)).toBe(true);
    });
  }
}
for (const viewport of [{ name: 'desktop', width: 1280, height: 800 }, { name: 'mobile', width: 375, height: 700 }, { name: 'short', width: 800, height: 400 }]) {
  for (const mode of ['following', 'reading'] as const) {
    test(`${viewport.name}: ${mode} during controlled Think updates`, async ({ page }, testInfo) => {
      test.setTimeout(90_000);
      const bundle = testInfo.outputPath('harness.js');
      execFileSync('bun', ['build', './tests/e2e/think-scroll-harness.tsx', '--target', 'browser', '--outfile', bundle]);
      const css = await readFile('src/think/think.css', 'utf8');
      const results = [];
      for (const suppressLatest of [false, true]) {
        await page.setViewportSize(viewport);
        await openThinkShell(page);
        await page.addStyleTag({ content: css + (suppressLatest ? '\n.think-latest { display: none !important; }' : '') });
        await page.addScriptTag({ path: bundle });
        const reader = page.getByRole('region', { name: 'Conversation' });
        await expect(reader).toBeVisible();
        await expect(reader.getByText('Fixture paragraph 34:', { exact: false })).toBeVisible();
        await reader.evaluate(element => {
          if (getComputedStyle(element).overflowY === 'visible') window.scrollTo(0, document.documentElement.scrollHeight);
          else element.scrollTop = element.scrollHeight;
        });
        const frames = await page.evaluate(async reading => {
          const reader = document.querySelector<HTMLElement>('.think-conversation');
          const composer = document.querySelector<HTMLElement>('.think-compose-area');
          if (!reader || !composer) throw new Error('Missing Think geometry');
          const update = (window as unknown as { fixtureStep: (step: number) => void }).fixtureStep;
          const samples = [];
          let step = 0;
          let nextUpdate = 0;
          let start = 0;
          for (let frame = 0; frame < 1200; frame++) {
            await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
            const pageScroll = getComputedStyle(reader).overflowY === 'visible';
            if (reading && (frame === 4 || frame === 24)) {
              if (pageScroll) window.scrollTo(0, 100);
              else { reader.dispatchEvent(new WheelEvent('wheel', { deltaY: -1, bubbles: true })); reader.scrollTop = 100; }
            }
            if (reading && frame === 14) document.querySelector<HTMLButtonElement>('.think-latest')?.click();
            const now = performance.now();
            if (frame === 40) { start = now; nextUpdate = now; }
            let updated = false;
            if (frame >= 40 && now - start < 4000 && now >= nextUpdate) {
              step++;
              update(step);
              updated = true;
              // Average 62.5ms (~16Hz), with small, deterministic timing variation.
              nextUpdate += [50, 75, 62.5, 62.5][(step - 1) % 4];
            }
            const r = reader.getBoundingClientRect(); const c = composer.getBoundingClientRect();
            const status = document.querySelector('.think-activity summary');
            const partial = [...document.querySelectorAll('.think-part-status')].find(element => element.textContent?.trim() === 'Partial response · catching up');
            const latest = document.querySelector<HTMLElement>('.think-latest');
            const button = latest?.getBoundingClientRect();
            const anchor = document.querySelector<HTMLElement>('.think-message');
            const last = document.querySelector<HTMLElement>('.think-message .markdown-document p:last-child');
            const statusBox = status?.getBoundingClientRect();
            samples.push({ frame, time: performance.now(), step, updated, scroll: pageScroll ? window.scrollY : reader.scrollTop, documentScroll: window.scrollY, paneScroll: reader.scrollTop, gap: pageScroll ? r.bottom - innerHeight : reader.scrollHeight - reader.clientHeight - reader.scrollTop, readerTop: r.top, readerBottom: r.bottom, composerTop: c.top, composerBottom: c.bottom, anchorTop: anchor?.getBoundingClientRect().top ?? null, lastTop: last?.getBoundingClientRect().top ?? null, lastBottom: last?.getBoundingClientRect().bottom ?? null, statusTop: statusBox?.top ?? null, statusBottom: statusBox?.bottom ?? null, latest: !!latest, latestDisplayed: !!latest && getComputedStyle(latest).display !== 'none', latestBox: button ? { top: button.top, bottom: button.bottom, left: button.left, right: button.right } : null, status: status?.textContent ?? '', partial: partial?.textContent ?? '', pageScroll });
            if (frame >= 40 && now - start >= 5000) break;
          }
          return samples;
        }, mode === 'reading');
        const measured = frames.filter(frame => frame.frame >= 35);
        const metrics = Object.fromEntries((['scroll', 'documentScroll', 'paneScroll', 'gap', 'readerTop', 'readerBottom', 'composerTop', 'composerBottom', 'anchorTop', 'lastTop', 'lastBottom', 'statusTop', 'statusBottom'] as const).map(key => {
          const movements = measured.slice(1).flatMap((frame, i) => {
            const previous = measured[i][key], current = frame[key];
            return previous === null || current === null || current === previous ? [] : [{ delta: current - previous, time: frame.time, frame: frame.frame, updated: frame.updated }];
          });
          const reversals = movements.slice(1).filter((move, i) => move.delta * movements[i].delta < 0);
          const elapsed = reversals.length > 1 ? reversals[reversals.length - 1].time - reversals[0].time : 0;
          return [key, { maxFrameDelta: Math.max(0, ...movements.map(move => Math.abs(move.delta))), reversalCount: reversals.length, reversalHz: elapsed > 0 ? (reversals.length - 1) * 1000 / elapsed : null, reversalTimes: reversals.map(move => move.time), movements }];
        }));
        results.push({ suppressLatest, metrics, frames });
        await page.screenshot({ path: testInfo.outputPath(suppressLatest ? 'latest-hidden.png' : 'latest-visible.png') });
        await page.unrouteAll({ behavior: 'wait' });
      }
      await writeFile(testInfo.outputPath('measurements.json'), JSON.stringify({ viewport, mode, results }, null, 2));
      for (const result of results) {
        expect(result.frames.every(frame => frame.pageScroll === (viewport.name === 'short'))).toBe(true);
        expect(new Set(result.frames.map(frame => frame.status)).size).toBeGreaterThan(1);
        expect(new Set(result.frames.map(frame => frame.partial)).size).toBeGreaterThan(1);
        if (mode === 'reading') {
          const transitions = result.frames.slice(1).filter((frame, i) => frame.latest !== result.frames[i].latest);
          expect(transitions.map(frame => frame.latest)).toEqual(expect.arrayContaining([true, false]));
        }
        if (result.suppressLatest) expect(result.frames.every(frame => !frame.latestDisplayed)).toBe(true);
        const measured = result.frames.filter(frame => frame.frame >= 35);
        expect(result.frames.filter(frame => frame.updated).length).toBeGreaterThan(55);
        if (mode === 'reading') expect(Math.max(...measured.map(frame => Math.abs(frame.scroll - measured[0].scroll)))).toBeLessThan(5);
        else if (viewport.name !== 'short') {
          // ResizeObserver settles after the update frame, not before its sample.
          const settled = measured.filter(frame => !frame.updated);
          expect(Math.max(...settled.map(frame => frame.gap))).toBeLessThanOrEqual(12);
        }
      }
      const [normal, hidden] = results;
      // Compare at equal streamed state after a rendering opportunity, not equal
      // frame indices: the two real-time captures can start at different refresh phases.
      for (let step = 1; step <= 55; step++) {
        const a = normal.frames.find(frame => frame.step === step && !frame.updated);
        const b = hidden.frames.find(frame => frame.step === step && !frame.updated);
        expect(a, `normal settled step ${step}`).toBeDefined();
        expect(b, `hidden settled step ${step}`).toBeDefined();
        if (!a || !b) throw new Error('Missing settled comparison frame');
        expect(a.latest, `Latest state, step ${step}`).toBe(b.latest);
        for (const key of ['scroll', 'gap', 'readerTop', 'readerBottom', 'composerTop', 'composerBottom'] as const) {
          expect(Math.abs(a[key] - b[key]), `Latest comparison: ${key}, step ${step}`).toBeLessThanOrEqual(2);
        }
        for (const key of ['anchorTop', 'lastTop', 'lastBottom', 'statusTop', 'statusBottom'] as const) {
          const left = a[key], right = b[key];
          expect(left === null || right === null ? left === right : Math.abs(left - right) <= 2, `Latest comparison: ${key}, step ${step}`).toBe(true);
        }
      }
    });
  }
}
