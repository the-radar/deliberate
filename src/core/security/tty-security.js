"use strict";
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
exports.TTYSecurity = void 0;
var fs = require("fs");
var tty = require("tty");
var util_1 = require("util");
var openAsync = (0, util_1.promisify)(fs.open);
var closeAsync = (0, util_1.promisify)(fs.close);
var TTYSecurity = /** @class */ (function () {
    function TTYSecurity() {
        this.ttyFd = null;
        this.ttyReadStream = null;
        this.ttyWriteStream = null;
    }
    /**
     * Check if we have a real TTY
     */
    TTYSecurity.prototype.checkTTY = function () {
        return __awaiter(this, void 0, void 0, function () {
            var result, mode, ciVars, _i, ciVars_1, ciVar;
            var _a;
            return __generator(this, function (_b) {
                result = {
                    isRealTTY: false,
                    isPiped: false,
                    isRedirected: false,
                };
                // Check if stdin is a TTY
                if (process.stdin.isTTY) {
                    result.isRealTTY = true;
                }
                else {
                    mode = fs.fstatSync(0).mode;
                    if ((mode & fs.constants.S_IFIFO) === fs.constants.S_IFIFO) {
                        result.isPiped = true;
                    }
                    else if ((mode & fs.constants.S_IFREG) === fs.constants.S_IFREG) {
                        result.isRedirected = true;
                    }
                }
                // Check for background process
                if (process.env.DELIBERATE_BACKGROUND === '1') {
                    result.isBackground = true;
                    result.isRealTTY = false;
                }
                // Check for SSH session
                if (process.env.SSH_TTY || process.env.SSH_CONNECTION) {
                    result.isSSH = true;
                    result.sshClient = (_a = process.env.SSH_CLIENT) === null || _a === void 0 ? void 0 : _a.split(' ')[0];
                }
                ciVars = [
                    'CI', 'CONTINUOUS_INTEGRATION', 'GITHUB_ACTIONS',
                    'GITLAB_CI', 'JENKINS_HOME', 'CIRCLECI', 'TRAVIS',
                    'BUILDKITE', 'DRONE', 'TEAMCITY_VERSION',
                ];
                for (_i = 0, ciVars_1 = ciVars; _i < ciVars_1.length; _i++) {
                    ciVar = ciVars_1[_i];
                    if (process.env[ciVar]) {
                        result.isCI = true;
                        result.ciPlatform = ciVar;
                        result.isRealTTY = false;
                        break;
                    }
                }
                // Check for container environment
                if (fs.existsSync('/.dockerenv')) {
                    result.inContainer = true;
                    result.containerType = 'docker';
                }
                else if (process.env.container === 'podman') {
                    result.inContainer = true;
                    result.containerType = 'podman';
                }
                // Check for non-interactive mode
                if (process.env.DEBIAN_FRONTEND === 'noninteractive') {
                    result.isInteractive = false;
                    result.reason = 'Non-interactive mode detected';
                }
                return [2 /*return*/, result];
            });
        });
    };
    /**
     * Check if we're being run through automation
     */
    TTYSecurity.prototype.detectBypass = function () {
        return __awaiter(this, void 0, void 0, function () {
            var processTree, automationTools, _i, processTree_1, proc, _a, automationTools_1, tool;
            var _b;
            return __generator(this, function (_c) {
                switch (_c.label) {
                    case 0: return [4 /*yield*/, this.getProcessTree()];
                    case 1:
                        processTree = _c.sent();
                        automationTools = [
                            'expect', 'autoexpect', 'empty', 'pty',
                            'script', 'xdotool', 'xte', 'sikuli',
                            'python', 'perl', 'ruby', // Common for expect-like scripts
                        ];
                        for (_i = 0, processTree_1 = processTree; _i < processTree_1.length; _i++) {
                            proc = processTree_1[_i];
                            for (_a = 0, automationTools_1 = automationTools; _a < automationTools_1.length; _a++) {
                                tool = automationTools_1[_a];
                                if (proc.name.includes(tool)) {
                                    // Special handling for legitimate uses
                                    if (tool === 'script' && ((_b = proc.args) === null || _b === void 0 ? void 0 : _b.includes('typescript'))) {
                                        continue; // Recording session, not automating
                                    }
                                    return [2 /*return*/, {
                                            isAutomated: true,
                                            tool: tool,
                                            confidence: 0.9,
                                        }];
                                }
                            }
                        }
                        return [2 /*return*/, {
                                isAutomated: false,
                                confidence: 0.1,
                            }];
                }
            });
        });
    };
    /**
     * Get secure approval from user
     */
    TTYSecurity.prototype.getApproval = function (command, args, classification) {
        return __awaiter(this, void 0, void 0, function () {
            var options, startTime, response, responseTime, validation, error_1;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        options = {
                            riskLevel: classification.riskLevel || 'CAUTION',
                            timeout: 30000, // 30 seconds default
                            requireFullWord: classification.riskLevel === 'CRITICAL',
                        };
                        _a.label = 1;
                    case 1:
                        _a.trys.push([1, 6, 7, 9]);
                        // Open direct TTY connection
                        return [4 /*yield*/, this.openTTY()];
                    case 2:
                        // Open direct TTY connection
                        _a.sent();
                        // Clear any buffered input
                        return [4 /*yield*/, this.flushInput()];
                    case 3:
                        // Clear any buffered input
                        _a.sent();
                        // Display warning based on risk level
                        return [4 /*yield*/, this.displayWarning(command, args, options)];
                    case 4:
                        // Display warning based on risk level
                        _a.sent();
                        startTime = Date.now();
                        return [4 /*yield*/, this.securePrompt(this.getPromptMessage(options), options.timeout)];
                    case 5:
                        response = _a.sent();
                        responseTime = Date.now() - startTime;
                        validation = this.validateResponse(response, responseTime, options);
                        return [2 /*return*/, {
                                approved: validation.approved,
                                reason: validation.reason,
                                responseTime: responseTime,
                                suspicious: validation.suspicious,
                                validInput: validation.valid,
                            }];
                    case 6:
                        error_1 = _a.sent();
                        return [2 /*return*/, {
                                approved: false,
                                reason: error_1 instanceof Error ? error_1.message : 'Unknown error',
                            }];
                    case 7: return [4 /*yield*/, this.closeTTY()];
                    case 8:
                        _a.sent();
                        return [7 /*endfinally*/];
                    case 9: return [2 /*return*/];
                }
            });
        });
    };
    /**
     * Open direct TTY connection
     */
    TTYSecurity.prototype.openTTY = function () {
        return __awaiter(this, void 0, void 0, function () {
            var _a, error_2;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        _b.trys.push([0, 2, , 3]);
                        // Open /dev/tty for reading and writing
                        _a = this;
                        return [4 /*yield*/, openAsync('/dev/tty', fs.constants.O_RDWR)];
                    case 1:
                        // Open /dev/tty for reading and writing
                        _a.ttyFd = _b.sent();
                        // Create TTY streams
                        this.ttyReadStream = new tty.ReadStream(this.ttyFd);
                        this.ttyWriteStream = new tty.WriteStream(this.ttyFd);
                        // Set raw mode for input
                        if (this.ttyReadStream.setRawMode) {
                            this.ttyReadStream.setRawMode(true);
                        }
                        return [3 /*break*/, 3];
                    case 2:
                        error_2 = _b.sent();
                        throw new Error('No TTY available for secure input');
                    case 3: return [2 /*return*/];
                }
            });
        });
    };
    /**
     * Close TTY connection
     */
    TTYSecurity.prototype.closeTTY = function () {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (this.ttyReadStream) {
                            this.ttyReadStream.destroy();
                            this.ttyReadStream = null;
                        }
                        if (this.ttyWriteStream) {
                            this.ttyWriteStream.destroy();
                            this.ttyWriteStream = null;
                        }
                        if (!(this.ttyFd !== null)) return [3 /*break*/, 2];
                        return [4 /*yield*/, closeAsync(this.ttyFd)];
                    case 1:
                        _a.sent();
                        this.ttyFd = null;
                        _a.label = 2;
                    case 2: return [2 /*return*/];
                }
            });
        });
    };
    /**
     * Flush any buffered input
     */
    TTYSecurity.prototype.flushInput = function () {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                if (!this.ttyReadStream)
                    return [2 /*return*/];
                // Set non-blocking mode temporarily
                this.ttyReadStream.setRawMode(false);
                // Read and discard any pending input
                while (this.ttyReadStream.readable && this.ttyReadStream.read() !== null) {
                    // Keep reading until buffer is empty
                }
                // Restore raw mode
                this.ttyReadStream.setRawMode(true);
                return [2 /*return*/];
            });
        });
    };
    /**
     * Display risk warning
     */
    TTYSecurity.prototype.displayWarning = function (command, args, options) {
        return __awaiter(this, void 0, void 0, function () {
            var write;
            var _this = this;
            return __generator(this, function (_a) {
                if (!this.ttyWriteStream)
                    return [2 /*return*/];
                write = function (text) {
                    _this.ttyWriteStream.write(text);
                };
                write('\n');
                write('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
                switch (options.riskLevel) {
                    case 'CRITICAL':
                        write('⚠️  CRITICAL RISK - This action cannot be undone! ⚠️\n');
                        break;
                    case 'HIGH':
                        write('⚠️  HIGH RISK - This action may cause serious damage\n');
                        break;
                    case 'CAUTION':
                        write('⚠  CAUTION - This action requires careful consideration\n');
                        break;
                    default:
                        write('ℹ  Command requires approval\n');
                }
                write('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n');
                write("Command: ".concat(command, " ").concat(args.join(' '), "\n"));
                write("Working directory: ".concat(process.cwd(), "\n"));
                if (process.env.SUDO_USER) {
                    write("Running as: root (via sudo from ".concat(process.env.SUDO_USER, ")\n"));
                }
                else {
                    write("Running as: ".concat(process.env.USER || 'unknown', "\n"));
                }
                write('\n');
                return [2 /*return*/];
            });
        });
    };
    /**
     * Get secure input from user
     */
    TTYSecurity.prototype.securePrompt = function (prompt, timeout) {
        return __awaiter(this, void 0, void 0, function () {
            var _this = this;
            return __generator(this, function (_a) {
                return [2 /*return*/, new Promise(function (resolve, reject) {
                        if (!_this.ttyReadStream || !_this.ttyWriteStream) {
                            reject(new Error('TTY not available'));
                            return;
                        }
                        _this.ttyWriteStream.write(prompt);
                        var input = '';
                        var timer;
                        var cleanup = function () {
                            if (timer)
                                clearTimeout(timer);
                            _this.ttyReadStream.removeAllListeners('data');
                        };
                        // Set timeout
                        timer = setTimeout(function () {
                            cleanup();
                            _this.ttyWriteStream.write('\nTimeout - approval denied\n');
                            reject(new Error('Approval timeout'));
                        }, timeout);
                        // Handle input
                        _this.ttyReadStream.on('data', function (chunk) {
                            var char = chunk.toString();
                            // Handle special characters
                            if (char === '\r' || char === '\n') {
                                cleanup();
                                _this.ttyWriteStream.write('\n');
                                resolve(input);
                            }
                            else if (char === '\x03') { // Ctrl+C
                                cleanup();
                                _this.ttyWriteStream.write('^C\n');
                                reject(new Error('User cancelled'));
                            }
                            else if (char === '\x7f' || char === '\b') { // Backspace
                                if (input.length > 0) {
                                    input = input.slice(0, -1);
                                    _this.ttyWriteStream.write('\b \b');
                                }
                            }
                            else {
                                input += char;
                                _this.ttyWriteStream.write('*'); // Hide input
                            }
                        });
                    })];
            });
        });
    };
    /**
     * Get prompt message based on risk level
     */
    TTYSecurity.prototype.getPromptMessage = function (options) {
        if (options.riskLevel === 'CRITICAL') {
            return 'Type "yes" to confirm or press Enter to cancel: ';
        }
        return 'Approve? [y/N]: ';
    };
    /**
     * Validate user response
     */
    TTYSecurity.prototype.validateResponse = function (response, responseTime, options) {
        // Check for suspiciously fast response
        if (responseTime < 100) {
            return {
                approved: false,
                reason: 'Response too fast (possible automation)',
                suspicious: true,
                valid: false,
            };
        }
        // Normalize response
        var normalized = response.trim().toLowerCase();
        // Critical commands require full word
        if (options.requireFullWord) {
            var validResponses = ['yes', 'confirm'];
            return {
                approved: validResponses.includes(normalized),
                valid: true,
            };
        }
        // Normal approval
        var approvals = ['y', 'yes', 'ok', 'confirm'];
        return {
            approved: approvals.includes(normalized),
            valid: true,
        };
    };
    /**
     * Get process tree for bypass detection
     */
    TTYSecurity.prototype.getProcessTree = function () {
        return __awaiter(this, void 0, void 0, function () {
            var tree;
            return __generator(this, function (_a) {
                tree = [];
                try {
                    // Get current process info
                    tree.push({
                        pid: process.pid,
                        ppid: process.ppid,
                        name: process.title,
                    });
                    // In real implementation, walk up the process tree
                    // using /proc/[pid]/stat or platform APIs
                }
                catch (_b) {
                    // Fallback if process info unavailable
                }
                return [2 /*return*/, tree];
            });
        });
    };
    /**
     * Get approval with AI-enhanced analysis
     */
    TTYSecurity.prototype.getApprovalWithAnalysis = function (command, args, analysis) {
        return __awaiter(this, void 0, void 0, function () {
            var riskLevel, options, startTime, response, responseTime, validation, error_3;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        riskLevel = this.mapVerdictToRisk(analysis.verdict);
                        options = {
                            riskLevel: riskLevel,
                            timeout: 30000,
                            requireFullWord: riskLevel === 'CRITICAL' || analysis.risks.length > 3,
                        };
                        _a.label = 1;
                    case 1:
                        _a.trys.push([1, 6, 7, 9]);
                        // Open direct TTY connection
                        return [4 /*yield*/, this.openTTY()];
                    case 2:
                        // Open direct TTY connection
                        _a.sent();
                        // Clear any buffered input
                        return [4 /*yield*/, this.flushInput()];
                    case 3:
                        // Clear any buffered input
                        _a.sent();
                        // Display AI-enhanced warning
                        return [4 /*yield*/, this.displayAIWarning(command, args, analysis, options)];
                    case 4:
                        // Display AI-enhanced warning
                        _a.sent();
                        startTime = Date.now();
                        return [4 /*yield*/, this.securePrompt(this.getPromptMessage(options), options.timeout)];
                    case 5:
                        response = _a.sent();
                        responseTime = Date.now() - startTime;
                        validation = this.validateResponse(response, responseTime, options);
                        return [2 /*return*/, {
                                approved: validation.approved,
                                reason: validation.reason,
                                responseTime: responseTime,
                                suspicious: validation.suspicious,
                                validInput: validation.valid,
                                securityScore: analysis.confidence,
                            }];
                    case 6:
                        error_3 = _a.sent();
                        return [2 /*return*/, {
                                approved: false,
                                reason: error_3 instanceof Error ? error_3.message : 'Unknown error',
                            }];
                    case 7: return [4 /*yield*/, this.closeTTY()];
                    case 8:
                        _a.sent();
                        return [7 /*endfinally*/];
                    case 9: return [2 /*return*/];
                }
            });
        });
    };
    /**
     * Map AI verdict to risk level
     */
    TTYSecurity.prototype.mapVerdictToRisk = function (verdict) {
        switch (verdict) {
            case 'ALLOW':
                return 'SAFE';
            case 'WARN':
                return 'CAUTION';
            case 'BLOCK':
                return 'CRITICAL';
            default:
                return 'CAUTION';
        }
    };
    /**
     * Display AI-enhanced warning
     */
    TTYSecurity.prototype.displayAIWarning = function (command, args, analysis, options) {
        return __awaiter(this, void 0, void 0, function () {
            var write, riskEmoji;
            var _this = this;
            return __generator(this, function (_a) {
                if (!this.ttyWriteStream)
                    return [2 /*return*/];
                write = function (text) {
                    _this.ttyWriteStream.write(text);
                };
                write('\n');
                write('╔════════════════════════════════════════════════════════╗\n');
                write('║           🤖 AI Security Analysis Complete             ║\n');
                write('╚════════════════════════════════════════════════════════╝\n\n');
                riskEmoji = {
                    'CRITICAL': '🚫',
                    'HIGH': '⚠️ ',
                    'CAUTION': '⚡',
                    'SAFE': '✅'
                }[options.riskLevel || 'CAUTION'];
                write("".concat(riskEmoji, " Risk Level: ").concat(options.riskLevel, "\n"));
                write("\uD83D\uDCCA Confidence: ".concat(Math.round(analysis.confidence * 100), "%\n\n"));
                write("Command: ".concat(command, " ").concat(args.join(' '), "\n"));
                write("Working directory: ".concat(process.cwd(), "\n\n"));
                // AI Explanation
                write('🔍 Analysis:\n');
                write("   ".concat(analysis.explanation, "\n\n"));
                // Risks identified
                if (analysis.risks && analysis.risks.length > 0) {
                    write('⚠️  Identified Risks:\n');
                    analysis.risks.forEach(function (risk, i) {
                        write("   ".concat(i + 1, ". ").concat(risk, "\n"));
                    });
                    write('\n');
                }
                // Safer alternatives
                if (analysis.alternatives && analysis.alternatives.length > 0) {
                    write('💡 Safer Alternatives:\n');
                    analysis.alternatives.forEach(function (alt, i) {
                        write("   ".concat(i + 1, ". ").concat(alt, "\n"));
                    });
                    write('\n');
                }
                write('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n');
                return [2 /*return*/];
            });
        });
    };
    return TTYSecurity;
}());
exports.TTYSecurity = TTYSecurity;
