type LogLevel = "debug" | "info" | "warn" | "error";

class Logger {
  private prefix: string;

  constructor(prefix: string) {
    this.prefix = prefix;
  }

  private log(level: LogLevel, message: string, ...args: unknown[]): void {
    const timestamp = new Date().toISOString();
    const formatted = `[${timestamp}] [${level.toUpperCase()}] [${this.prefix}] ${message}`;
    if (args.length > 0) {
      console.log(formatted, ...args);
    } else {
      console.log(formatted);
    }
  }

  debug(message: string, ...args: unknown[]): void {
    this.log("debug", message, ...args);
  }

  info(message: string, ...args: unknown[]): void {
    this.log("info", message, ...args);
  }

  warn(message: string, ...args: unknown[]): void {
    this.log("warn", message, ...args);
  }

  error(message: string, ...args: unknown[]): void {
    this.log("error", message, ...args);
  }
}

export function createLogger(prefix: string): Logger {
  return new Logger(prefix);
}
