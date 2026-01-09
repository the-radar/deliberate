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
exports.CommandInterceptor = void 0;
var child_process_1 = require("child_process");
var path = require("path");
var classifier_1 = require("../classification/classifier");
var tty_security_1 = require("../security/tty-security");
var bypass_prevention_1 = require("../security/bypass-prevention");
var redactor_1 = require("../redaction/redactor");
var command_router_1 = require("./command-router");
var CommandInterceptor = /** @class */ (function () {
    function CommandInterceptor() {
        this.classifier = new classifier_1.CommandClassifier();
        this.ttySecurity = new tty_security_1.TTYSecurity();
        this.bypassPrevention = new bypass_prevention_1.BypassPrevention();
        this.redactor = new redactor_1.SensitiveDataRedactor();
        this.router = new command_router_1.CommandRouter();
    }
    /**
     * Main interception entry point
     */
    CommandInterceptor.prototype.intercept = function (command, args) {
        return __awaiter(this, void 0, void 0, function () {
            var context, redactedCommand, bypassCheck, routing, classification, ttyCheck, approval, error_1;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        _a.trys.push([0, 11, , 12]);
                        context = this.buildContext(command, args);
                        return [4 /*yield*/, this.redactor.redactCommand("".concat(command, " ").concat(args.join(' ')))];
                    case 1:
                        redactedCommand = _a.sent();
                        console.error("[Deliberate] Intercepted: ".concat(redactedCommand));
                        return [4 /*yield*/, this.bypassPrevention.detectBypass(context)];
                    case 2:
                        bypassCheck = _a.sent();
                        if (bypassCheck.detected) {
                            console.error("[Deliberate] Bypass attempt detected: ".concat(bypassCheck.method));
                            return [2 /*return*/, {
                                    allowed: false,
                                    executed: false,
                                    reason: "Bypass attempt detected: ".concat(bypassCheck.method),
                                    bypassed: true,
                                }];
                        }
                        return [4 /*yield*/, this.router.route(command, args, context)];
                    case 3:
                        routing = _a.sent();
                        if (!routing.direct) return [3 /*break*/, 5];
                        return [4 /*yield*/, this.executeDirect(command, args, context)];
                    case 4: 
                    // Safe command, execute directly
                    return [2 /*return*/, _a.sent()];
                    case 5: return [4 /*yield*/, this.classifier.classify(command, args, context)];
                    case 6:
                        classification = _a.sent();
                        if (!classification.requiresApproval) return [3 /*break*/, 9];
                        return [4 /*yield*/, this.ttySecurity.checkTTY()];
                    case 7:
                        ttyCheck = _a.sent();
                        if (!ttyCheck.isRealTTY) {
                            return [2 /*return*/, {
                                    allowed: false,
                                    executed: false,
                                    reason: 'TTY required for approval',
                                }];
                        }
                        return [4 /*yield*/, this.ttySecurity.getApproval(command, args, classification)];
                    case 8:
                        approval = _a.sent();
                        if (!approval.approved) {
                            return [2 /*return*/, {
                                    allowed: false,
                                    executed: false,
                                    reason: approval.reason || 'User denied execution',
                                }];
                        }
                        _a.label = 9;
                    case 9: return [4 /*yield*/, this.executeCommand(command, args, context)];
                    case 10: 
                    // Execute the command
                    return [2 /*return*/, _a.sent()];
                    case 11:
                        error_1 = _a.sent();
                        console.error('[Deliberate] Interception error:', error_1);
                        // On error, default to safe behavior (block)
                        return [2 /*return*/, {
                                allowed: false,
                                executed: false,
                                reason: "Interception error: ".concat(error_1 instanceof Error ? error_1.message : String(error_1)),
                            }];
                    case 12: return [2 /*return*/];
                }
            });
        });
    };
    /**
     * Build execution context
     */
    CommandInterceptor.prototype.buildContext = function (command, args) {
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
    CommandInterceptor.prototype.isSudoCommand = function (command, _args) {
        if (command === 'sudo') {
            return true;
        }
        // Check for sudo environment variables
        if (process.env.SUDO_USER || process.env.SUDO_COMMAND) {
            return true;
        }
        return false;
    };
    /**
     * Execute safe command directly
     */
    CommandInterceptor.prototype.executeDirect = function (command, args, context) {
        return __awaiter(this, void 0, void 0, function () {
            var realCommand, child_1, exitCode, error_2;
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
                        error_2 = _a.sent();
                        return [2 /*return*/, {
                                allowed: false,
                                executed: false,
                                reason: "Execution failed: ".concat(error_2),
                            }];
                    case 4: return [2 /*return*/];
                }
            });
        });
    };
    /**
     * Execute command after approval
     */
    CommandInterceptor.prototype.executeCommand = function (command, args, context) {
        return __awaiter(this, void 0, void 0, function () {
            var realCommand, cleanEnv, child_2, exitCode, error_3;
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
                        error_3 = _a.sent();
                        return [2 /*return*/, {
                                allowed: true,
                                executed: false,
                                reason: "Execution failed: ".concat(error_3),
                            }];
                    case 4: return [2 /*return*/];
                }
            });
        });
    };
    /**
     * Find the real command path (not our shim)
     */
    CommandInterceptor.prototype.findRealCommand = function (command) {
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
    CommandInterceptor.prototype.cleanEnvironment = function (env) {
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
    return CommandInterceptor;
}());
exports.CommandInterceptor = CommandInterceptor;
