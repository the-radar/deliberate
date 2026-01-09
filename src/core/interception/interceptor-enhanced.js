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
exports.EnhancedCommandInterceptor = void 0;
var child_process_1 = require("child_process");
var path = require("path");
var classifier_1 = require("../classification/classifier");
var tty_security_1 = require("../security/tty-security");
var bypass_prevention_1 = require("../security/bypass-prevention");
var redactor_1 = require("../redaction/redactor");
var command_router_1 = require("./command-router");
var analysis_orchestrator_1 = require("../../llm/analysis-orchestrator");
var agent_handler_1 = require("../../ai/agent-handler");
var builtin_handler_1 = require("../commands/builtin-handler");
var logger_1 = require("../../utils/logger");
var EnhancedCommandInterceptor = /** @class */ (function () {
    function EnhancedCommandInterceptor() {
        this.aiEnabled = true;
        this.classifier = new classifier_1.CommandClassifier();
        this.ttySecurity = new tty_security_1.TTYSecurity();
        this.bypassPrevention = new bypass_prevention_1.BypassPrevention();
        this.redactor = new redactor_1.SensitiveDataRedactor();
        this.router = new command_router_1.CommandRouter();
        this.analysisOrchestrator = new analysis_orchestrator_1.AnalysisOrchestrator();
        this.agentHandler = new agent_handler_1.AgentCommandHandler();
        this.builtinHandler = new builtin_handler_1.BuiltinCommandHandler();
        this.logger = new logger_1.Logger('interceptor-enhanced');
    }
    /**
     * Initialize AI components
     */
    EnhancedCommandInterceptor.prototype.initialize = function () {
        return __awaiter(this, void 0, void 0, function () {
            var error_1;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        _a.trys.push([0, 2, , 3]);
                        return [4 /*yield*/, this.analysisOrchestrator.initialize()];
                    case 1:
                        _a.sent();
                        this.aiEnabled = true;
                        return [3 /*break*/, 3];
                    case 2:
                        error_1 = _a.sent();
                        this.logger.warn('AI initialization failed, falling back to pattern-based analysis:', error_1);
                        this.aiEnabled = false;
                        return [3 /*break*/, 3];
                    case 3: return [2 /*return*/];
                }
            });
        });
    };
    /**
     * Main interception entry point
     */
    EnhancedCommandInterceptor.prototype.intercept = function (command, args) {
        return __awaiter(this, void 0, void 0, function () {
            var context, builtinResult, redactedCommand, bypassCheck, routing, analysis, analysisContext, error_2, classification, verdict, _a, ttyCheck, authCode, approval, error_3;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        _b.trys.push([0, 23, , 24]);
                        context = this.buildContext(command, args);
                        if (!this.builtinHandler.isBuiltin(command)) return [3 /*break*/, 2];
                        return [4 /*yield*/, this.builtinHandler.handle(command, args)];
                    case 1:
                        builtinResult = _b.sent();
                        if (builtinResult.handled) {
                            if (builtinResult.output) {
                                process.stdout.write(builtinResult.output + '\n');
                            }
                            if (builtinResult.error) {
                                process.stderr.write(builtinResult.error + '\n');
                            }
                            return [2 /*return*/, {
                                    allowed: true,
                                    executed: true,
                                    exitCode: builtinResult.exitCode
                                }];
                        }
                        _b.label = 2;
                    case 2: return [4 /*yield*/, this.redactor.redactCommand("".concat(command, " ").concat(args.join(' ')))];
                    case 3:
                        redactedCommand = _b.sent();
                        this.logger.info("Intercepted: ".concat(redactedCommand));
                        return [4 /*yield*/, this.bypassPrevention.detectBypass(context)];
                    case 4:
                        bypassCheck = _b.sent();
                        if (!(bypassCheck.detected && bypassCheck.confidence > 0.8)) return [3 /*break*/, 6];
                        this.logger.error("Bypass attempt detected: ".concat(bypassCheck.method));
                        return [4 /*yield*/, this.bypassPrevention.logBypassAttempt({
                                timestamp: Date.now(),
                                method: bypassCheck.method || 'unknown',
                                command: redactedCommand,
                                processTree: [],
                                environment: context.env,
                                decision: 'BLOCKED'
                            })];
                    case 5:
                        _b.sent();
                        return [2 /*return*/, {
                                allowed: false,
                                executed: false,
                                reason: "Security violation: ".concat(bypassCheck.details),
                                bypassed: true,
                            }];
                    case 6: return [4 /*yield*/, this.router.route(command, args, context)];
                    case 7:
                        routing = _b.sent();
                        if (!routing.direct) return [3 /*break*/, 9];
                        return [4 /*yield*/, this.executeDirect(command, args, context)];
                    case 8: 
                    // Safe command, execute directly
                    return [2 /*return*/, _b.sent()];
                    case 9:
                        analysis = void 0;
                        if (!this.aiEnabled) return [3 /*break*/, 13];
                        analysisContext = {
                            cwd: context.cwd,
                            user: context.user,
                            platform: process.platform,
                            isSudo: context.sudo
                        };
                        _b.label = 10;
                    case 10:
                        _b.trys.push([10, 12, , 13]);
                        return [4 /*yield*/, this.analysisOrchestrator.analyze(command, args, analysisContext)];
                    case 11:
                        analysis = _b.sent();
                        return [3 /*break*/, 13];
                    case 12:
                        error_2 = _b.sent();
                        this.logger.error('AI analysis failed:', error_2);
                        return [3 /*break*/, 13];
                    case 13:
                        if (!!analysis) return [3 /*break*/, 15];
                        return [4 /*yield*/, this.classifier.classify(command, args, context)];
                    case 14:
                        classification = _b.sent();
                        verdict = classification.requiresApproval ? 'WARN' : 'ALLOW';
                        analysis = {
                            verdict: verdict,
                            explanation: classification.reason || 'Command classified by patterns',
                            risks: [],
                            confidence: 0.7
                        };
                        _b.label = 15;
                    case 15:
                        _a = analysis.verdict;
                        switch (_a) {
                            case 'BLOCK': return [3 /*break*/, 16];
                            case 'WARN': return [3 /*break*/, 17];
                            case 'ALLOW': return [3 /*break*/, 20];
                        }
                        return [3 /*break*/, 21];
                    case 16: return [2 /*return*/, {
                            allowed: false,
                            executed: false,
                            reason: analysis.explanation,
                            analysis: analysis
                        }];
                    case 17: return [4 /*yield*/, this.ttySecurity.checkTTY()];
                    case 18:
                        ttyCheck = _b.sent();
                        if (!ttyCheck.isRealTTY) {
                            authCode = this.agentHandler.generateCodeForAgent(command, args, analysis);
                            return [2 /*return*/, {
                                    allowed: false,
                                    executed: false,
                                    reason: 'TTY required for approval. Auth code generated for AI agent use.',
                                    authCode: authCode,
                                    analysis: analysis
                                }];
                        }
                        return [4 /*yield*/, this.ttySecurity.getApprovalWithAnalysis(command, args, analysis)];
                    case 19:
                        approval = _b.sent();
                        if (!approval.approved) {
                            return [2 /*return*/, {
                                    allowed: false,
                                    executed: false,
                                    reason: approval.reason || 'User denied execution',
                                    analysis: analysis
                                }];
                        }
                        return [3 /*break*/, 21];
                    case 20: 
                    // Command is safe, proceed with execution
                    return [3 /*break*/, 21];
                    case 21: return [4 /*yield*/, this.executeCommand(command, args, context)];
                    case 22: 
                    // Execute the command
                    return [2 /*return*/, _b.sent()];
                    case 23:
                        error_3 = _b.sent();
                        this.logger.error('Interception error:', error_3);
                        // On error, default to safe behavior (block)
                        return [2 /*return*/, {
                                allowed: false,
                                executed: false,
                                reason: "Interception error: ".concat(error_3 instanceof Error ? error_3.message : String(error_3)),
                            }];
                    case 24: return [2 /*return*/];
                }
            });
        });
    };
    /**
     * Build execution context
     */
    EnhancedCommandInterceptor.prototype.buildContext = function (command, args) {
        return {
            command: command,
            args: args,
            env: process.env,
            cwd: process.cwd(),
            user: process.env.USER || 'unknown',
            timestamp: Date.now(),
            sudo: this.isSudoCommand(command, args),
            shell: process.env.SHELL,
            terminal: process.env.TERM,
            parentPid: process.ppid,
        };
    };
    /**
     * Check if command involves sudo
     */
    EnhancedCommandInterceptor.prototype.isSudoCommand = function (command, _args) {
        if (command === 'sudo') {
            return true;
        }
        // Check if we're running under sudo
        if (process.env.SUDO_USER || process.env.SUDO_COMMAND) {
            return true;
        }
        // Check for doas or other privilege escalation
        if (command === 'doas' || command === 'su') {
            return true;
        }
        return false;
    };
    /**
     * Execute safe command directly
     */
    EnhancedCommandInterceptor.prototype.executeDirect = function (command, args, context) {
        return __awaiter(this, void 0, void 0, function () {
            var realCommand, child_1, exitCode, error_4;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        _a.trys.push([0, 3, , 4]);
                        return [4 /*yield*/, this.findRealCommand(command)];
                    case 1:
                        realCommand = _a.sent();
                        child_1 = (0, child_process_1.spawn)(realCommand, args, {
                            stdio: 'inherit',
                            env: this.cleanEnvironment(context.env),
                            cwd: context.cwd,
                        });
                        return [4 /*yield*/, new Promise(function (resolve) {
                                child_1.on('exit', function (code) { return resolve(code || 0); });
                            })];
                    case 2:
                        exitCode = _a.sent();
                        return [2 /*return*/, {
                                allowed: true,
                                executed: true,
                                exitCode: exitCode,
                            }];
                    case 3:
                        error_4 = _a.sent();
                        return [2 /*return*/, {
                                allowed: false,
                                executed: false,
                                reason: "Execution failed: ".concat(error_4),
                            }];
                    case 4: return [2 /*return*/];
                }
            });
        });
    };
    /**
     * Execute command after approval
     */
    EnhancedCommandInterceptor.prototype.executeCommand = function (command, args, context) {
        return __awaiter(this, void 0, void 0, function () {
            var realCommand, cleanEnv, child_2, exitCode, error_5;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        _a.trys.push([0, 3, , 4]);
                        return [4 /*yield*/, this.findRealCommand(command)];
                    case 1:
                        realCommand = _a.sent();
                        cleanEnv = this.cleanEnvironment(context.env);
                        child_2 = (0, child_process_1.spawn)(realCommand, args, {
                            stdio: 'inherit',
                            env: cleanEnv,
                            cwd: context.cwd,
                        });
                        return [4 /*yield*/, new Promise(function (resolve, reject) {
                                child_2.on('exit', function (code) { return resolve(code || 0); });
                                child_2.on('error', function (err) { return reject(err); });
                            })];
                    case 2:
                        exitCode = _a.sent();
                        return [2 /*return*/, {
                                allowed: true,
                                executed: true,
                                exitCode: exitCode,
                            }];
                    case 3:
                        error_5 = _a.sent();
                        return [2 /*return*/, {
                                allowed: true,
                                executed: false,
                                reason: "Execution failed: ".concat(error_5),
                            }];
                    case 4: return [2 /*return*/];
                }
            });
        });
    };
    /**
     * Find the real command path (not our shim)
     */
    EnhancedCommandInterceptor.prototype.findRealCommand = function (command) {
        return __awaiter(this, void 0, void 0, function () {
            var shimDir, originalPath, pathDirs, _i, pathDirs_1, dir, cmdPath, access, _a;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        // If absolute path, use it directly
                        if (path.isAbsolute(command)) {
                            return [2 /*return*/, command];
                        }
                        shimDir = process.env.DELIBERATE_SHIM_PATH || '';
                        originalPath = process.env.PATH || '';
                        pathDirs = originalPath.split(':').filter(function (dir) { return dir !== shimDir; });
                        _i = 0, pathDirs_1 = pathDirs;
                        _b.label = 1;
                    case 1:
                        if (!(_i < pathDirs_1.length)) return [3 /*break*/, 7];
                        dir = pathDirs_1[_i];
                        cmdPath = path.join(dir, command);
                        _b.label = 2;
                    case 2:
                        _b.trys.push([2, 5, , 6]);
                        return [4 /*yield*/, Promise.resolve().then(function () { return require('fs/promises'); })];
                    case 3:
                        access = (_b.sent()).access;
                        return [4 /*yield*/, access(cmdPath, 73)];
                    case 4:
                        _b.sent(); // Check if executable
                        return [2 /*return*/, cmdPath];
                    case 5:
                        _a = _b.sent();
                        return [3 /*break*/, 6];
                    case 6:
                        _i++;
                        return [3 /*break*/, 1];
                    case 7: 
                    // Fallback to command as-is
                    return [2 /*return*/, command];
                }
            });
        });
    };
    /**
     * Clean environment variables to prevent injection
     */
    EnhancedCommandInterceptor.prototype.cleanEnvironment = function (env) {
        var cleaned = __assign({}, env);
        // Remove deliberate-specific variables
        delete cleaned.DELIBERATE_INTERCEPTING;
        delete cleaned.DELIBERATE_ORIGINAL_CMD;
        // Remove potentially dangerous variables
        delete cleaned.LD_PRELOAD;
        delete cleaned.LD_LIBRARY_PATH;
        delete cleaned.DYLD_INSERT_LIBRARIES;
        delete cleaned.DYLD_LIBRARY_PATH;
        return cleaned;
    };
    /**
     * Handle agent execution request
     */
    EnhancedCommandInterceptor.prototype.handleAgentExecution = function (authCode, agentId) {
        return __awaiter(this, void 0, void 0, function () {
            var result;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, this.agentHandler.executeWithAuth({
                            authCode: authCode,
                            agentId: agentId
                        })];
                    case 1:
                        result = _a.sent();
                        return [2 /*return*/, {
                                allowed: result.success,
                                executed: result.success,
                                exitCode: result.exitCode,
                                reason: result.error
                            }];
                }
            });
        });
    };
    /**
     * Shutdown AI components
     */
    EnhancedCommandInterceptor.prototype.shutdown = function () {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, this.analysisOrchestrator.shutdown()];
                    case 1:
                        _a.sent();
                        return [2 /*return*/];
                }
            });
        });
    };
    return EnhancedCommandInterceptor;
}());
exports.EnhancedCommandInterceptor = EnhancedCommandInterceptor;
