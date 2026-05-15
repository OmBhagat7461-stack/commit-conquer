// packages/core/logger.ts
// ─── Structured Logger ────────────────────────────────────────────────────────
// Provides JSON-structured logging with levels, timestamps, correlation IDs,
// and contextual metadata for production observability.

export type LogLevel = "debug" | "info" | "warn" | "error";

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  [key: string]: unknown;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

// Minimum level that gets emitted — controlled by LOG_LEVEL env var
const minLevel: LogLevel =
  (process.env.LOG_LEVEL as LogLevel) ??
  (process.env.NODE_ENV === "production" ? "info" : "debug");

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[minLevel];
}

function formatEntry(entry: LogEntry): string {
  if (process.env.NODE_ENV === "production") {
    // Structured JSON for log aggregation (Datadog, CloudWatch, ELK, etc.)
    return JSON.stringify(entry);
  }
  // Pretty-printed for local dev
  const { timestamp, level, message, ...meta } = entry;
  const metaStr = Object.keys(meta).length
    ? " " + JSON.stringify(meta)
    : "";
  return `[${timestamp}] ${level.toUpperCase().padEnd(5)} ${message}${metaStr}`;
}

function log(level: LogLevel, message: string, meta?: Record<string, unknown>) {
  if (!shouldLog(level)) return;

  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...meta,
  };

  const formatted = formatEntry(entry);

  switch (level) {
    case "error":
      console.error(formatted);
      break;
    case "warn":
      console.warn(formatted);
      break;
    default:
      console.log(formatted);
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export const logger = {
  debug(message: string, meta?: Record<string, unknown>) {
    log("debug", message, meta);
  },

  info(message: string, meta?: Record<string, unknown>) {
    log("info", message, meta);
  },

  warn(message: string, meta?: Record<string, unknown>) {
    log("warn", message, meta);
  },

  error(message: string, meta?: Record<string, unknown>) {
    log("error", message, meta);
  },

  /**
   * Create a child logger that automatically includes the given context
   * in every log entry.  Useful for per-request or per-module logging.
   *
   * Usage:
   *   const reqLog = logger.child({ requestId: "abc123", path: "/api/store/orders" });
   *   reqLog.info("Order placed", { orderId: "ord_1" });
   */
  child(context: Record<string, unknown>) {
    return {
      debug: (msg: string, meta?: Record<string, unknown>) =>
        log("debug", msg, { ...context, ...meta }),
      info: (msg: string, meta?: Record<string, unknown>) =>
        log("info", msg, { ...context, ...meta }),
      warn: (msg: string, meta?: Record<string, unknown>) =>
        log("warn", msg, { ...context, ...meta }),
      error: (msg: string, meta?: Record<string, unknown>) =>
        log("error", msg, { ...context, ...meta }),
    };
  },
};
