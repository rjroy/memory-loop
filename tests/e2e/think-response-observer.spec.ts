import { expect, test } from './recall-fixture';
import { observeThinkResponses } from './think-response-observer';

test('response observation stays open while a controlled create response is gated', async ({ page, baseURL }) => {
  if (!baseURL) throw new Error('The test preview origin is not configured');
  const failures: string[] = [];
  const observer = observeThinkResponses(true, new URL(baseURL).origin, failures);
  page.on('response', response => observer.onResponse(response));
  let release: () => void = () => { throw new Error('Response gate is not initialized'); };
  let markIntercepted: () => void = () => { throw new Error('Interception gate is not initialized'); };
  const gate = new Promise<void>(resolve => { release = resolve; });
  const intercepted = new Promise<void>(resolve => { markIntercepted = resolve; });
  await page.route('**/api/think/conversations', async route => {
    if (route.request().method() !== 'POST') { await route.continue(); return; }
    markIntercepted();
    await gate;
    await route.fulfill({ status: 503, json: { error: { code: 'think_unavailable' } } });
  });
  let finished = false;
  let completion: Promise<void> | undefined;
  try {
    await page.goto('/think');
    await expect(page).toHaveURL(/\/think\?conversation=[0-9a-f-]{36}$/);
    await intercepted;
    completion = observer.waitForResponses().then(() => { finished = true; });
    await page.evaluate(() => undefined);
    expect(finished).toBe(false);
  } finally { release(); }
  await completion;
  expect(observer.expectedResponses).toBe(1);
  expect(failures).toEqual([]);
});

test('owned fixture returns unavailable for a real create through the web boundary', async ({ page }) => {
  await page.goto('/capture');
  const result = await page.evaluate(async () => {
    const response = await fetch('/api/think/conversations', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ conversationId: crypto.randomUUID(), clientCommandId: crypto.randomUUID() }),
    });
    return { status: response.status, body: await response.json() };
  });
  expect(result.status).toBe(503);
  expect(result.body).toMatchObject({ error: { code: 'think_unavailable' } });
});
