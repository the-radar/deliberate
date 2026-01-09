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
exports.CommandClassifier = void 0;
var fs = require("fs/promises");
var CommandClassifier = /** @class */ (function () {
    function CommandClassifier() {
        this.userRules = {
            safeList: [],
            dangerList: [],
            patterns: {
                safe: [],
                danger: [],
            },
        };
        this.cache = new Map();
        // Built-in dangerous patterns
        this.dangerousPatterns = [
            { pattern: /rm\s+-rf\s+\//, risk: 'CRITICAL', description: 'Recursive force remove from root' },
            { pattern: /dd\s+.*of=\/dev\/[sh]d/, risk: 'CRITICAL', description: 'Direct disk write' },
            { pattern: />\s*\/dev\/[sh]d/, risk: 'CRITICAL', description: 'Redirect to disk device' },
            { pattern: /chmod\s+777/, risk: 'HIGH', description: 'World-writable permissions' },
            { pattern: /curl.*\|\s*bash/, risk: 'CRITICAL', description: 'Remote script execution' },
            { pattern: /wget.*\|\s*sh/, risk: 'CRITICAL', description: 'Remote script execution' },
            { pattern: /:\(\)\s*\{.*\|\s*:\s*&\s*\};/, risk: 'CRITICAL', description: 'Fork bomb' },
        ];
        // Safe commands by default
        this.safeCommands = new Set([
            'ls', 'pwd', 'echo', 'date', 'whoami', 'hostname',
            'cat', 'less', 'more', 'head', 'tail', 'grep',
            'wc', 'sort', 'uniq', 'which', 'whereis',
            'ps', 'top', 'df', 'du', 'free', 'uptime',
            'man', 'help', 'info', 'type', 'file',
        ]);
        // Always dangerous commands
        this.dangerousCommands = new Set([
            'rm', 'rmdir', 'dd', 'mkfs', 'format',
            'chmod', 'chown', 'kill', 'killall', 'pkill',
            'shutdown', 'reboot', 'halt', 'poweroff',
            'systemctl', 'service', 'iptables', 'firewall-cmd',
        ]);
    }
    /**
     * Classify a command based on risk
     */
    CommandClassifier.prototype.classify = function (command_1) {
        return __awaiter(this, arguments, void 0, function (command, args, context) {
            var fullCommand, cached, result_1, userOverride, _i, _a, _b, pattern, risk, description, result_2, result_3, result_4, result_5, result_6, result;
            if (args === void 0) { args = []; }
            return __generator(this, function (_c) {
                switch (_c.label) {
                    case 0:
                        fullCommand = "".concat(command, " ").concat(args.join(' ')).trim();
                        cached = this.cache.get(fullCommand);
                        if (cached) {
                            return [2 /*return*/, __assign(__assign({}, cached), { cached: true })];
                        }
                        // Check if it's sudo
                        if (command === 'sudo' || (context === null || context === void 0 ? void 0 : context.sudo)) {
                            result_1 = {
                                command: fullCommand,
                                riskLevel: 'HIGH',
                                category: 'sudo',
                                isDangerous: true,
                                requiresApproval: true,
                                isSudo: true,
                                reason: 'All sudo commands require approval',
                            };
                            this.cache.set(fullCommand, result_1);
                            return [2 /*return*/, result_1];
                        }
                        return [4 /*yield*/, this.checkUserRules(command, fullCommand)];
                    case 1:
                        userOverride = _c.sent();
                        if (userOverride) {
                            this.cache.set(fullCommand, userOverride);
                            return [2 /*return*/, userOverride];
                        }
                        // Check for dangerous patterns
                        for (_i = 0, _a = this.dangerousPatterns; _i < _a.length; _i++) {
                            _b = _a[_i], pattern = _b.pattern, risk = _b.risk, description = _b.description;
                            if (pattern.test(fullCommand)) {
                                result_2 = {
                                    command: fullCommand,
                                    riskLevel: risk,
                                    category: 'pattern_match',
                                    isDangerous: true,
                                    requiresApproval: true,
                                    risks: [description],
                                    reason: "Matched dangerous pattern: ".concat(description),
                                };
                                this.cache.set(fullCommand, result_2);
                                return [2 /*return*/, result_2];
                            }
                        }
                        if (!args.some(function (arg) { return arg.includes('&&') || arg.includes('||') || arg.includes(';'); })) return [3 /*break*/, 3];
                        return [4 /*yield*/, this.classifyChain(fullCommand)];
                    case 2:
                        result_3 = _c.sent();
                        this.cache.set(fullCommand, result_3);
                        return [2 /*return*/, result_3];
                    case 3:
                        if (!args.includes('|')) return [3 /*break*/, 5];
                        return [4 /*yield*/, this.classifyPipe(fullCommand)];
                    case 4:
                        result_4 = _c.sent();
                        this.cache.set(fullCommand, result_4);
                        return [2 /*return*/, result_4];
                    case 5:
                        // Check if it's a known dangerous command
                        if (this.dangerousCommands.has(command)) {
                            result_5 = this.classifyDangerousCommand(command, args, fullCommand);
                            this.cache.set(fullCommand, result_5);
                            return [2 /*return*/, result_5];
                        }
                        // Check if it's a known safe command
                        if (this.safeCommands.has(command)) {
                            result_6 = this.classifySafeCommand(command, args, fullCommand);
                            this.cache.set(fullCommand, result_6);
                            return [2 /*return*/, result_6];
                        }
                        result = {
                            command: fullCommand,
                            riskLevel: 'UNKNOWN',
                            category: 'unknown',
                            isDangerous: null,
                            requiresApproval: true,
                            requiresAnalysis: true,
                            reason: 'Unknown command requires analysis',
                        };
                        this.cache.set(fullCommand, result);
                        return [2 /*return*/, result];
                }
            });
        });
    };
    /**
     * Get risk level for a command
     */
    CommandClassifier.prototype.getRiskLevel = function (command, args) {
        return __awaiter(this, void 0, void 0, function () {
            var classification;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, this.classify(command, args)];
                    case 1:
                        classification = _a.sent();
                        return [2 /*return*/, classification.riskLevel];
                }
            });
        });
    };
    /**
     * Analyze command with context
     */
    CommandClassifier.prototype.analyzeContext = function (command, context) {
        return __awaiter(this, void 0, void 0, function () {
            var classification, adjustedRisk, description;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, this.classify(command, [], context)];
                    case 1:
                        classification = _a.sent();
                        adjustedRisk = classification.riskLevel;
                        description = classification.reason || '';
                        // Example: rm in home directory vs system directory
                        if (command.startsWith('rm ') && context.cwd) {
                            if (context.cwd === '/' || context.cwd.startsWith('/etc') || context.cwd.startsWith('/usr')) {
                                adjustedRisk = 'CRITICAL';
                                description = 'Dangerous operation in system directory';
                            }
                            else if (context.cwd.startsWith('/tmp')) {
                                adjustedRisk = 'CAUTION';
                                description = 'Operation in temporary directory';
                            }
                        }
                        return [2 /*return*/, __assign(__assign({}, classification), { riskLevel: adjustedRisk, reason: description, context: context })];
                }
            });
        });
    };
    /**
     * Check user-defined rules
     */
    CommandClassifier.prototype.checkUserRules = function (command, fullCommand) {
        return __awaiter(this, void 0, void 0, function () {
            var _i, _a, pattern, _b, _c, pattern;
            return __generator(this, function (_d) {
                // Check danger list first (takes precedence)
                if (this.userRules.dangerList.includes(command)) {
                    return [2 /*return*/, {
                            command: fullCommand,
                            riskLevel: 'HIGH',
                            category: 'user_defined',
                            isDangerous: true,
                            requiresApproval: true,
                            source: 'user-defined',
                            reason: 'Command is in user danger list',
                        }];
                }
                // Check safe list
                if (this.userRules.safeList.includes(command)) {
                    return [2 /*return*/, {
                            command: fullCommand,
                            riskLevel: 'SAFE',
                            category: 'user_defined',
                            isDangerous: false,
                            requiresApproval: false,
                            source: 'user-defined',
                            reason: 'Command is in user safe list',
                        }];
                }
                // Check patterns
                if (this.userRules.patterns) {
                    // Check danger patterns
                    for (_i = 0, _a = this.userRules.patterns.danger || []; _i < _a.length; _i++) {
                        pattern = _a[_i];
                        if (new RegExp(pattern).test(fullCommand)) {
                            return [2 /*return*/, {
                                    command: fullCommand,
                                    riskLevel: 'HIGH',
                                    category: 'user_pattern',
                                    isDangerous: true,
                                    requiresApproval: true,
                                    source: 'user-defined',
                                    reason: 'Matched user danger pattern',
                                }];
                        }
                    }
                    // Check safe patterns
                    for (_b = 0, _c = this.userRules.patterns.safe || []; _b < _c.length; _b++) {
                        pattern = _c[_b];
                        if (new RegExp(pattern).test(fullCommand)) {
                            return [2 /*return*/, {
                                    command: fullCommand,
                                    riskLevel: 'SAFE',
                                    category: 'user_pattern',
                                    isDangerous: false,
                                    requiresApproval: false,
                                    source: 'user-defined',
                                    reason: 'Matched user safe pattern',
                                }];
                        }
                    }
                }
                return [2 /*return*/, null];
            });
        });
    };
    /**
     * Classify command chains
     */
    CommandClassifier.prototype.classifyChain = function (fullCommand) {
        return __awaiter(this, void 0, void 0, function () {
            var chainPattern, commands, highestRisk, risks, _i, commands_1, cmd, parts, cmdName, cmdArgs, classification;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        chainPattern = /(\s*&&\s*|\s*\|\|\s*|\s*;\s*)/;
                        commands = fullCommand.split(chainPattern)
                            .filter(function (_, i) { return i % 2 === 0; })
                            .map(function (cmd) { return cmd.trim(); });
                        highestRisk = 'SAFE';
                        risks = [];
                        _i = 0, commands_1 = commands;
                        _a.label = 1;
                    case 1:
                        if (!(_i < commands_1.length)) return [3 /*break*/, 4];
                        cmd = commands_1[_i];
                        parts = cmd.split(/\s+/);
                        cmdName = parts[0] || '';
                        cmdArgs = parts.slice(1);
                        return [4 /*yield*/, this.classify(cmdName, cmdArgs)];
                    case 2:
                        classification = _a.sent();
                        if (this.isHigherRisk(classification.riskLevel, highestRisk)) {
                            highestRisk = classification.riskLevel;
                        }
                        if (classification.risks) {
                            risks.push.apply(risks, classification.risks);
                        }
                        _a.label = 3;
                    case 3:
                        _i++;
                        return [3 /*break*/, 1];
                    case 4: return [2 /*return*/, {
                            command: fullCommand,
                            riskLevel: highestRisk,
                            category: 'chain',
                            isDangerous: highestRisk !== 'SAFE',
                            requiresApproval: highestRisk !== 'SAFE',
                            isChain: true,
                            chainCommands: commands,
                            risks: risks,
                            reason: 'Command chain requires analysis',
                        }];
                }
            });
        });
    };
    /**
     * Classify piped commands
     */
    CommandClassifier.prototype.classifyPipe = function (fullCommand) {
        return __awaiter(this, void 0, void 0, function () {
            var pipeCommands, highestRisk, risks, _i, pipeCommands_1, cmd, parts, cmdName, cmdArgs, classification;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        pipeCommands = fullCommand.split('|').map(function (cmd) { return cmd.trim(); });
                        highestRisk = 'SAFE';
                        risks = [];
                        _i = 0, pipeCommands_1 = pipeCommands;
                        _a.label = 1;
                    case 1:
                        if (!(_i < pipeCommands_1.length)) return [3 /*break*/, 4];
                        cmd = pipeCommands_1[_i];
                        parts = cmd.split(/\s+/);
                        cmdName = parts[0] || '';
                        cmdArgs = parts.slice(1);
                        return [4 /*yield*/, this.classify(cmdName, cmdArgs)];
                    case 2:
                        classification = _a.sent();
                        if (this.isHigherRisk(classification.riskLevel, highestRisk)) {
                            highestRisk = classification.riskLevel;
                        }
                        if (classification.risks) {
                            risks.push.apply(risks, classification.risks);
                        }
                        _a.label = 3;
                    case 3:
                        _i++;
                        return [3 /*break*/, 1];
                    case 4: return [2 /*return*/, {
                            command: fullCommand,
                            riskLevel: highestRisk,
                            category: 'pipe',
                            isDangerous: highestRisk !== 'SAFE',
                            requiresApproval: highestRisk !== 'SAFE',
                            isPipe: true,
                            pipeStages: pipeCommands,
                            risks: risks,
                            reason: 'Pipe command requires analysis',
                        }];
                }
            });
        });
    };
    /**
     * Classify known dangerous command
     */
    CommandClassifier.prototype.classifyDangerousCommand = function (command, args, fullCommand) {
        // Determine risk level based on command and arguments
        var riskLevel = 'HIGH';
        var risks = [];
        if (command === 'rm') {
            if (args.includes('-rf') && (args.includes('/') || args.includes('/*'))) {
                riskLevel = 'CRITICAL';
                risks.push('Recursive force deletion from root');
            }
            else if (args.includes('-rf')) {
                riskLevel = 'HIGH';
                risks.push('Recursive force deletion');
            }
            else {
                riskLevel = 'CAUTION';
                risks.push('File deletion');
            }
        }
        return {
            command: fullCommand,
            riskLevel: riskLevel,
            category: 'system_modification',
            isDangerous: true,
            requiresApproval: true,
            risks: risks,
            reason: "Dangerous command: ".concat(command),
        };
    };
    /**
     * Classify known safe command
     */
    CommandClassifier.prototype.classifySafeCommand = function (command, args, fullCommand) {
        // Some safe commands can be dangerous with certain arguments
        if (command === 'find' && (args.includes('-exec') || args.includes('-execdir'))) {
            return {
                command: fullCommand,
                riskLevel: 'HIGH',
                category: 'conditional_execution',
                isDangerous: true,
                requiresApproval: true,
                risks: ['Command execution through find'],
                reason: 'Find with -exec is dangerous',
            };
        }
        return {
            command: fullCommand,
            riskLevel: 'SAFE',
            category: 'read_only',
            isDangerous: false,
            requiresApproval: false,
            readonly: true,
            reason: 'Safe read-only command',
        };
    };
    /**
     * Compare risk levels
     */
    CommandClassifier.prototype.isHigherRisk = function (risk1, risk2) {
        var riskOrder = ['SAFE', 'CAUTION', 'HIGH', 'CRITICAL', 'UNKNOWN'];
        return riskOrder.indexOf(risk1) > riskOrder.indexOf(risk2);
    };
    /**
     * Load user rules from config
     */
    CommandClassifier.prototype.loadUserRules = function (configPath) {
        return __awaiter(this, void 0, void 0, function () {
            var content, rules, error_1;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        _a.trys.push([0, 2, , 3]);
                        return [4 /*yield*/, fs.readFile(configPath, 'utf-8')];
                    case 1:
                        content = _a.sent();
                        rules = JSON.parse(content);
                        if (rules.safeList) {
                            this.userRules.safeList = rules.safeList;
                        }
                        if (rules.dangerList) {
                            this.userRules.dangerList = rules.dangerList;
                        }
                        if (rules.patterns) {
                            this.userRules.patterns = rules.patterns;
                        }
                        // Clear cache when rules change
                        this.cache.clear();
                        return [3 /*break*/, 3];
                    case 2:
                        error_1 = _a.sent();
                        return [3 /*break*/, 3];
                    case 3: return [2 /*return*/];
                }
            });
        });
    };
    /**
     * Add command to safe list
     */
    CommandClassifier.prototype.addToSafeList = function (command) {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                if (!this.userRules.safeList.includes(command)) {
                    this.userRules.safeList.push(command);
                    this.cache.clear();
                }
                return [2 /*return*/];
            });
        });
    };
    /**
     * Add command to danger list
     */
    CommandClassifier.prototype.addToDangerList = function (command) {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                if (!this.userRules.dangerList.includes(command)) {
                    this.userRules.dangerList.push(command);
                    this.cache.clear();
                }
                return [2 /*return*/];
            });
        });
    };
    /**
     * Get category for a command
     */
    CommandClassifier.prototype.getCategory = function (command) {
        return __awaiter(this, void 0, void 0, function () {
            var classification;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, this.classify(command)];
                    case 1:
                        classification = _a.sent();
                        return [2 /*return*/, classification.category];
                }
            });
        });
    };
    return CommandClassifier;
}());
exports.CommandClassifier = CommandClassifier;
