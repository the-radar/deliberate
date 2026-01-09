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
exports.AnalysisOrchestrator = void 0;
var model_manager_1 = require("./model-manager");
var prompts_1 = require("./prompts");
var redactor_1 = require("../core/redaction/redactor");
var classifier_1 = require("../core/classification/classifier");
var AnalysisOrchestrator = /** @class */ (function () {
    function AnalysisOrchestrator() {
        this.modelManager = new model_manager_1.ModelManager();
        this.redactor = new redactor_1.SensitiveDataRedactor();
        this.classifier = new classifier_1.CommandClassifier();
    }
    AnalysisOrchestrator.prototype.initialize = function () {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, this.modelManager.initialize()];
                    case 1:
                        _a.sent();
                        return [2 /*return*/];
                }
            });
        });
    };
    AnalysisOrchestrator.prototype.analyze = function (command, args, context) {
        return __awaiter(this, void 0, void 0, function () {
            var fullCommand, redacted, _a, analysis1, analysis2, patternRisk, decision, error_1;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        if (!!this.modelManager.isInitialized()) return [3 /*break*/, 2];
                        return [4 /*yield*/, this.modelManager.initialize()];
                    case 1:
                        _b.sent();
                        _b.label = 2;
                    case 2:
                        fullCommand = "".concat(command, " ").concat(args.join(' '));
                        return [4 /*yield*/, this.redactor.redactCommand(fullCommand)];
                    case 3:
                        redacted = _b.sent();
                        _b.label = 4;
                    case 4:
                        _b.trys.push([4, 7, , 8]);
                        return [4 /*yield*/, Promise.all([
                                this.runPrimaryAnalysis(redacted, context),
                                this.runSecondaryAnalysis(redacted, context),
                                this.getPatternRisk(command, args)
                            ])];
                    case 5:
                        _a = _b.sent(), analysis1 = _a[0], analysis2 = _a[1], patternRisk = _a[2];
                        return [4 /*yield*/, this.synthesizeDecision(analysis1, analysis2, patternRisk)];
                    case 6:
                        decision = _b.sent();
                        return [2 /*return*/, decision];
                    case 7:
                        error_1 = _b.sent();
                        console.error('LLM analysis failed:', error_1);
                        // Fallback to pattern-based analysis
                        return [2 /*return*/, this.fallbackAnalysis(command, args)];
                    case 8: return [2 /*return*/];
                }
            });
        });
    };
    AnalysisOrchestrator.prototype.runPrimaryAnalysis = function (command, context) {
        return __awaiter(this, void 0, void 0, function () {
            var prompt;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        prompt = prompts_1.PromptTemplates.primaryAnalysis(command, context);
                        return [4 /*yield*/, this.modelManager.inference('qwen2', prompt)];
                    case 1: return [2 /*return*/, _a.sent()];
                }
            });
        });
    };
    AnalysisOrchestrator.prototype.runSecondaryAnalysis = function (command, context) {
        return __awaiter(this, void 0, void 0, function () {
            var prompt;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        prompt = prompts_1.PromptTemplates.secondaryAnalysis(command, context);
                        return [4 /*yield*/, this.modelManager.inference('smollm2', prompt)];
                    case 1: return [2 /*return*/, _a.sent()];
                }
            });
        });
    };
    AnalysisOrchestrator.prototype.synthesizeDecision = function (analysis1, analysis2, patternRisk) {
        return __awaiter(this, void 0, void 0, function () {
            var prompt, decision;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        prompt = prompts_1.PromptTemplates.decisionSynthesis(analysis1, analysis2, patternRisk);
                        return [4 /*yield*/, this.modelManager.inference('deepseek', prompt)];
                    case 1:
                        decision = _a.sent();
                        // Parse structured response
                        return [2 /*return*/, this.parseDecision(decision)];
                }
            });
        });
    };
    AnalysisOrchestrator.prototype.parseDecision = function (response) {
        // Simple parsing - in production, use proper structured output
        var lines = response.split('\n');
        var verdict = 'WARN';
        var explanation = '';
        var risks = [];
        var alternatives = [];
        for (var _i = 0, lines_1 = lines; _i < lines_1.length; _i++) {
            var line = lines_1[_i];
            var upperLine = line.toUpperCase();
            if (upperLine.includes('ALLOW') && upperLine.includes('RISK')) {
                verdict = 'ALLOW';
            }
            else if (upperLine.includes('BLOCK')) {
                verdict = 'BLOCK';
            }
            else if (upperLine.includes('WARN')) {
                verdict = 'WARN';
            }
            if (line.toLowerCase().includes('explanation:') || line.toLowerCase().includes('summary:')) {
                explanation = line.split(':').slice(1).join(':').trim();
            }
            if (line.startsWith('-') || line.startsWith('•')) {
                var content = line.substring(1).trim();
                if (line.toLowerCase().includes('alternative') || line.toLowerCase().includes('instead')) {
                    alternatives.push(content);
                }
                else {
                    risks.push(content);
                }
            }
        }
        return {
            verdict: verdict,
            explanation: explanation || 'Command requires careful consideration',
            risks: risks,
            alternatives: alternatives,
            confidence: 0.85
        };
    };
    AnalysisOrchestrator.prototype.getPatternRisk = function (command, args) {
        return __awaiter(this, void 0, void 0, function () {
            var classification;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, this.classifier.classify(command, args, {
                            command: command,
                            args: args,
                            env: process.env,
                            cwd: process.cwd(),
                            user: process.env.USER || 'unknown',
                            timestamp: Date.now(),
                            sudo: false
                        })];
                    case 1:
                        classification = _a.sent();
                        switch (classification.riskLevel) {
                            case 'SAFE':
                                return [2 /*return*/, 'LOW - Command matches safe patterns'];
                            case 'CAUTION':
                                return [2 /*return*/, 'MEDIUM - Command has some risk indicators'];
                            case 'HIGH':
                            case 'CRITICAL':
                                return [2 /*return*/, 'HIGH - Command matches dangerous patterns'];
                            default:
                                return [2 /*return*/, 'UNKNOWN - No pattern match'];
                        }
                        return [2 /*return*/];
                }
            });
        });
    };
    AnalysisOrchestrator.prototype.fallbackAnalysis = function (command, args) {
        return __awaiter(this, void 0, void 0, function () {
            var classification, verdict, explanation;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, this.classifier.classify(command, args, {
                            command: command,
                            args: args,
                            env: process.env,
                            cwd: process.cwd(),
                            user: process.env.USER || 'unknown',
                            timestamp: Date.now(),
                            sudo: false
                        })];
                    case 1:
                        classification = _a.sent();
                        verdict = 'WARN';
                        explanation = '';
                        switch (classification.riskLevel) {
                            case 'SAFE':
                                verdict = 'ALLOW';
                                explanation = 'Command appears safe based on pattern analysis';
                                break;
                            case 'CRITICAL':
                                verdict = 'BLOCK';
                                explanation = 'Command matches dangerous patterns and should not be executed';
                                break;
                            case 'HIGH':
                                verdict = 'WARN';
                                explanation = 'Command has high risk and requires careful review';
                                break;
                            default:
                                verdict = 'WARN';
                                explanation = 'Command requires manual review';
                        }
                        return [2 /*return*/, {
                                verdict: verdict,
                                explanation: explanation,
                                risks: classification.risks || [],
                                confidence: 0.6
                            }];
                }
            });
        });
    };
    AnalysisOrchestrator.prototype.explainRisks = function (command, risks) {
        return __awaiter(this, void 0, void 0, function () {
            var prompt, _a;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        prompt = prompts_1.PromptTemplates.explainRisk(command, risks);
                        _b.label = 1;
                    case 1:
                        _b.trys.push([1, 3, , 4]);
                        return [4 /*yield*/, this.modelManager.inference('qwen2', prompt)];
                    case 2: return [2 /*return*/, _b.sent()];
                    case 3:
                        _a = _b.sent();
                        return [2 /*return*/, risks.join('. ')];
                    case 4: return [2 /*return*/];
                }
            });
        });
    };
    AnalysisOrchestrator.prototype.shutdown = function () {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, this.modelManager.shutdown()];
                    case 1:
                        _a.sent();
                        return [2 /*return*/];
                }
            });
        });
    };
    return AnalysisOrchestrator;
}());
exports.AnalysisOrchestrator = AnalysisOrchestrator;
