import { expect, it } from 'vitest';
import { webSignalAction } from './shutdown-policy';

it('waits for the inherited-console child on Windows Ctrl+C instead of forwarding a kill', () => {
  expect(webSignalAction('win32', 'SIGINT')).toBe('wait');
});

it.each(['SIGINT', 'SIGTERM'] as const)('forwards %s on Linux so the child can drain', signal => {
  expect(webSignalAction('linux', signal)).toBe('forward');
});
