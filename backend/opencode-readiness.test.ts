import { describe, expect, it } from 'vitest';
import { readinessFromOutput } from '../tests/opencode/readiness';

describe('OpenCode native readiness output', () => {
  it('accepts the exact unprefixed pinned-server readiness line', () => {
    expect(readinessFromOutput('server listening on http://127.0.0.1:18491\n')).toBe('http://127.0.0.1:18491');
  });
  it('accepts a readiness line reconstructed from separate output chunks', () => {
    let output = 'startup complete\nserver listening on http://127.0.';
    expect(readinessFromOutput(output)).toBeUndefined();
    output += '0.1:18491\n';
    expect(readinessFromOutput(output)).toBe('http://127.0.0.1:18491');
  });
  it.each([
    'server listening on http://localhost:18491\n',
    'server listening on http://0.0.0.0:18491\n',
    'server listening on https://127.0.0.1:18491\n',
    'server listening on http://127.0.0.1:0\n',
    'server listening on http://127.0.0.1:3000\n',
    'server listening at http://127.0.0.1:18491\n',
    'startup banner http://127.0.0.1:18491\n',
  ])('does not accept invalid readiness output %s', output => {
    expect(readinessFromOutput(output)).toBeUndefined();
  });
});
