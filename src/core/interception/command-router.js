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
exports.CommandRouter = void 0;
var CommandRouter = /** @class */ (function () {
    function CommandRouter() {
        // Initialize safe commands (read-only operations)
        this.safeCommands = new Set([
            'ls', 'pwd', 'echo', 'date', 'whoami', 'hostname',
            'cat', 'less', 'more', 'head', 'tail', 'grep',
            'wc', 'sort', 'uniq', 'find', 'which', 'whereis',
            'ps', 'top', 'df', 'du', 'free', 'uptime',
            'git status', 'git log', 'git diff', 'git branch',
            'npm list', 'yarn list', 'python --version',
            'node --version', 'java -version',
        ]);
        // Commands that are always dangerous
        this.alwaysDangerousCommands = new Set([
            'rm', 'rmdir', 'dd', 'mkfs', 'format',
            'chmod', 'chown', 'sudo', 'su', 'doas',
            'kill', 'killall', 'pkill', 'shutdown', 'reboot',
            'systemctl', 'service', 'iptables', 'firewall-cmd',
        ]);
        // Shell builtin commands
        this.builtinCommands = new Set([
            'cd', 'export', 'unset', 'set', 'alias', 'unalias',
            'source', '.', 'eval', 'exec', 'exit', 'return',
            'break', 'continue', 'shift', 'trap', 'wait',
            'bg', 'fg', 'jobs', 'disown', 'suspend',
            'type', 'hash', 'help', 'history', 'fc',
            'read', 'printf', 'test', '[', '[[',
            'true', 'false', ':', 'declare', 'typeset',
            'local', 'readonly', 'unset', 'let',
        ]);
    }
    /**
     * Route command for processing
     */
    CommandRouter.prototype.route = function (command, args, context) {
        return __awaiter(this, void 0, void 0, function () {
            var cmdInfo;
            return __generator(this, function (_a) {
                cmdInfo = this.parseCommand(command, args);
                // Check if it's a shell builtin
                if (this.isBuiltin(cmdInfo.command)) {
                    return [2 /*return*/, {
                            direct: false,
                            requiresAnalysis: true,
                            requiresApproval: true,
                            isBuiltin: true,
                            requiresShell: true,
                            routed: 'builtin',
                            reason: 'Shell builtin command requires special handling',
                        }];
                }
                // Check for command chains or pipes
                if (cmdInfo.isChain || cmdInfo.isPipe) {
                    return [2 /*return*/, {
                            direct: false,
                            requiresAnalysis: true,
                            requiresApproval: true,
                            isBuiltin: false,
                            requiresShell: true,
                            routed: 'complex',
                            reason: 'Command chain or pipe requires analysis',
                        }];
                }
                // Check if always dangerous
                if (this.isAlwaysDangerous(cmdInfo.command)) {
                    return [2 /*return*/, {
                            direct: false,
                            requiresAnalysis: true,
                            requiresApproval: true,
                            isBuiltin: false,
                            requiresShell: false,
                            routed: 'dangerous',
                            reason: 'Command is inherently dangerous',
                        }];
                }
                // Check if it's sudo
                if (command === 'sudo' || context.sudo) {
                    return [2 /*return*/, {
                            direct: false,
                            requiresAnalysis: true,
                            requiresApproval: true,
                            isBuiltin: false,
                            requiresShell: false,
                            routed: 'sudo',
                            reason: 'All sudo commands require approval',
                        }];
                }
                // Check if safe command
                if (this.isSafeCommand(cmdInfo.command, cmdInfo.args)) {
                    return [2 /*return*/, {
                            direct: true,
                            requiresAnalysis: false,
                            requiresApproval: false,
                            isBuiltin: false,
                            requiresShell: false,
                            routed: 'safe',
                            reason: 'Command is known to be safe',
                        }];
                }
                // Default: analyze unknown commands
                return [2 /*return*/, {
                        direct: false,
                        requiresAnalysis: true,
                        requiresApproval: true,
                        isBuiltin: false,
                        requiresShell: false,
                        routed: 'unknown',
                        reason: 'Unknown command requires analysis',
                    }];
            });
        });
    };
    /**
     * Parse command to extract information
     */
    CommandRouter.prototype.parseCommand = function (command, args) {
        var fullCommand = "".concat(command, " ").concat(args.join(' '));
        // Check for command chains (&&, ||, ;)
        var chainPattern = /(\s*&&\s*|\s*\|\|\s*|\s*;\s*)/;
        var isChain = args.some(function (arg) { return chainPattern.test(arg); });
        // Check for pipes
        var isPipe = args.includes('|');
        // Extract chain/pipe commands if present
        var chainCommands = [];
        var pipeCommands = [];
        if (isChain) {
            chainCommands = fullCommand.split(chainPattern)
                .filter(function (_, i) { return i % 2 === 0; }) // Skip operators
                .map(function (cmd) { return cmd.trim(); });
        }
        if (isPipe) {
            pipeCommands = fullCommand.split('|').map(function (cmd) { return cmd.trim(); });
        }
        // Check for other shell features
        var hasRedirection = args.some(function (arg) {
            return /^(<|>|>>|<<|<&|>&|&>|&>>)/.test(arg);
        });
        var hasGlobbing = args.some(function (arg) {
            return /[\*\?\[\]]/.test(arg);
        });
        var hasVariables = args.some(function (arg) {
            return /\$[A-Za-z_]|\${[A-Za-z_]/.test(arg);
        });
        return {
            command: command,
            args: args,
            fullCommand: fullCommand,
            isChain: isChain,
            isPipe: isPipe,
            chainCommands: chainCommands,
            pipeCommands: pipeCommands,
            hasRedirection: hasRedirection,
            hasGlobbing: hasGlobbing,
            hasVariables: hasVariables,
        };
    };
    /**
     * Check if command is a shell builtin
     */
    CommandRouter.prototype.isBuiltin = function (command) {
        return this.builtinCommands.has(command);
    };
    /**
     * Check if command is always dangerous
     */
    CommandRouter.prototype.isAlwaysDangerous = function (command) {
        return this.alwaysDangerousCommands.has(command);
    };
    /**
     * Check if command is safe
     */
    CommandRouter.prototype.isSafeCommand = function (command, args) {
        // Check exact command
        if (this.safeCommands.has(command)) {
            // Additional checks for safe commands with dangerous args
            if (command === 'find') {
                // find with -exec is dangerous
                if (args.includes('-exec') || args.includes('-execdir')) {
                    return false;
                }
            }
            if (command === 'git') {
                // Only certain git commands are safe
                var gitCmd = args[0];
                var safeGitCommands = ['status', 'log', 'diff', 'branch', 'show'];
                if (!gitCmd || !safeGitCommands.includes(gitCmd)) {
                    return false;
                }
            }
            return true;
        }
        // Check command with primary argument
        var cmdWithArg = "".concat(command, " ").concat(args[0] || '').trim();
        if (this.safeCommands.has(cmdWithArg)) {
            return true;
        }
        return false;
    };
    /**
     * Add custom safe command
     */
    CommandRouter.prototype.addSafeCommand = function (command) {
        this.safeCommands.add(command);
    };
    /**
     * Add custom dangerous command
     */
    CommandRouter.prototype.addDangerousCommand = function (command) {
        this.alwaysDangerousCommands.add(command);
    };
    /**
     * Remove from safe commands
     */
    CommandRouter.prototype.removeSafeCommand = function (command) {
        this.safeCommands.delete(command);
    };
    /**
     * Get routing statistics
     */
    CommandRouter.prototype.getStats = function () {
        return {
            safe: this.safeCommands.size,
            dangerous: this.alwaysDangerousCommands.size,
            builtins: this.builtinCommands.size,
        };
    };
    return CommandRouter;
}());
exports.CommandRouter = CommandRouter;
