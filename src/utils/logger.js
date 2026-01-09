"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.globalLogger = exports.Logger = void 0;
var fs = require("fs");
var path = require("path");
var os = require("os");
var Logger = /** @class */ (function () {
    function Logger(component, options) {
        this.component = component;
        this.logFile = options === null || options === void 0 ? void 0 : options.logFile;
        this.logLevel = (options === null || options === void 0 ? void 0 : options.level) || 'info';
        // Ensure log directory exists if file logging is enabled
        if (this.logFile) {
            var logDir = path.dirname(this.logFile);
            fs.mkdirSync(logDir, { recursive: true });
        }
    }
    Logger.prototype.shouldLog = function (level) {
        var levels = ['debug', 'info', 'warn', 'error'];
        var currentIndex = levels.indexOf(this.logLevel);
        var messageIndex = levels.indexOf(level);
        return messageIndex >= currentIndex;
    };
    Logger.prototype.formatMessage = function (level, message, data) {
        var timestamp = new Date().toISOString();
        var prefix = "[".concat(timestamp, "] [").concat(level.toUpperCase(), "] [").concat(this.component, "]");
        var fullMessage = "".concat(prefix, " ").concat(message);
        if (data) {
            fullMessage += " ".concat(JSON.stringify(data));
        }
        return fullMessage;
    };
    Logger.prototype.writeToFile = function (entry) {
        if (!this.logFile)
            return;
        try {
            var line = JSON.stringify(entry) + '\n';
            fs.appendFileSync(this.logFile, line);
        }
        catch (error) {
            // Fail silently to avoid recursive logging
        }
    };
    Logger.prototype.log = function (level, message, data) {
        if (!this.shouldLog(level))
            return;
        var entry = {
            timestamp: new Date().toISOString(),
            level: level,
            component: this.component,
            message: message,
            data: data,
        };
        // Write to file if configured
        this.writeToFile(entry);
        // Format for console
        var formattedMessage = this.formatMessage(level, message, data);
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
    };
    Logger.prototype.debug = function (message, data) {
        this.log('debug', message, data);
    };
    Logger.prototype.info = function (message, data) {
        this.log('info', message, data);
    };
    Logger.prototype.warn = function (message, data) {
        this.log('warn', message, data);
    };
    Logger.prototype.error = function (message, data) {
        this.log('error', message, data);
    };
    // Create a child logger with a sub-component
    Logger.prototype.child = function (subComponent) {
        return new Logger("".concat(this.component, ":").concat(subComponent), { logFile: this.logFile, level: this.logLevel });
    };
    // Set log level dynamically
    Logger.prototype.setLevel = function (level) {
        this.logLevel = level;
    };
    // Get current log level
    Logger.prototype.getLevel = function () {
        return this.logLevel;
    };
    return Logger;
}());
exports.Logger = Logger;
// Global logger instance
exports.globalLogger = new Logger('deliberate', {
    logFile: process.env.DELIBERATE_LOG_FILE ||
        path.join(os.homedir(), '.deliberate', 'logs', 'deliberate.log'),
    level: process.env.DELIBERATE_LOG_LEVEL || 'info',
});
