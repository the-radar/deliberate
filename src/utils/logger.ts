import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  component: string;
  message: string;
  data?: any;
}

export class Logger {
  private component: string;
  private logFile?: string;
  private logLevel: LogLevel;

  constructor(component: string, options?: { logFile?: string; level?: LogLevel }) {
    this.component = component;
    this.logFile = options?.logFile;
    this.logLevel = options?.level || 'info';
    
    // Ensure log directory exists if file logging is enabled
    if (this.logFile) {
      const logDir = path.dirname(this.logFile);
      fs.mkdirSync(logDir, { recursive: true });
    }
  }

  private shouldLog(level: LogLevel): boolean {
    const levels: LogLevel[] = ['debug', 'info', 'warn', 'error'];
    const currentIndex = levels.indexOf(this.logLevel);
    const messageIndex = levels.indexOf(level);
    return messageIndex >= currentIndex;
  }

  private formatMessage(level: LogLevel, message: string, data?: any): string {
    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${level.toUpperCase()}] [${this.component}]`;
    
    let fullMessage = `${prefix} ${message}`;
    if (data) {
      fullMessage += ` ${JSON.stringify(data)}`;
    }
    
    return fullMessage;
  }

  private writeToFile(entry: LogEntry): void {
    if (!this.logFile) return;
    
    try {
      const line = JSON.stringify(entry) + '\n';
      fs.appendFileSync(this.logFile, line);
    } catch (error) {
      // Fail silently to avoid recursive logging
    }
  }

  private log(level: LogLevel, message: string, data?: any): void {
    if (!this.shouldLog(level)) return;
    
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      component: this.component,
      message,
      data,
    };
    
    // Write to file if configured
    this.writeToFile(entry);
    
    // Format for console
    const formattedMessage = this.formatMessage(level, message, data);
    
    switch (level) {
      case 'debug':
        console.debug(formattedMessage);
        break;
      case 'info':
        console.log(formattedMessage);
        break;
      case 'warn':
        console.warn(formattedMessage);
        break;
      case 'error':
        console.error(formattedMessage);
        break;
    }
  }

  debug(message: string, data?: any): void {
    this.log('debug', message, data);
  }

  info(message: string, data?: any): void {
    this.log('info', message, data);
  }

  warn(message: string, data?: any): void {
    this.log('warn', message, data);
  }

  error(message: string, data?: any): void {
    this.log('error', message, data);
  }

  // Create a child logger with a sub-component
  child(subComponent: string): Logger {
    return new Logger(
      `${this.component}:${subComponent}`,
      { logFile: this.logFile, level: this.logLevel }
    );
  }

  // Set log level dynamically
  setLevel(level: LogLevel): void {
    this.logLevel = level;
  }

  // Get current log level
  getLevel(): LogLevel {
    return this.logLevel;
  }
}

// Global logger instance
export const globalLogger = new Logger('deliberate', {
  logFile: process.env.DELIBERATE_LOG_FILE || 
    path.join(os.homedir(), '.deliberate', 'logs', 'deliberate.log'),
  level: (process.env.DELIBERATE_LOG_LEVEL as LogLevel) || 'info',
});