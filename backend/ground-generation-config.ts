import { CronPattern } from 'croner';

export interface GroundGenerationConfig {
  timeZone: string;
  questions: { schedule: string; count: number };
  quotes: { schedule: string; count: number };
  context: { lookbackDays: number; maxNotes: number; maxNoteBytes: number; maxTotalBytes: number };
}

/** Ready means configuration is valid, not that a generation job is running. */
export type GroundGenerationSettings =
  | { state: 'disabled' }
  | { state: 'invalid' }
  | { state: 'ready'; config: GroundGenerationConfig };

function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (value === undefined) return {};
  if (typeof value !== 'object' || value === null || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) throw new Error('invalid configuration');
  return Object.fromEntries(Object.entries(value));
}

function boundedInteger(value: unknown, fallback: number, max: number): number {
  const result = value === undefined ? fallback : value;
  if (typeof result !== 'number' || !Number.isSafeInteger(result) || result < 1 || result > max) throw new Error('invalid bound');
  return result;
}

function zone(value: unknown): string {
  const input = value === undefined || value === 'server' ? Intl.DateTimeFormat().resolvedOptions().timeZone : value;
  if (typeof input !== 'string' || !input || input.length > 128 || /^[+-]/.test(input)) throw new Error('invalid timezone');
  return new Intl.DateTimeFormat('en', { timeZone: input }).resolvedOptions().timeZone;
}

function job(value: unknown, fallback: string, timeZone: string): GroundGenerationConfig['questions'] {
  const input = object(value, ['schedule', 'count']);
  const schedule = input.schedule === undefined ? fallback : input.schedule;
  if (typeof schedule !== 'string' || schedule.length > 256 || schedule.trim().split(/\s+/).length !== 5) throw new Error('invalid schedule');
  // CronPattern parses without constructing or scheduling a running Cron job.
  new CronPattern(schedule, timeZone, { mode: '5-part' });
  return { schedule, count: boundedInteger(input.count, 5, 50) };
}

/** Validate independently of resource paths and the rest of the daemon configuration. */
export function parseGroundGenerationConfig(ground: unknown): GroundGenerationSettings {
  try {
    if (ground === undefined) return { state: 'disabled' };
    if (typeof ground !== 'object' || ground === null || Array.isArray(ground)) return { state: 'invalid' };
    const raw = 'generation' in ground ? ground.generation : undefined;
    if (raw === undefined) return { state: 'disabled' };
    const input = object(raw, ['enabled', 'timeZone', 'questions', 'quotes', 'context']);
    if (input.enabled !== undefined && typeof input.enabled !== 'boolean') throw new Error('invalid enabled');
    const timeZone = zone(input.timeZone);
    const questions = job(input.questions, '0 6 * * *', timeZone);
    const quotes = job(input.quotes, '15 6 * * 1', timeZone);
    const rawContext = object(input.context, ['lookbackDays', 'maxNotes', 'maxNoteBytes', 'maxTotalBytes']);
    const context = { lookbackDays: boundedInteger(rawContext.lookbackDays, 7, 365), maxNotes: boundedInteger(rawContext.maxNotes, 20, 200),
      maxNoteBytes: boundedInteger(rawContext.maxNoteBytes, 8192, 65536), maxTotalBytes: boundedInteger(rawContext.maxTotalBytes, 65536, 1048576) };
    if (context.maxNoteBytes > context.maxTotalBytes) throw new Error('invalid context bounds');
    if (input.enabled !== true) return { state: 'disabled' };
    return { state: 'ready', config: { timeZone, questions, quotes, context } };
  } catch { return { state: 'invalid' }; }
}
