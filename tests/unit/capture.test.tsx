import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CaptureView from '../../src/views/CaptureView';
import { usePresentation } from '../../src/shell/presentation';
import { TestPresentation } from './fixtures/presentation';
import { deferred, jsonResponse } from './fixtures/recall';

type BrowserFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
let api: ReturnType<typeof vi.fn<BrowserFetch>>;
const originalUserAgentData = Object.getOwnPropertyDescriptor(navigator, 'userAgentData');
const originalTouchPoints = Object.getOwnPropertyDescriptor(navigator, 'maxTouchPoints');
const originalPlatform = Object.getOwnPropertyDescriptor(navigator, 'platform');

function device(mobile: boolean) {
  Object.defineProperty(navigator, 'userAgentData', { configurable: true, value: { mobile, platform: mobile ? 'Android' : 'Linux' } });
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(mobile ? 'Mozilla/5.0 (Linux; Android 14; Mobile)' : 'Mozilla/5.0 (X11; Linux x86_64)');
  Object.defineProperty(navigator, 'platform', { configurable: true, value: mobile ? 'Linux armv8l' : 'Linux x86_64' });
  Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: mobile ? 5 : 0 });
}

beforeEach(() => {
  window.history.replaceState(null, '', '/capture');
  window.sessionStorage.removeItem('memory-loop.think.current');
  device(false);
  api = vi.fn<BrowserFetch>(async () => jsonResponse({ ok: true }));
  vi.stubGlobal('fetch', api);
});
afterEach(() => {
  if (originalUserAgentData) Object.defineProperty(navigator, 'userAgentData', originalUserAgentData);
  else Reflect.deleteProperty(navigator, 'userAgentData');
  if (originalTouchPoints) Object.defineProperty(navigator, 'maxTouchPoints', originalTouchPoints);
  else Reflect.deleteProperty(navigator, 'maxTouchPoints');
  if (originalPlatform) Object.defineProperty(navigator, 'platform', originalPlatform);
  else Reflect.deleteProperty(navigator, 'platform');
  window.sessionStorage.removeItem('memory-loop.think.current');
});

function mount() {
  return render(<TestPresentation><CaptureView /></TestPresentation>);
}
function editor() {
  return screen.getByRole('textbox', { name: 'Thought' });
}
function change(text: string) {
  fireEvent.change(editor(), { target: { value: text } });
}
function expectCaptureRequest(text: string) {
  expect(api).toHaveBeenCalledOnce();
  const [input, init] = api.mock.calls[0];
  const url = new URL(input instanceof Request ? input.url : String(input), window.location.origin);
  expect(url.origin).toBe(window.location.origin);
  expect(url.pathname + url.search).toBe('/api/capture');
  expect((init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()).toBe('POST');
  expect(typeof init?.body).toBe('string');
  if (typeof init?.body !== 'string') throw new Error('Expected JSON request body');
  expect(JSON.parse(init.body)).toEqual({ text });
}

describe('Capture editor and save flow', () => {
  it('starts empty with an accessible thought editor and guarded Capture action', async () => {
    const user = userEvent.setup();
    mount();
    expect(editor()).toHaveValue('');
    expect(editor()).not.toHaveFocus();
    const button = screen.getByRole('button', { name: 'Capture' });
    expect(button).toHaveAttribute('aria-disabled', 'true');
    await user.click(button);
    change(' \n ');
    await user.click(button);
    expect(api).not.toHaveBeenCalled();
  });

  it('submits desktop Enter to the same-origin API and clears only after confirmed success', async () => {
    const pending = deferred<Response>();
    api.mockImplementation(() => pending.promise);
    const user = userEvent.setup();
    mount();
    change('  a thought  ');
    editor().focus();
    await user.keyboard('{Enter}');
    expectCaptureRequest('  a thought  ');
    expect(editor()).toHaveValue('  a thought  ');
    expect(editor()).toHaveFocus();
    expect(editor()).toBeEnabled();
    await act(async () => { pending.resolve(jsonResponse({ ok: true })); });
    await waitFor(() => expect(editor()).toHaveValue(''));
    expect(editor()).toHaveFocus();
    expect(screen.getByText('Saved')).toBeInTheDocument();
  });

  it('inserts a newline with desktop Shift+Enter rather than submitting', async () => {
    const user = userEvent.setup();
    mount();
    await user.type(editor(), 'first{Shift>}{Enter}{/Shift}second');
    expect(editor()).toHaveValue('first\nsecond');
    expect(api).not.toHaveBeenCalled();
  });

  it('uses mobile device information rather than viewport width: Enter edits and the button captures', async () => {
    vi.restoreAllMocks();
    device(true);
    const user = userEvent.setup();
    mount();
    await user.type(editor(), 'first{Enter}second');
    expect(editor()).toHaveValue('first\nsecond');
    expect(api).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Capture' }));
    expectCaptureRequest('first\nsecond');
  });

  it('does not submit composing or repeated Enter keydowns', () => {
    mount();
    change('draft');
    fireEvent.compositionStart(editor());
    fireEvent.keyDown(editor(), { key: 'Enter', code: 'Enter', isComposing: true });
    fireEvent.compositionEnd(editor());
    fireEvent.keyDown(editor(), { key: 'Enter', code: 'Enter', repeat: true });
    expect(api).not.toHaveBeenCalled();
  });

  it('keeps editing available and suppresses another submission while saving', async () => {
    const pending = deferred<Response>();
    api.mockImplementation(() => pending.promise);
    const user = userEvent.setup();
    mount();
    change('original');
    editor().focus();
    await user.keyboard('{Enter}');
    expectCaptureRequest('original');
    change('original plus more');
    await user.keyboard('{Enter}');
    expect(api).toHaveBeenCalledOnce();
    await act(async () => { pending.resolve(jsonResponse({ ok: true })); });
    expect(editor()).toHaveValue('original plus more');
  });

  it('retains an edited-back draft even when its text matches the submitted snapshot', async () => {
    const pending = deferred<Response>();
    api.mockImplementation(() => pending.promise);
    const user = userEvent.setup();
    mount();
    change('same');
    await user.click(screen.getByRole('button', { name: 'Capture' }));
    change('same plus edit');
    change('same');
    await act(async () => { pending.resolve(jsonResponse({ ok: true })); });
    expect(editor()).toHaveValue('same');
    expect(api).toHaveBeenCalledOnce();
  });

  it.each([
    ['capture_unavailable', /couldn.t save/i],
    ['capture_uncertain', /save unconfirmed.*duplicate/i],
  ] as const)('preserves draft and focus on %s without automatically retrying', async (code, feedback) => {
    api.mockResolvedValue(jsonResponse({ error: { code, message: 'safe fixture message' } }, 503));
    const user = userEvent.setup();
    mount();
    change('keep this draft');
    const input = editor();
    input.focus();
    if (!(input instanceof HTMLTextAreaElement)) throw new Error('Thought must be a textarea');
    input.setSelectionRange(2, 6);
    await user.keyboard('{Enter}');
    expect(await screen.findByText(feedback)).toBeInTheDocument();
    expect(input).toHaveValue('keep this draft');
    expect(input).toHaveFocus();
    expect([input.selectionStart, input.selectionEnd]).toEqual([2, 6]);
    expect(api).toHaveBeenCalledOnce();
  });

  it.each(['network failure', 'malformed success'] as const)('treats %s as unconfirmed without clearing or retrying', async failure => {
    if (failure === 'network failure') api.mockRejectedValue(new Error('fixture transport failure'));
    else api.mockResolvedValue(jsonResponse({ ok: true, unexpected: true }));
    const user = userEvent.setup();
    mount();
    change('unsure draft');
    await user.click(screen.getByRole('button', { name: 'Capture' }));
    expect(await screen.findByText(/save unconfirmed.*duplicate/i)).toBeInTheDocument();
    expect(editor()).toHaveValue('unsure draft');
    expect(api).toHaveBeenCalledOnce();
  });
});

function TestRoute() {
  const { location, navigate } = usePresentation();
  return <><button onClick={() => navigate(location.pathname === '/capture' ? '/ground' : '/capture')}>Switch route</button>
    {location.pathname === '/capture' ? <CaptureView /> : <h1>Other route</h1>}</>;
}

it('keeps the pending draft and late save result across route navigation', async () => {
  const pending = deferred<Response>();
  api.mockImplementation(() => pending.promise);
  const user = userEvent.setup();
  render(<TestPresentation><TestRoute /></TestPresentation>);
  change('before navigation');
  await user.click(screen.getByRole('button', { name: 'Capture' }));
  change('newer draft');
  await user.click(screen.getByRole('button', { name: 'Switch route' }));
  expect(screen.getByRole('heading', { name: 'Other route' })).toBeInTheDocument();
  await act(async () => { pending.resolve(jsonResponse({ ok: true })); });
  await user.click(screen.getByRole('button', { name: 'Switch route' }));
  expect(editor()).toHaveValue('newer draft');
  expect(api).toHaveBeenCalledOnce();
});
