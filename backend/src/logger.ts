/**
 * Logger utility for Memory Loop backend
 *
 * Provides structured logging with prefixes for different modules.
 * All logs include timestamps for debugging timing issues.
 */

type LogLevel = "debug" | "info" | "warn" | "error";

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
        if (process.env.DEBUG) {
          console.log(formatted, data !== undefined ? data : "");
        }
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
