import { describe, expect, it } from 'vitest';
import { createServerLogger, safeError } from '../src/server/logger';

type Level = 'error' | 'warning' | 'info' | 'verbose';
type Entry = { level: Level; event: string; details: Record<string, unknown> };

function fixture(level?: Level) {
  const entries: Entry[] = [];
  const logger = createServerLogger({
    env: level ? { MEMORY_LOOP_LOG_LEVEL: level } : {},
    sink: (level: Level, event: string, details: Record<string, unknown>) => entries.push({ level, event, details }),
  });
  return { logger, entries };
}

describe('shared server logging', () => {
  it.each([
    ['error', ['error']],
    ['warning', ['error', 'warning']],
    ['info', ['error', 'warning', 'info']],
    ['verbose', ['error', 'warning', 'info', 'verbose']],
  ] as const)('filters at the %s threshold', (threshold, expected) => {
    const { logger, entries } = fixture(threshold);
    logger.error('fixture_error', {});
    logger.warning('fixture_warning', {});
    logger.info('fixture_info', {});
    logger.verbose('fixture_verbose', {});
    expect(entries.map(entry => entry.level)).toEqual(expected);
  });

  it('defaults to info and does not promote an invalid configuration to verbose', () => {
    for (const env of [{}, { MEMORY_LOOP_LOG_LEVEL: 'nonsense' }]) {
      const entries: Entry[] = [];
      const logger = createServerLogger({ env, sink: (level: Level, event: string, details: Record<string, unknown>) => entries.push({ level, event, details }) });
      logger.info('started', {});
      logger.verbose('refresh', {});
      expect(entries.map(entry => entry.event)).toEqual(['started']);
    }
  });

  it.each([
    ['think_native_attempt', { operation: 'status' }],
    ['think_native_outcome', { operation: 'status', outcome: 'success' }],
    ['think_state_write_attempt', { operation: 'activity' }],
    ['think_state_write_outcome', { operation: 'activity', status: 'committed' }],
    ['think_bff_attempt', { operation: 'snapshot', requestId: 'fixture-request' }],
    ['think_bff_outcome', { operation: 'snapshot', requestId: 'fixture-request', status: 200 }],
  ])('classifies routine %s as verbose', (event, details) => {
    const quiet = fixture('info');
    const verbose = fixture('verbose');
    quiet.logger.log(event, details);
    verbose.logger.log(event, details);
    expect(quiet.entries).toEqual([]);
    expect(verbose.entries).toEqual([{ level: 'verbose', event, details }]);
  });

  it('does not suppress a failed native call or a failed state write at the default level', () => {
    const { logger, entries } = fixture();
    logger.log('think_native_outcome', { operation: 'status', outcome: 'failed', code: 'ECONNREFUSED' });
    logger.log('think_state_write_outcome', { operation: 'activity', status: 'unavailable', commit: 'not-confirmed', code: 'SQLITE_BUSY' });
    expect(entries).toEqual([
      { level: 'error', event: 'think_native_outcome', details: { operation: 'status', outcome: 'failed', code: 'ECONNREFUSED' } },
      { level: 'error', event: 'think_state_write_outcome', details: { operation: 'activity', status: 'unavailable', commit: 'not-confirmed', code: 'SQLITE_BUSY' } },
    ]);
  });

  it('extracts only known infrastructure codes, including nested fetch causes', () => {
    expect(safeError(new Error('private request body', { cause: { code: 'ECONNRESET' } }), 'native_call_failure'))
      .toEqual({ code: 'ECONNRESET', category: 'native_call_failure' });
    expect(safeError({ code: 'private-token', message: 'private payload' }, 'native_call_failure'))
      .toEqual({ category: 'native_call_failure' });
  });
});
