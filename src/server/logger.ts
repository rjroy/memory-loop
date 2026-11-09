type Level = 'error' | 'warning' | 'info' | 'verbose';
type Details = Record<string, unknown>;
type Sink = (level: Level, event: string, details: Details) => void;

const priorities: Record<Level, number> = { error: 0, warning: 1, info: 2, verbose: 3 };
const safeCodes = new Set(['EACCES', 'EPERM', 'ENOENT', 'ENOSPC', 'EIO', 'EBUSY', 'EADDRINUSE', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH', 'SQLITE_BUSY', 'SQLITE_LOCKED', 'SQLITE_FULL', 'SQLITE_IOERR', 'SQLITE_CORRUPT', 'SQLITE_READONLY']);

/** Extract only known infrastructure codes, including Node fetch's nested cause. */
export function safeError(error: unknown, category: string): { code?: string; category: string } {
  let current = error;
  for (let depth = 0; depth < 3 && typeof current === 'object' && current !== null; depth++) {
    if ('code' in current && typeof current.code === 'string' && safeCodes.has(current.code)) return { code: current.code, category };
    current = 'cause' in current ? current.cause : undefined;
  }
  return { category };
}

function severity(event: string, details: Details): Level {
  const status = details.status ?? details.outcome ?? details.state;
  if (typeof status === 'number' && status >= 500 || status === 'failed') return 'error';
  if (event === 'think_state_write_outcome' && status === 'unavailable') return 'error';
  if (status === 'unavailable' || status === 'invalid' || status === 'below_minimum' || status === 'retrying' || status === 'pending' || status === 'registry-only') return 'warning';
  if (/^(ground_read|think_hydration|think_transcript)_(attempt|outcome)$/.test(event)) return 'verbose';
  if (/^(think_native|think_state_write|think_bff|vault_bff|vault_api|ground_bff)_(attempt|outcome)$/.test(event)) return 'verbose';
  return 'info';
}

export function createServerLogger(options: { env?: Record<string, string | undefined>; sink?: Sink } = {}) {
  const configured = (options.env ?? process.env).MEMORY_LOOP_LOG_LEVEL;
  const threshold: Level = configured === 'error' || configured === 'warning' || configured === 'verbose' || configured === 'info' ? configured : 'info';
  const sink: Sink = options.sink ?? ((level, event, details) => {
    const output = { level, ...details };
    if (level === 'error') console.error(event, output);
    else if (level === 'warning') console.warn(event, output);
    else console.info(event, output);
  });
  const emit = (level: Level, event: string, details: Details = {}) => {
    if (priorities[level] <= priorities[threshold]) sink(level, event, details);
  };
  return {
    log: (event: string, details: Details = {}) => emit(severity(event, details), event, details),
    error: (event: string, details: Details = {}) => emit('error', event, details),
    warning: (event: string, details: Details = {}) => emit('warning', event, details),
    info: (event: string, details: Details = {}) => emit('info', event, details),
    verbose: (event: string, details: Details = {}) => emit('verbose', event, details),
  };
}

export const serverLogger = createServerLogger();
