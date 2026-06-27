export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

export interface LogEntry {
  timestamp: string;
  level: string;
  component: string;
  message: string;
  sessionId?: string;
  taskId?: string;
  toolName?: string;
  decision?: string;
  durationMs?: number;
  [key: string]: unknown;
}

export class WardenLogger {
  constructor(
    private component: string,
    private minLevel: LogLevel = LogLevel.INFO,
  ) {}

  info(message: string, context?: Record<string, unknown>): void {
    this.log(LogLevel.INFO, message, context);
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.log(LogLevel.WARN, message, context);
  }

  error(message: string, context?: Record<string, unknown>): void {
    this.log(LogLevel.ERROR, message, context);
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.log(LogLevel.DEBUG, message, context);
  }

  private log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    if (level < this.minLevel) return;
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: LogLevel[level],
      component: this.component,
      message,
      ...context,
    };
    process.stdout.write(JSON.stringify(entry) + "\n");
  }
}

const LEVEL_MAP: Record<string, LogLevel> = {
  debug: LogLevel.DEBUG,
  info: LogLevel.INFO,
  warn: LogLevel.WARN,
  error: LogLevel.ERROR,
};

export function parseLogLevel(envValue: string | undefined): LogLevel {
  if (envValue === undefined) return LogLevel.INFO;
  const lower = envValue.toLowerCase();
  return LEVEL_MAP[lower] ?? LogLevel.INFO;
}
