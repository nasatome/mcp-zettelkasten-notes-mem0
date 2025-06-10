/**
 * Shared logger for MCP servers
 * 
 * For STDIO servers: Uses stderr to avoid interfering with JSON-RPC on stdout
 * For Express servers: Can use regular console or structured logging
 */

export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  debug(message: string): void;
}

/**
 * STDIO Logger - Uses stderr for all output to not interfere with JSON-RPC
 */
export class StdioLogger implements Logger {
  info(message: string): void {
    process.stderr.write(`[INFO] ${message}\n`);
  }

  warn(message: string): void {
    process.stderr.write(`[WARN] ${message}\n`);
  }

  error(message: string): void {
    process.stderr.write(`[ERROR] ${message}\n`);
  }

  debug(message: string): void {
    process.stderr.write(`[DEBUG] ${message}\n`);
  }
}

/**
 * Console Logger - For Express/SSE servers
 */
export class ConsoleLogger implements Logger {
  info(message: string): void {
    console.log(`[INFO] ${message}`);
  }

  warn(message: string): void {
    console.warn(`[WARN] ${message}`);
  }

  error(message: string): void {
    console.error(`[ERROR] ${message}`);
  }

  debug(message: string): void {
    console.debug(`[DEBUG] ${message}`);
  }
}

/**
 * Create appropriate logger for the context
 */
export function createLogger(type: 'stdio' | 'console'): Logger {
  return type === 'stdio' ? new StdioLogger() : new ConsoleLogger();
} 