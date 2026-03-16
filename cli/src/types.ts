/**
 * CLI-specific types.
 */

export interface GlobalFlags {
  human: boolean;
  socket?: string;
  port?: number;
}

export interface CommandResult {
  data: unknown;
  exitCode: number;
}

export interface DaemonError {
  error: string;
  code: string;
  detail?: string;
}

/** Exit codes per D2 convention. */
export const EXIT_SUCCESS = 0;
export const EXIT_APP_ERROR = 1;
export const EXIT_USAGE_ERROR = 2;
export const EXIT_CONNECTION_ERROR = 3;
