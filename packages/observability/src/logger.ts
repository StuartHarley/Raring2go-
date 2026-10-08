import { redactSensitiveData } from "@raring2go/audit";

export type LogLevel = "debug" | "info" | "warn" | "error";

const levelRank: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export type LogFields = Record<string, unknown>;

export type LogRecord = {
  time: string;
  level: LogLevel;
  service: string;
  message: string;
} & LogFields;

export type LogSink = (record: LogRecord) => void;

export type Logger = {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  /** A logger that stamps every record with extra context (correlation id, job id, actor...). */
  child(fields: LogFields): Logger;
};

/** One JSON object per line: the format log drains (Vercel, Datadog, Loki) all ingest. */
export const jsonLineSink: LogSink = (record) => {
  const line = JSON.stringify(record);
  if (record.level === "error") {
    console.error(line);
  } else if (record.level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
};

export type CreateLoggerOptions = {
  service: string;
  level?: LogLevel;
  sink?: LogSink;
  now?: () => Date;
  context?: LogFields;
};

export function createLogger(options: CreateLoggerOptions): Logger {
  const minimum = levelRank[options.level ?? "info"];
  const sink = options.sink ?? jsonLineSink;
  const now = options.now ?? (() => new Date());
  const context = options.context ?? {};

  function emit(level: LogLevel, message: string, fields: LogFields = {}) {
    if (levelRank[level] < minimum) {
      return;
    }

    // Reserved keys always win over caller fields so a record can never be spoofed.
    sink(
      redactSensitiveData({
        ...serialiseErrors(context),
        ...serialiseErrors(fields),
        time: now().toISOString(),
        level,
        service: options.service,
        message
      }) as LogRecord
    );
  }

  return {
    debug: (message, fields) => emit("debug", message, fields),
    info: (message, fields) => emit("info", message, fields),
    warn: (message, fields) => emit("warn", message, fields),
    error: (message, fields) => emit("error", message, fields),
    child: (fields) => createLogger({ ...options, context: { ...context, ...fields } })
  };
}

/** Errors are not JSON-serialisable by default; keep name/message/stack so failures stay debuggable. */
function serialiseErrors(fields: LogFields): LogFields {
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [
      key,
      value instanceof Error ? { name: value.name, message: value.message, stack: value.stack } : value
    ])
  );
}

export function resolveLogLevel(value: string | undefined): LogLevel {
  return value && value in levelRank ? (value as LogLevel) : "info";
}
