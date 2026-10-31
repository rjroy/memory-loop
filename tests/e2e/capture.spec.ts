import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { devices } from '@playwright/test';
import { expect, test } from './recall-fixture';

test('desktop captures real multiline and appended entries, then reads the daily note through Recall', async ({ page, captureVault }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/capture');
  const editor = page.getByRole('textbox', { name: 'Thought' });
  await expect(editor).toBeEditable();
  const inbox = join(captureVault, '00_Inbox');
  await expect(readdir(inbox)).rejects.toMatchObject({ code: 'ENOENT' });

  await editor.click();
  await page.keyboard.type('First fixture line');
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.type('Second fixture line');
  await expect(editor).toHaveValue('First fixture line\nSecond fixture line');
  const firstResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/capture' && response.request().method() === 'POST');
  await page.keyboard.press('Enter');
  expect((await firstResponse).status()).toBe(200);
  await expect(editor).toHaveValue('');

  const names = await readdir(inbox);
  expect(names).toHaveLength(1);
  expect(names[0]).toMatch(/^\d{4}-\d{2}-\d{2}\.md$/);
  const file = join(inbox, names[0]);
  const first = await readFile(file);
  expect(first.toString('utf8')).toMatch(/^- \[(?:[01]\d|2[0-3]):[0-5]\d\] First fixture line\n  Second fixture line\n$/);

  await editor.fill('Second capture');
  await editor.press('Enter');
  await expect(editor).toHaveValue('');
  const appended = await readFile(file);
  expect(appended.subarray(0, first.length).equals(first)).toBe(true);
  expect(appended.subarray(first.length).toString('utf8')).toMatch(/^- \[(?:[01]\d|2[0-3]):[0-5]\d\] Second capture\n$/);
  expect(await readdir(inbox)).toEqual(names);

  await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Recall' }).click();
  const files = page.getByRole('navigation', { name: 'Vault files' });
  await files.getByRole('button', { name: '00_Inbox' }).click();
  await files.getByRole('link', { name: names[0] }).click();
  const article = page.getByRole('article');
  await expect(article).toContainText('First fixture line');
  await expect(article).toContainText('Second fixture line');
  await expect(article).toContainText('Second capture');
});

test('definite and uncertain failures preserve drafts and do not automatically retry', async ({ page }) => {
  let calls = 0;
  let code: 'capture_unavailable' | 'capture_uncertain' = 'capture_unavailable';
  await page.route('**/api/capture', async route => {
    calls++;
    await route.fulfill({ status: 503, json: { error: { code, message: 'fixture safe failure' } } });
  });
  await page.goto('/capture');
  const editor = page.getByRole('textbox', { name: 'Thought' });
  await editor.fill('Keep this fixture draft');
  await editor.press('Enter');
  await expect(page.getByText(/couldn.t save/i)).toBeVisible();
  await expect(editor).toHaveValue('Keep this fixture draft');
  await expect(editor).toBeFocused();
  expect(calls).toBe(1);
  await editor.fill('Keep this fixture draft with an edit');
  await expect(page.getByText(/couldn.t save/i)).toBeVisible();
  expect(calls).toBe(1);

  code = 'capture_uncertain';
  await editor.press('Enter');
  await expect(page.getByText('Save unconfirmed. Capturing again may duplicate it.')).toBeVisible();
  await expect(editor).toHaveValue('Keep this fixture draft with an edit');
  await expect(editor).toBeFocused();
  expect(calls).toBe(2);
  await editor.fill('Edited after unconfirmed save');
  await expect(page.getByText('Save unconfirmed. Capturing again may duplicate it.')).toBeVisible();
  expect(calls).toBe(2);
});

test.describe('mobile device input', () => {
  test.use({ userAgent: devices['Pixel 7'].userAgent, viewport: devices['Pixel 7'].viewport, isMobile: true, hasTouch: true });
  test('Enter inserts a newline and the button saves through the real API', async ({ page }) => {
    let calls = 0;
    page.on('request', request => { if (new URL(request.url()).pathname === '/api/capture') calls++; });
    await page.goto('/capture');
    const editor = page.getByRole('textbox', { name: 'Thought' });
    await editor.fill('Mobile first');
    await editor.press('Enter');
    await editor.pressSequentially('Mobile second');
    await expect(editor).toHaveValue('Mobile first\nMobile second');
    expect(calls).toBe(0);
    const captured = page.waitForResponse(response => new URL(response.url()).pathname === '/api/capture' && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Capture', exact: true }).click();
    expect((await captured).status()).toBe(200);
    await expect(editor).toHaveValue('');
    expect(calls).toBe(1);
  });
});
