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
exports.BypassPrevention = void 0;
var fs = require("fs");
var BypassPrevention = /** @class */ (function () {
    function BypassPrevention() {
        this.suspiciousEnvVars = [
            'DELIBERATE_AUTO_APPROVE',
            'DELIBERATE_BYPASS',
            'DELIBERATE_NO_TTY',
            '_DELIBERATE_TEST_MODE',
            'DELIBERATE_SKIP_CHECKS',
        ];
        this.automationTools = [
            'expect',
            'autoexpect',
            'empty',
            'pty',
            'xdotool',
            'xte',
            'sikuli',
            'python-pty',
            'node-pty',
        ];
    }
    /**
     * Main bypass detection entry point
     */
    BypassPrevention.prototype.detectBypass = function (_context) {
        return __awaiter(this, void 0, void 0, function () {
            var checks, mostSevere, _i, checks_1, check;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, Promise.all([
                            this.checkPipeBypass(),
                            this.checkProcessTree(),
                            this.checkEnvironment(),
                            this.checkFileDescriptors(),
                            this.checkTiming(),
                        ])];
                    case 1:
                        checks = _a.sent();
                        mostSevere = {
                            detected: false,
                            confidence: 0,
                        };
                        for (_i = 0, checks_1 = checks; _i < checks_1.length; _i++) {
                            check = checks_1[_i];
                            if (check.detected && check.confidence > mostSevere.confidence) {
                                mostSevere = check;
                            }
                        }
                        return [2 /*return*/, mostSevere];
                }
            });
        });
    };
    /**
     * Check for pipe-based bypass attempts
     */
    BypassPrevention.prototype.checkPipeBypass = function () {
        return __awaiter(this, void 0, void 0, function () {
            var stdinStat, fdPath, link;
            return __generator(this, function (_a) {
                try {
                    stdinStat = fs.fstatSync(0);
                    // Check if stdin is a pipe
                    if ((stdinStat.mode & fs.constants.S_IFIFO) === fs.constants.S_IFIFO) {
                        return [2 /*return*/, {
                                detected: true,
                                method: 'pipe',
                                confidence: 0.95,
                                details: 'Input is piped (not from TTY)',
                                severity: 'HIGH',
                            }];
                    }
                    // Check if stdin is redirected from file
                    if ((stdinStat.mode & fs.constants.S_IFREG) === fs.constants.S_IFREG) {
                        return [2 /*return*/, {
                                detected: true,
                                method: 'file_redirection',
                                confidence: 0.95,
                                details: 'Input is redirected from file',
                                severity: 'HIGH',
                            }];
                    }
                    fdPath = "/proc/".concat(process.pid, "/fd/0");
                    if (fs.existsSync(fdPath)) {
                        link = fs.readlinkSync(fdPath);
                        if (link.includes('pipe:') || link.includes('/dev/fd/')) {
                            return [2 /*return*/, {
                                    detected: true,
                                    method: 'process_substitution',
                                    confidence: 0.9,
                                    details: 'Process substitution detected',
                                    severity: 'HIGH',
                                }];
                        }
                    }
                }
                catch (_b) {
                    // Unable to check, assume safe
                }
                return [2 /*return*/, { detected: false, confidence: 0 }];
            });
        });
    };
    /**
     * Check process tree for automation tools
     */
    BypassPrevention.prototype.checkProcessTree = function () {
        return __awaiter(this, void 0, void 0, function () {
            var processTree, _i, processTree_1, proc, _a, _b, tool, ptyCheck, _c;
            return __generator(this, function (_d) {
                switch (_d.label) {
                    case 0:
                        _d.trys.push([0, 3, , 4]);
                        return [4 /*yield*/, this.getProcessTree()];
                    case 1:
                        processTree = _d.sent();
                        for (_i = 0, processTree_1 = processTree; _i < processTree_1.length; _i++) {
                            proc = processTree_1[_i];
                            // Check for automation tools
                            for (_a = 0, _b = this.automationTools; _a < _b.length; _a++) {
                                tool = _b[_a];
                                if (proc.cmdline.toLowerCase().includes(tool)) {
                                    return [2 /*return*/, {
                                            detected: true,
                                            method: 'automation_tool',
                                            confidence: 0.9,
                                            details: "Automation tool detected: ".concat(tool),
                                            severity: 'CRITICAL',
                                        }];
                                }
                            }
                            // Check for suspicious interpreters
                            if (proc.cmdline.includes('python -c') ||
                                proc.cmdline.includes('perl -e') ||
                                proc.cmdline.includes('ruby -e')) {
                                return [2 /*return*/, {
                                        detected: true,
                                        method: 'inline_script',
                                        confidence: 0.7,
                                        details: 'Inline script execution detected',
                                        severity: 'MEDIUM',
                                    }];
                            }
                        }
                        return [4 /*yield*/, this.checkPTYManipulation()];
                    case 2:
                        ptyCheck = _d.sent();
                        if (ptyCheck.detected) {
                            return [2 /*return*/, ptyCheck];
                        }
                        return [3 /*break*/, 4];
                    case 3:
                        _c = _d.sent();
                        return [3 /*break*/, 4];
                    case 4: return [2 /*return*/, { detected: false, confidence: 0 }];
                }
            });
        });
    };
    /**
     * Check environment for suspicious variables
     */
    BypassPrevention.prototype.checkEnvironment = function () {
        return __awaiter(this, void 0, void 0, function () {
            var suspicious, _i, _a, envVar;
            return __generator(this, function (_b) {
                suspicious = [];
                // Check for suspicious deliberate-specific vars
                for (_i = 0, _a = this.suspiciousEnvVars; _i < _a.length; _i++) {
                    envVar = _a[_i];
                    if (process.env[envVar]) {
                        suspicious.push(envVar);
                    }
                }
                if (suspicious.length > 0) {
                    return [2 /*return*/, {
                            detected: true,
                            method: 'environment_manipulation',
                            confidence: 0.99,
                            details: "Suspicious environment variables: ".concat(suspicious.join(', ')),
                            severity: 'CRITICAL',
                        }];
                }
                // Check for LD_PRELOAD injection
                if (process.env.LD_PRELOAD || process.env.DYLD_INSERT_LIBRARIES) {
                    return [2 /*return*/, {
                            detected: true,
                            method: 'library_injection',
                            confidence: 0.95,
                            details: 'Library injection detected (LD_PRELOAD/DYLD_INSERT_LIBRARIES)',
                            severity: 'CRITICAL',
                        }];
                }
                // Check for script/typescript session
                if (process.env.SCRIPT) {
                    return [2 /*return*/, {
                            detected: true,
                            method: 'script_session',
                            confidence: 0.6,
                            details: 'Running inside script/typescript session',
                            severity: 'LOW',
                        }];
                }
                return [2 /*return*/, { detected: false, confidence: 0 }];
            });
        });
    };
    /**
     * Check file descriptors for anomalies
     */
    BypassPrevention.prototype.checkFileDescriptors = function () {
        return __awaiter(this, void 0, void 0, function () {
            var fds, _i, fds_1, fd, fdPath, link;
            return __generator(this, function (_a) {
                try {
                    fds = [
                        { fd: 0, name: 'stdin' },
                        { fd: 1, name: 'stdout' },
                        { fd: 2, name: 'stderr' },
                    ];
                    for (_i = 0, fds_1 = fds; _i < fds_1.length; _i++) {
                        fd = fds_1[_i].fd;
                        fdPath = "/proc/".concat(process.pid, "/fd/").concat(fd);
                        if (fs.existsSync(fdPath)) {
                            link = fs.readlinkSync(fdPath);
                            // Check for suspicious redirections
                            if (link === '/dev/null' && fd === 0) {
                                return [2 /*return*/, {
                                        detected: true,
                                        method: 'null_input',
                                        confidence: 0.9,
                                        details: 'Input redirected from /dev/null',
                                        severity: 'HIGH',
                                    }];
                            }
                            // Check for PTY manipulation
                            if (link.includes('ptmx') || link.includes('pts/ptmx')) {
                                return [2 /*return*/, {
                                        detected: true,
                                        method: 'pty_manipulation',
                                        confidence: 0.8,
                                        details: 'PTY master detected',
                                        severity: 'MEDIUM',
                                    }];
                            }
                        }
                    }
                }
                catch (_b) {
                    // FD check failed
                }
                return [2 /*return*/, { detected: false, confidence: 0 }];
            });
        });
    };
    /**
     * Check timing anomalies
     */
    BypassPrevention.prototype.checkTiming = function () {
        return __awaiter(this, void 0, void 0, function () {
            var uptime;
            return __generator(this, function (_a) {
                uptime = process.uptime();
                // If process just started (< 100ms), it might be automated
                if (uptime < 0.1) {
                    return [2 /*return*/, {
                            detected: true,
                            method: 'rapid_execution',
                            confidence: 0.5,
                            details: 'Process executed too quickly',
                            severity: 'LOW',
                        }];
                }
                return [2 /*return*/, { detected: false, confidence: 0 }];
            });
        });
    };
    /**
     * Analyze execution context for anomalies
     */
    BypassPrevention.prototype.analyzeExecutionContext = function (_context) {
        return __awaiter(this, void 0, void 0, function () {
            var result, recorderVars, _i, _a, _b, env, recorder, tree, _c, tree_1, proc, _d, _e, tool;
            return __generator(this, function (_f) {
                switch (_f.label) {
                    case 0:
                        result = {
                            automationDetected: false,
                        };
                        // Check for script/typescript
                        if (process.env.SCRIPT) {
                            result.inScript = true;
                            result.scriptType = 'script';
                        }
                        recorderVars = {
                            ASCIINEMA_REC: 'asciinema',
                            TERMREC: 'termrec',
                            TTY_RECORD: 'ttyrec',
                        };
                        for (_i = 0, _a = Object.entries(recorderVars); _i < _a.length; _i++) {
                            _b = _a[_i], env = _b[0], recorder = _b[1];
                            if (process.env[env]) {
                                result.recording = true;
                                result.recorder = recorder;
                                break;
                            }
                        }
                        return [4 /*yield*/, this.getProcessTree()];
                    case 1:
                        tree = _f.sent();
                        for (_c = 0, tree_1 = tree; _c < tree_1.length; _c++) {
                            proc = tree_1[_c];
                            for (_d = 0, _e = this.automationTools; _d < _e.length; _d++) {
                                tool = _e[_d];
                                if (proc.cmdline.includes(tool)) {
                                    result.automationDetected = true;
                                    result.tool = tool;
                                    break;
                                }
                            }
                        }
                        return [2 /*return*/, result];
                }
            });
        });
    };
    /**
     * Validate approval path integrity
     */
    BypassPrevention.prototype.validateApprovalPath = function () {
        return __awaiter(this, void 0, void 0, function () {
            var stdinPath, link;
            return __generator(this, function (_a) {
                try {
                    stdinPath = "/proc/".concat(process.pid, "/fd/0");
                    if (fs.existsSync(stdinPath)) {
                        link = fs.readlinkSync(stdinPath);
                        return [2 /*return*/, {
                                validTTY: link.includes('/dev/tty') || link.includes('/dev/pts/'),
                                path: link,
                            }];
                    }
                }
                catch (_b) {
                    // Fallback check
                }
                return [2 /*return*/, {
                        validTTY: process.stdin.isTTY || false,
                    }];
            });
        });
    };
    /**
     * Scan environment for threats
     */
    BypassPrevention.prototype.scanEnvironment = function () {
        return __awaiter(this, void 0, void 0, function () {
            var suspicious, threats, _i, _a, envVar;
            return __generator(this, function (_b) {
                suspicious = [];
                threats = [];
                // Check for suspicious variables
                for (_i = 0, _a = this.suspiciousEnvVars; _i < _a.length; _i++) {
                    envVar = _a[_i];
                    if (process.env[envVar]) {
                        suspicious.push(envVar);
                    }
                }
                // Check for injection attempts
                if (process.env.LD_PRELOAD) {
                    threats.push('LD_PRELOAD injection');
                }
                if (process.env.DYLD_INSERT_LIBRARIES) {
                    threats.push('DYLD_INSERT_LIBRARIES injection');
                }
                return [2 /*return*/, {
                        suspicious: suspicious.length > 0 || threats.length > 0,
                        variables: suspicious.length > 0 ? suspicious : undefined,
                        threats: threats.length > 0 ? threats : undefined,
                    }];
            });
        });
    };
    /**
     * Check timing anomaly
     */
    BypassPrevention.prototype.checkTimingAnomaly = function (responseTime, context) {
        return __awaiter(this, void 0, void 0, function () {
            var adjustedTime;
            return __generator(this, function (_a) {
                adjustedTime = responseTime;
                // Adjust for network latency in SSH sessions
                if ((context === null || context === void 0 ? void 0 : context.isSSH) && context.estimatedLatency) {
                    adjustedTime = responseTime - context.estimatedLatency;
                    if (adjustedTime < 200) {
                        return [2 /*return*/, {
                                suspicious: false,
                                confidence: 0.3,
                                adjustedForLatency: true,
                            }];
                    }
                }
                // Check for inhuman response times
                if (adjustedTime < 50) {
                    return [2 /*return*/, {
                            suspicious: true,
                            confidence: 0.99,
                            reason: 'Response faster than human capability',
                        }];
                }
                if (adjustedTime < 100) {
                    return [2 /*return*/, {
                            suspicious: true,
                            confidence: 0.8,
                            reason: 'Response suspiciously fast',
                        }];
                }
                return [2 /*return*/, {
                        suspicious: false,
                        confidence: 0.1,
                    }];
            });
        });
    };
    /**
     * Analyze keystroke pattern
     */
    BypassPrevention.prototype.analyzeKeystrokePattern = function (timings) {
        return __awaiter(this, void 0, void 0, function () {
            var mean, variance, stdDev;
            return __generator(this, function (_a) {
                if (timings.length < 2) {
                    return [2 /*return*/, { suspicious: false }];
                }
                mean = timings.reduce(function (a, b) { return a + b; }) / timings.length;
                variance = timings.reduce(function (sum, t) { return sum + Math.pow(t - mean, 2); }, 0) / timings.length;
                stdDev = Math.sqrt(variance);
                // Very consistent timing suggests automation
                if (stdDev < 5 && mean < 50) {
                    return [2 /*return*/, {
                            suspicious: true,
                            reason: 'Consistent inhuman typing speed',
                        }];
                }
                // All keystrokes exactly the same
                if (timings.every(function (t) { return t === timings[0]; })) {
                    return [2 /*return*/, {
                            suspicious: true,
                            reason: 'Identical keystroke timings',
                        }];
                }
                return [2 /*return*/, { suspicious: false }];
            });
        });
    };
    /**
     * Check for PTY manipulation
     */
    BypassPrevention.prototype.checkPTYManipulation = function () {
        return __awaiter(this, void 0, void 0, function () {
            var ttyName;
            return __generator(this, function (_a) {
                try {
                    ttyName = process.stdin.isTTY ? process.stdin.constructor.name : '';
                    if (ttyName && ttyName.includes('master')) {
                        return [2 /*return*/, {
                                detected: true,
                                method: 'pty_manipulation',
                                confidence: 0.8,
                                details: 'PTY master detected',
                                severity: 'MEDIUM',
                            }];
                    }
                }
                catch (_b) {
                    // PTY check failed
                }
                return [2 /*return*/, { detected: false, confidence: 0 }];
            });
        });
    };
    /**
     * Get process tree (simplified)
     */
    BypassPrevention.prototype.getProcessTree = function () {
        return __awaiter(this, void 0, void 0, function () {
            var tree, cmdline, currentPpid, depth, cmdline, nextPpid, stat, match;
            return __generator(this, function (_a) {
                tree = [];
                try {
                    // Read current process info
                    if (fs.existsSync("/proc/".concat(process.pid, "/cmdline"))) {
                        cmdline = fs.readFileSync("/proc/".concat(process.pid, "/cmdline"), 'utf-8')
                            .replace(/\0/g, ' ').trim();
                        tree.push({
                            pid: process.pid,
                            ppid: process.ppid,
                            cmdline: cmdline,
                        });
                    }
                    currentPpid = process.ppid;
                    depth = 0;
                    while (currentPpid > 1 && depth < 10) {
                        if (fs.existsSync("/proc/".concat(currentPpid, "/cmdline"))) {
                            cmdline = fs.readFileSync("/proc/".concat(currentPpid, "/cmdline"), 'utf-8')
                                .replace(/\0/g, ' ').trim();
                            nextPpid = 0;
                            if (fs.existsSync("/proc/".concat(currentPpid, "/stat"))) {
                                stat = fs.readFileSync("/proc/".concat(currentPpid, "/stat"), 'utf-8');
                                match = stat.match(/\) ([A-Z]) (\d+)/);
                                if (match && match[2]) {
                                    nextPpid = parseInt(match[2], 10);
                                }
                            }
                            tree.push({
                                pid: currentPpid,
                                ppid: nextPpid,
                                cmdline: cmdline,
                            });
                            currentPpid = nextPpid;
                        }
                        else {
                            break;
                        }
                        depth++;
                    }
                }
                catch (_b) {
                    // Process tree unavailable
                }
                return [2 /*return*/, tree];
            });
        });
    };
    /**
     * Log bypass attempt for forensics
     */
    BypassPrevention.prototype.logBypassAttempt = function (attempt) {
        return __awaiter(this, void 0, void 0, function () {
            var logEntry;
            return __generator(this, function (_a) {
                logEntry = __assign(__assign({}, attempt), { pid: process.pid, user: process.env.USER, tty: process.stdin.isTTY });
                console.error('[Deliberate Security]', JSON.stringify(logEntry));
                return [2 /*return*/];
            });
        });
    };
    /**
     * Capture forensic data
     */
    BypassPrevention.prototype.captureForensicData = function () {
        return __awaiter(this, void 0, void 0, function () {
            var _a;
            var _b, _c;
            return __generator(this, function (_d) {
                switch (_d.label) {
                    case 0:
                        _a = {
                            timestamp: Date.now(),
                            process: {
                                pid: process.pid,
                                ppid: process.ppid,
                                uid: ((_b = process.getuid) === null || _b === void 0 ? void 0 : _b.call(process)) || -1,
                                gid: ((_c = process.getgid) === null || _c === void 0 ? void 0 : _c.call(process)) || -1,
                                uptime: process.uptime(),
                            },
                            terminal: {
                                tty: process.stdin.isTTY ? 'yes' : 'no',
                                size: process.stdout.isTTY ? {
                                    rows: process.stdout.rows,
                                    columns: process.stdout.columns,
                                } : null,
                            },
                            environment: Object.keys(process.env).filter(function (key) {
                                return !key.includes('SECRET') && !key.includes('KEY') && !key.includes('PASSWORD');
                            }).reduce(function (acc, key) {
                                acc[key] = process.env[key];
                                return acc;
                            }, {})
                        };
                        return [4 /*yield*/, this.getFileDescriptors()];
                    case 1: return [2 /*return*/, (_a.fileDescriptors = _d.sent(),
                            _a)];
                }
            });
        });
    };
    /**
     * Get open file descriptors
     */
    BypassPrevention.prototype.getFileDescriptors = function () {
        return __awaiter(this, void 0, void 0, function () {
            var fds, fdDir, files, _i, files_1, fd, link;
            return __generator(this, function (_a) {
                fds = [];
                try {
                    fdDir = "/proc/".concat(process.pid, "/fd");
                    if (fs.existsSync(fdDir)) {
                        files = fs.readdirSync(fdDir);
                        for (_i = 0, files_1 = files; _i < files_1.length; _i++) {
                            fd = files_1[_i];
                            try {
                                link = fs.readlinkSync("".concat(fdDir, "/").concat(fd));
                                fds.push({ fd: parseInt(fd, 10), target: link });
                            }
                            catch (_b) {
                                // Skip unreadable FDs
                            }
                        }
                    }
                }
                catch (_c) {
                    // FD listing unavailable
                }
                return [2 /*return*/, fds];
            });
        });
    };
    return BypassPrevention;
}());
exports.BypassPrevention = BypassPrevention;
