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
exports.BuiltinCommandHandler = void 0;
var path = require("path");
var fs = require("fs/promises");
var BuiltinCommandHandler = /** @class */ (function () {
    function BuiltinCommandHandler() {
        this.commands = new Map();
        this.registerBuiltins();
    }
    /**
     * Check if command is a shell builtin
     */
    BuiltinCommandHandler.prototype.isBuiltin = function (command) {
        return this.commands.has(command) || this.isShellBuiltin(command);
    };
    /**
     * Handle builtin command
     */
    BuiltinCommandHandler.prototype.handle = function (command, args) {
        return __awaiter(this, void 0, void 0, function () {
            var builtin, error_1;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        builtin = this.commands.get(command);
                        if (!builtin) return [3 /*break*/, 4];
                        _a.label = 1;
                    case 1:
                        _a.trys.push([1, 3, , 4]);
                        return [4 /*yield*/, builtin.handler(args)];
                    case 2: return [2 /*return*/, _a.sent()];
                    case 3:
                        error_1 = _a.sent();
                        return [2 /*return*/, {
                                handled: true,
                                error: error_1 instanceof Error ? error_1.message : 'Unknown error',
                                exitCode: 1
                            }];
                    case 4:
                        // Handle shell builtins
                        if (this.isShellBuiltin(command)) {
                            return [2 /*return*/, this.handleShellBuiltin(command, args)];
                        }
                        return [2 /*return*/, { handled: false, exitCode: 0 }];
                }
            });
        });
    };
    /**
     * Register custom builtin commands
     */
    BuiltinCommandHandler.prototype.registerBuiltins = function () {
        var _this = this;
        // cd - change directory
        this.commands.set('cd', {
            name: 'cd',
            description: 'Change working directory',
            dangerous: false,
            handler: function (args) { return __awaiter(_this, void 0, void 0, function () {
                var dir, resolvedPath, stats, error_2;
                return __generator(this, function (_a) {
                    switch (_a.label) {
                        case 0:
                            dir = args[0] || process.env.HOME || '/';
                            _a.label = 1;
                        case 1:
                            _a.trys.push([1, 3, , 4]);
                            resolvedPath = path.resolve(dir);
                            return [4 /*yield*/, fs.stat(resolvedPath)];
                        case 2:
                            stats = _a.sent();
                            if (!stats.isDirectory()) {
                                return [2 /*return*/, {
                                        handled: true,
                                        error: "cd: ".concat(dir, ": Not a directory"),
                                        exitCode: 1
                                    }];
                            }
                            // Change directory
                            process.chdir(resolvedPath);
                            return [2 /*return*/, {
                                    handled: true,
                                    output: "Changed directory to: ".concat(resolvedPath),
                                    exitCode: 0
                                }];
                        case 3:
                            error_2 = _a.sent();
                            return [2 /*return*/, {
                                    handled: true,
                                    error: "cd: ".concat(dir, ": No such file or directory"),
                                    exitCode: 1
                                }];
                        case 4: return [2 /*return*/];
                    }
                });
            }); }
        });
        // export - set environment variable
        this.commands.set('export', {
            name: 'export',
            description: 'Set environment variables',
            dangerous: true,
            handler: function (args) { return __awaiter(_this, void 0, void 0, function () {
                var exports_1, _i, args_1, arg, match, name_1, value;
                return __generator(this, function (_a) {
                    if (args.length === 0) {
                        exports_1 = Object.entries(process.env)
                            .map(function (_a) {
                            var key = _a[0], value = _a[1];
                            return "export ".concat(key, "=\"").concat(value, "\"");
                        })
                            .join('\n');
                        return [2 /*return*/, {
                                handled: true,
                                output: exports_1,
                                exitCode: 0
                            }];
                    }
                    // Parse export command
                    for (_i = 0, args_1 = args; _i < args_1.length; _i++) {
                        arg = args_1[_i];
                        match = arg.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
                        if (match) {
                            name_1 = match[1], value = match[2];
                            if (name_1 && value !== undefined) {
                                process.env[name_1] = value.replace(/^["']|["']$/g, '');
                            }
                        }
                    }
                    return [2 /*return*/, {
                            handled: true,
                            exitCode: 0
                        }];
                });
            }); }
        });
        // unset - remove environment variable
        this.commands.set('unset', {
            name: 'unset',
            description: 'Remove environment variables',
            dangerous: true,
            handler: function (args) { return __awaiter(_this, void 0, void 0, function () {
                var _i, args_2, varName;
                return __generator(this, function (_a) {
                    for (_i = 0, args_2 = args; _i < args_2.length; _i++) {
                        varName = args_2[_i];
                        delete process.env[varName];
                    }
                    return [2 /*return*/, {
                            handled: true,
                            exitCode: 0
                        }];
                });
            }); }
        });
        // alias - manage command aliases
        this.commands.set('alias', {
            name: 'alias',
            description: 'Manage command aliases',
            dangerous: false,
            handler: function (args) { return __awaiter(_this, void 0, void 0, function () {
                return __generator(this, function (_a) {
                    // Simple alias listing for now
                    if (args.length === 0) {
                        return [2 /*return*/, {
                                handled: true,
                                output: 'No aliases defined',
                                exitCode: 0
                            }];
                    }
                    return [2 /*return*/, {
                            handled: true,
                            output: 'Alias management not fully implemented',
                            exitCode: 0
                        }];
                });
            }); }
        });
        // history - command history
        this.commands.set('history', {
            name: 'history',
            description: 'Show command history',
            dangerous: false,
            handler: function (_args) { return __awaiter(_this, void 0, void 0, function () {
                return __generator(this, function (_a) {
                    // Would integrate with shell history
                    return [2 /*return*/, {
                            handled: true,
                            output: 'History not available in current context',
                            exitCode: 0
                        }];
                });
            }); }
        });
    };
    /**
     * Check if command is a shell builtin
     */
    BuiltinCommandHandler.prototype.isShellBuiltin = function (command) {
        var shellBuiltins = [
            'cd', 'pwd', 'export', 'unset', 'alias', 'unalias',
            'source', '.', 'eval', 'exec', 'exit', 'return',
            'break', 'continue', 'shift', 'times', 'trap',
            'type', 'hash', 'help', 'history', 'jobs', 'fg', 'bg',
            'wait', 'suspend', 'test', '[', 'command', 'builtin',
            'enable', 'disable', 'local', 'declare', 'typeset',
            'readonly', 'getopts', 'read', 'echo', 'printf',
            'let', 'ulimit', 'umask', 'set', 'shopt'
        ];
        return shellBuiltins.includes(command);
    };
    /**
     * Handle shell builtins that require special treatment
     */
    BuiltinCommandHandler.prototype.handleShellBuiltin = function (command, args) {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                // For most shell builtins, we need to execute them in the shell context
                // This is a simplified handler - full implementation would integrate with shell
                switch (command) {
                    case 'pwd':
                        return [2 /*return*/, {
                                handled: true,
                                output: process.cwd(),
                                exitCode: 0
                            }];
                    case 'echo':
                        return [2 /*return*/, {
                                handled: true,
                                output: args.join(' '),
                                exitCode: 0
                            }];
                    case 'test':
                    case '[':
                        // Basic test implementation
                        return [2 /*return*/, this.handleTest(args)];
                    default:
                        // For other builtins, indicate they need shell execution
                        return [2 /*return*/, {
                                handled: false,
                                exitCode: 0
                            }];
                }
                return [2 /*return*/];
            });
        });
    };
    /**
     * Basic test/[ command implementation
     */
    BuiltinCommandHandler.prototype.handleTest = function (args) {
        return __awaiter(this, void 0, void 0, function () {
            var testArgs, flag, file, stats, _a, left, op, right;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        testArgs = args[args.length - 1] === ']' ? args.slice(0, -1) : args;
                        if (testArgs.length === 0) {
                            return [2 /*return*/, { handled: true, exitCode: 1 }];
                        }
                        if (!(testArgs.length === 2)) return [3 /*break*/, 4];
                        flag = testArgs[0], file = testArgs[1];
                        if (!file) {
                            return [2 /*return*/, { handled: true, exitCode: 1 }];
                        }
                        _b.label = 1;
                    case 1:
                        _b.trys.push([1, 3, , 4]);
                        return [4 /*yield*/, fs.stat(file)];
                    case 2:
                        stats = _b.sent();
                        switch (flag) {
                            case '-e': // exists
                                return [2 /*return*/, { handled: true, exitCode: 0 }];
                            case '-f': // is file
                                return [2 /*return*/, { handled: true, exitCode: stats.isFile() ? 0 : 1 }];
                            case '-d': // is directory
                                return [2 /*return*/, { handled: true, exitCode: stats.isDirectory() ? 0 : 1 }];
                            case '-r': // is readable
                                return [2 /*return*/, { handled: true, exitCode: 0 }]; // Simplified
                            case '-w': // is writable
                                return [2 /*return*/, { handled: true, exitCode: 0 }]; // Simplified
                            case '-x': // is executable
                                return [2 /*return*/, { handled: true, exitCode: 0 }]; // Simplified
                        }
                        return [3 /*break*/, 4];
                    case 3:
                        _a = _b.sent();
                        return [2 /*return*/, { handled: true, exitCode: 1 }];
                    case 4:
                        // String comparisons
                        if (testArgs.length === 3) {
                            left = testArgs[0], op = testArgs[1], right = testArgs[2];
                            switch (op) {
                                case '=':
                                case '==':
                                    return [2 /*return*/, { handled: true, exitCode: left === right ? 0 : 1 }];
                                case '!=':
                                    return [2 /*return*/, { handled: true, exitCode: left !== right ? 0 : 1 }];
                            }
                        }
                        return [2 /*return*/, { handled: true, exitCode: 1 }];
                }
            });
        });
    };
    /**
     * Get list of dangerous builtins
     */
    BuiltinCommandHandler.prototype.getDangerousBuiltins = function () {
        return [
            'eval', 'exec', 'source', '.', 'export',
            'unset', 'set', 'trap', 'enable', 'disable'
        ];
    };
    return BuiltinCommandHandler;
}());
exports.BuiltinCommandHandler = BuiltinCommandHandler;
