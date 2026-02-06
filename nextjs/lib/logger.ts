/**
 * Logger utility for Memory Loop backend
 *
 * Provides structured logging with prefixes for different modules.
 * All logs include timestamps for debugging timing issues.
 *
 * Log level can be controlled via LOG_LEVEL environment variable:
 * - "debug" - All logs including debug
 * - "info" - Info, warn, error (default)
 * - "warn" - Warn and error only
 * - "error" - Error only
 * - "silent" - No logs (useful for tests)
 */

type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  silent: 4,
};

// Initialize from environment, default to "info"
let currentLogLevel: LogLevel =
  (process.env.LOG_LEVEL as LogLevel) || "info";

/**
 * Set the minimum log level. Logs below this level are suppressed.
 */
export function setLogLevel(level: LogLevel): void {
  currentLogLevel = level;
}

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  module: string;
  message: string;
  data?: unknown;
}

/**
 * Formats a log entry for console output.
 */
function formatLog(entry: LogEntry): string {
  const time = entry.timestamp.split("T")[1]?.slice(0, 12) ?? entry.timestamp;
  const prefix = `[${time}] [${entry.level.toUpperCase().padEnd(5)}] [${entry.module}]`;
  return `${prefix} ${entry.message}`;
}

/**
 * Creates a logger for a specific module.
 */
export function createLogger(module: string) {
  const log = (level: LogLevel, message: string, data?: unknown) => {
    // Check if this log level should be suppressed
    if (LOG_LEVEL_PRIORITY[level] < LOG_LEVEL_PRIORITY[currentLogLevel]) {
      return;
    }

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      module,
      message,
      data,
    };

    const formatted = formatLog(entry);

    switch (level) {
      case "debug":
        console.log(formatted, data !== undefined ? data : "");
        break;
      case "info":
        console.log(formatted, data !== undefined ? data : "");
        break;
      case "warn":
        console.warn(formatted, data !== undefined ? data : "");
        break;
      case "error":
        console.error(formatted, data !== undefined ? data : "");
        break;
    }
  };

  return {
    debug: (message: string, data?: unknown) => log("debug", message, data),
    info: (message: string, data?: unknown) => log("info", message, data),
    warn: (message: string, data?: unknown) => log("warn", message, data),
    error: (message: string, data?: unknown) => log("error", message, data),
  };
}

// Pre-created loggers for each module
export const wsLog = createLogger("WS");
export const vaultLog = createLogger("Vault");
export const sessionLog = createLogger("Session");
export const serverLog = createLogger("Server");
