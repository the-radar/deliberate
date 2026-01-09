"use strict";
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SensitiveDataRedactor = void 0;
var crypto = require("crypto");
var SensitiveDataRedactor = /** @class */ (function () {
    function SensitiveDataRedactor() {
        this.patterns = new Map();
        this.compiledPatterns = new Map();
        this.redactionCache = new Map();
        this.initializePatterns();
    }
    /**
     * Initialize built-in redaction patterns
     */
    SensitiveDataRedactor.prototype.initializePatterns = function () {
        // API Keys
        this.addPattern({
            name: 'bearer_token',
            pattern: /Bearer\s+[A-Za-z0-9\-._~+\/]+=*/gi,
            replacement: 'Bearer [REDACTED_API_KEY]',
        });
        this.addPattern({
            name: 'openai_key',
            pattern: /sk-[A-Za-z0-9]{20,}/gi,
            replacement: '[REDACTED_API_KEY]',
        });
        this.addPattern({
            name: 'aws_access_key',
            pattern: /AKIA[0-9A-Z]{16}/gi,
            replacement: '[REDACTED_AWS_KEY]',
        });
        this.addPattern({
            name: 'google_api_key',
            pattern: /AIza[0-9A-Za-z\-_]{35}/gi,
            replacement: '[REDACTED_API_KEY]',
        });
        this.addPattern({
            name: 'github_token',
            pattern: /ghp_[A-Za-z0-9]{36}/gi,
            replacement: '[REDACTED_GITHUB_TOKEN]',
        });
        // Passwords
        this.addPattern({
            name: 'password_param',
            pattern: /(\b(?:password|passwd|pwd|pass)\s*[=:]\s*)([^\s&;]+)/gi,
            replacement: '$1[REDACTED]',
        });
        this.addPattern({
            name: 'mysql_password',
            pattern: /(-p)([^\s]+)/g,
            replacement: '-p[REDACTED_PASSWORD]',
        });
        this.addPattern({
            name: 'url_credentials',
            pattern: /:\/\/([^:]+):([^@]+)@/g,
            replacement: '://$1:[REDACTED]@',
        });
        // SSH Keys
        this.addPattern({
            name: 'ssh_private_key',
            pattern: /-----BEGIN\s+(?:RSA|DSA|EC|OPENSSH)\s+PRIVATE\s+KEY-----[\s\S]+?-----END\s+(?:RSA|DSA|EC|OPENSSH)\s+PRIVATE\s+KEY-----/gi,
            replacement: '[REDACTED_SSH_PRIVATE_KEY]',
        });
        this.addPattern({
            name: 'ssh_public_key',
            pattern: /ssh-rsa\s+[A-Za-z0-9+\/=]+/gi,
            replacement: '[REDACTED_SSH_KEY]',
        });
        this.addPattern({
            name: 'certificate',
            pattern: /-----BEGIN\s+CERTIFICATE-----[\s\S]+?-----END\s+CERTIFICATE-----/gi,
            replacement: '[REDACTED_CERTIFICATE]',
        });
        // Credit Cards
        this.addPattern({
            name: 'credit_card',
            pattern: /\b(?:\d{4}[-\s]?){3}\d{4}\b/g,
            replacement: '[REDACTED_CC]',
        });
        // SSN
        this.addPattern({
            name: 'ssn',
            pattern: /\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b/g,
            replacement: '[REDACTED_SSN]',
        });
        // Email (optional)
        this.addPattern({
            name: 'email',
            pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
            replacement: '[REDACTED_EMAIL]',
        });
        // Environment variables
        this.addPattern({
            name: 'env_secret',
            pattern: /(AWS_SECRET_ACCESS_KEY|DATABASE_PASSWORD|DB_PASSWORD|API_KEY|SECRET_KEY|PRIVATE_KEY|JWT_SECRET)\s*=\s*([^\s]+)/gi,
            replacement: '$1=[REDACTED]',
        });
    };
    /**
     * Add custom redaction pattern
     */
    SensitiveDataRedactor.prototype.addPattern = function (pattern) {
        this.patterns.set(pattern.name, pattern);
        this.compiledPatterns.set(pattern.name, pattern.pattern);
        // Clear cache when patterns change
        this.redactionCache.clear();
    };
    /**
     * Redact sensitive data from text
     */
    SensitiveDataRedactor.prototype.redact = function (text_1) {
        return __awaiter(this, arguments, void 0, function (text, options) {
            var startTime, cacheKey, cached, redacted, found, sensitiveCount, sortedPatterns, _i, sortedPatterns_1, pattern, matches, _a, matches_1, match, result;
            if (options === void 0) { options = {}; }
            return __generator(this, function (_b) {
                startTime = Date.now();
                cacheKey = "".concat(text, ":").concat(JSON.stringify(options));
                cached = this.redactionCache.get(cacheKey);
                if (cached) {
                    return [2 /*return*/, __assign(__assign({}, cached), { cached: true, performanceMs: Date.now() - startTime })];
                }
                redacted = text;
                found = [];
                sensitiveCount = 0;
                sortedPatterns = Array.from(this.patterns.values())
                    .sort(function (a, b) { return (b.priority || 0) - (a.priority || 0); });
                for (_i = 0, sortedPatterns_1 = sortedPatterns; _i < sortedPatterns_1.length; _i++) {
                    pattern = sortedPatterns_1[_i];
                    // Skip email pattern if not requested
                    if (pattern.name === 'email' && !options.redactEmails) {
                        continue;
                    }
                    matches = text.matchAll(pattern.pattern);
                    for (_a = 0, matches_1 = matches; _a < matches_1.length; _a++) {
                        match = matches_1[_a];
                        sensitiveCount++;
                        found.push({
                            type: pattern.name,
                            position: { start: match.index, end: match.index + match[0].length },
                            redacted: true,
                            value: options.enableRecovery ? this.hashValue(match[0]) : undefined,
                        });
                        if (options.preserveStructure && pattern.name.includes('key')) {
                            // Preserve some structure for debugging
                            redacted = redacted.replace(match[0], this.preserveStructure(match[0]));
                        }
                        else {
                            redacted = redacted.replace(match[0], pattern.replacement);
                        }
                    }
                }
                result = {
                    redacted: redacted,
                    found: found,
                    count: found.length,
                    sensitive: found.length > 0,
                    performanceMs: Date.now() - startTime,
                };
                // Add recovery information if requested
                if (options.enableRecovery && found.length > 0) {
                    result.recovery = {
                        hash: this.hashValue(text),
                        timestamp: Date.now(),
                        context: 'redaction',
                    };
                }
                // Add validation
                result.validation = {
                    originalSensitiveCount: sensitiveCount,
                    remainingSensitiveCount: this.countRemainingSensitive(redacted),
                    success: this.countRemainingSensitive(redacted) === 0,
                };
                // Cache result
                this.redactionCache.set(cacheKey, result);
                return [2 /*return*/, result];
            });
        });
    };
    /**
     * Redact sensitive data from command
     */
    SensitiveDataRedactor.prototype.redactCommand = function (command) {
        return __awaiter(this, void 0, void 0, function () {
            var result;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, this.redact(command)];
                    case 1:
                        result = _a.sent();
                        return [2 /*return*/, result.redacted];
                }
            });
        });
    };
    /**
     * Redact sensitive data from output
     */
    SensitiveDataRedactor.prototype.redactOutput = function (output) {
        return __awaiter(this, void 0, void 0, function () {
            var result;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, this.redact(output)];
                    case 1:
                        result = _a.sent();
                        return [2 /*return*/, result.redacted];
                }
            });
        });
    };
    /**
     * Redact sensitive data from logs
     */
    SensitiveDataRedactor.prototype.redactLogs = function (logs) {
        return __awaiter(this, void 0, void 0, function () {
            var lines, redactedLines, totalRedactionCount, _i, lines_1, line, result;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        lines = logs.split('\n');
                        redactedLines = [];
                        totalRedactionCount = 0;
                        _i = 0, lines_1 = lines;
                        _a.label = 1;
                    case 1:
                        if (!(_i < lines_1.length)) return [3 /*break*/, 4];
                        line = lines_1[_i];
                        return [4 /*yield*/, this.redact(line)];
                    case 2:
                        result = _a.sent();
                        redactedLines.push(result.redacted);
                        totalRedactionCount += result.count || 0;
                        _a.label = 3;
                    case 3:
                        _i++;
                        return [3 /*break*/, 1];
                    case 4: return [2 /*return*/, {
                            redacted: redactedLines.join('\n'),
                            redactionCount: totalRedactionCount,
                            preservedStructure: true,
                        }];
                }
            });
        });
    };
    /**
     * Detect sensitive data without redacting
     */
    SensitiveDataRedactor.prototype.detectSensitiveData = function (text) {
        return __awaiter(this, void 0, void 0, function () {
            var found, _i, _a, _b, name_1, pattern, matches, _c, matches_2, match;
            return __generator(this, function (_d) {
                found = [];
                for (_i = 0, _a = this.patterns.entries(); _i < _a.length; _i++) {
                    _b = _a[_i], name_1 = _b[0], pattern = _b[1];
                    matches = text.matchAll(pattern.pattern);
                    for (_c = 0, matches_2 = matches; _c < matches_2.length; _c++) {
                        match = matches_2[_c];
                        found.push({
                            type: name_1,
                            position: { start: match.index, end: match.index + match[0].length },
                            preview: this.getPreview(text, match.index, match[0].length),
                        });
                    }
                }
                return [2 /*return*/, found];
            });
        });
    };
    /**
     * Check if text has been properly redacted
     */
    SensitiveDataRedactor.prototype.isRedacted = function (text) {
        return __awaiter(this, void 0, void 0, function () {
            var sensitivePatterns, _i, sensitivePatterns_1, pattern;
            return __generator(this, function (_a) {
                sensitivePatterns = [
                    /sk-[A-Za-z0-9]{20,}/, // API keys
                    /password\s*[=:]\s*[^\s\[]/i, // Unredacted passwords
                    /-----BEGIN.*PRIVATE.*KEY-----/, // Private keys
                    /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/, // Credit cards
                ];
                for (_i = 0, sensitivePatterns_1 = sensitivePatterns; _i < sensitivePatterns_1.length; _i++) {
                    pattern = sensitivePatterns_1[_i];
                    if (pattern.test(text)) {
                        return [2 /*return*/, false];
                    }
                }
                return [2 /*return*/, true];
            });
        });
    };
    /**
     * Get redaction patterns
     */
    SensitiveDataRedactor.prototype.getRedactionPatterns = function () {
        return Array.from(this.patterns.values());
    };
    /**
     * Add custom pattern
     */
    SensitiveDataRedactor.prototype.addCustomPattern = function (pattern) {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                this.addPattern(pattern);
                return [2 /*return*/];
            });
        });
    };
    /**
     * Preserve structure of sensitive data
     */
    SensitiveDataRedactor.prototype.preserveStructure = function (value) {
        if (value.length <= 10) {
            return value.substring(0, 2) + '*'.repeat(value.length - 2);
        }
        return value.substring(0, 7) + '*'.repeat(value.length - 7);
    };
    /**
     * Hash value for recovery
     */
    SensitiveDataRedactor.prototype.hashValue = function (value) {
        return "sha256:".concat(crypto.createHash('sha256').update(value).digest('hex'));
    };
    /**
     * Count remaining sensitive data
     */
    SensitiveDataRedactor.prototype.countRemainingSensitive = function (text) {
        var count = 0;
        for (var _i = 0, _a = this.patterns.values(); _i < _a.length; _i++) {
            var pattern = _a[_i];
            var matches = text.matchAll(pattern.pattern);
            for (var _b = 0, matches_3 = matches; _b < matches_3.length; _b++) {
                var match = matches_3[_b];
                if (!match[0].includes('[REDACTED')) {
                    count++;
                }
            }
        }
        return count;
    };
    /**
     * Get preview of sensitive data location
     */
    SensitiveDataRedactor.prototype.getPreview = function (text, index, length) {
        var start = Math.max(0, index - 20);
        var end = Math.min(text.length, index + length + 20);
        var preview = text.substring(start, end);
        var relativeIndex = index - start;
        return (preview.substring(0, relativeIndex) +
            '[***]' +
            preview.substring(relativeIndex + length));
    };
    return SensitiveDataRedactor;
}());
exports.SensitiveDataRedactor = SensitiveDataRedactor;
