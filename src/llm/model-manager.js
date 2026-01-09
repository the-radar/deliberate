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
exports.ModelManager = void 0;
var child_process_1 = require("child_process");
var path = require("path");
var os = require("os");
var axios_1 = require("axios");
var ModelManager = /** @class */ (function () {
    function ModelManager() {
        this.models = new Map();
        this.processes = new Map();
        this.initialized = false;
        this.modelDir = path.join(os.homedir(), '.deliberate', 'models');
    }
    ModelManager.prototype.initialize = function () {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        // Define our model configuration with proper context sizes
                        this.models.set('qwen2', {
                            name: 'qwen2:1.5b-instruct-q4_0',
                            path: path.join(this.modelDir, 'qwen2-1.5b-q4.gguf'),
                            type: 'analyzer',
                            port: 11434,
                            contextSize: 2048
                        });
                        this.models.set('smollm2', {
                            name: 'smollm2:1.7b-instruct-q4_0',
                            path: path.join(this.modelDir, 'smollm2-1.7b-q4.gguf'),
                            type: 'analyzer',
                            port: 11435,
                            contextSize: 2048
                        });
                        this.models.set('deepseek', {
                            name: 'deepseek-r1:1.5b-q4_0',
                            path: path.join(this.modelDir, 'deepseek-r1-1.5b-q4.gguf'),
                            type: 'decision',
                            port: 11436,
                            contextSize: 4096 // Decision model gets more context
                        });
                        // Start Ollama instances
                        return [4 /*yield*/, this.startOllama()];
                    case 1:
                        // Start Ollama instances
                        _a.sent();
                        // Load models with proper context windows
                        return [4 /*yield*/, this.loadModels()];
                    case 2:
                        // Load models with proper context windows
                        _a.sent();
                        this.initialized = true;
                        return [2 /*return*/];
                }
            });
        });
    };
    ModelManager.prototype.isInitialized = function () {
        return this.initialized;
    };
    ModelManager.prototype.startOllama = function () {
        return __awaiter(this, void 0, void 0, function () {
            var _a, _b, ollama;
            return __generator(this, function (_c) {
                switch (_c.label) {
                    case 0:
                        _c.trys.push([0, 2, , 3]);
                        return [4 /*yield*/, this.executeCommand('ollama', ['--version'])];
                    case 1:
                        _c.sent();
                        return [3 /*break*/, 3];
                    case 2:
                        _a = _c.sent();
                        throw new Error('Ollama not installed. Please install from https://ollama.ai');
                    case 3:
                        _c.trys.push([3, 5, , 7]);
                        return [4 /*yield*/, axios_1.default.get('http://localhost:11434/api/tags')];
                    case 4:
                        _c.sent();
                        return [3 /*break*/, 7];
                    case 5:
                        _b = _c.sent();
                        console.log('Starting Ollama server...');
                        ollama = (0, child_process_1.spawn)('ollama', ['serve'], {
                            detached: true,
                            stdio: 'ignore'
                        });
                        ollama.unref();
                        // Wait for server to start
                        return [4 /*yield*/, this.waitForServer('http://localhost:11434/api/tags', 30000)];
                    case 6:
                        // Wait for server to start
                        _c.sent();
                        return [3 /*break*/, 7];
                    case 7: return [2 /*return*/];
                }
            });
        });
    };
    ModelManager.prototype.loadModels = function () {
        return __awaiter(this, void 0, void 0, function () {
            var _loop_1, this_1, _i, _a, _b, model;
            return __generator(this, function (_c) {
                switch (_c.label) {
                    case 0:
                        _loop_1 = function (model) {
                            var response, models, error_1;
                            return __generator(this, function (_d) {
                                switch (_d.label) {
                                    case 0:
                                        _d.trys.push([0, 5, , 6]);
                                        return [4 /*yield*/, axios_1.default.get("http://localhost:".concat(model.port, "/api/tags"))];
                                    case 1:
                                        response = _d.sent();
                                        models = response.data.models || [];
                                        if (!!models.some(function (m) { return m.name === model.name; })) return [3 /*break*/, 3];
                                        console.log("Downloading ".concat(model.name, "..."));
                                        return [4 /*yield*/, this_1.pullModel(model.name)];
                                    case 2:
                                        _d.sent();
                                        _d.label = 3;
                                    case 3: 
                                    // Keep model loaded in memory
                                    return [4 /*yield*/, this_1.keepModelWarm(model.name, model.port)];
                                    case 4:
                                        // Keep model loaded in memory
                                        _d.sent();
                                        return [3 /*break*/, 6];
                                    case 5:
                                        error_1 = _d.sent();
                                        console.error("Failed to load model ".concat(model.name, ":"), error_1);
                                        return [3 /*break*/, 6];
                                    case 6: return [2 /*return*/];
                                }
                            });
                        };
                        this_1 = this;
                        _i = 0, _a = this.models;
                        _c.label = 1;
                    case 1:
                        if (!(_i < _a.length)) return [3 /*break*/, 4];
                        _b = _a[_i], model = _b[1];
                        return [5 /*yield**/, _loop_1(model)];
                    case 2:
                        _c.sent();
                        _c.label = 3;
                    case 3:
                        _i++;
                        return [3 /*break*/, 1];
                    case 4: return [2 /*return*/];
                }
            });
        });
    };
    ModelManager.prototype.pullModel = function (modelName) {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                return [2 /*return*/, new Promise(function (resolve, reject) {
                        var pull = (0, child_process_1.spawn)('ollama', ['pull', modelName]);
                        pull.stdout.on('data', function (data) {
                            process.stdout.write(data);
                        });
                        pull.on('exit', function (code) {
                            if (code === 0)
                                resolve();
                            else
                                reject(new Error("Failed to pull model ".concat(modelName)));
                        });
                    })];
            });
        });
    };
    ModelManager.prototype.inference = function (modelKey, prompt) {
        return __awaiter(this, void 0, void 0, function () {
            var model, response;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        model = this.models.get(modelKey);
                        if (!model)
                            throw new Error("Model ".concat(modelKey, " not found"));
                        return [4 /*yield*/, axios_1.default.post("http://localhost:".concat(model.port, "/api/generate"), {
                                model: model.name,
                                prompt: prompt,
                                stream: false,
                                options: {
                                    temperature: 0.1,
                                    top_k: 10,
                                    top_p: 0.9,
                                    num_predict: 512, // Increased for comprehensive analysis
                                    num_ctx: model.contextSize, // Use model-specific context size
                                    repeat_penalty: 1.1,
                                    seed: -1 // For reproducibility in production
                                }
                            })];
                    case 1:
                        response = _a.sent();
                        return [2 /*return*/, response.data.response];
                }
            });
        });
    };
    ModelManager.prototype.executeCommand = function (command, args) {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                return [2 /*return*/, new Promise(function (resolve, reject) {
                        var proc = (0, child_process_1.spawn)(command, args);
                        proc.on('exit', function (code) {
                            if (code === 0)
                                resolve();
                            else
                                reject(new Error("".concat(command, " exited with code ").concat(code)));
                        });
                    })];
            });
        });
    };
    ModelManager.prototype.waitForServer = function (url, timeout) {
        return __awaiter(this, void 0, void 0, function () {
            var start, _a;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        start = Date.now();
                        _b.label = 1;
                    case 1:
                        if (!(Date.now() - start < timeout)) return [3 /*break*/, 7];
                        _b.label = 2;
                    case 2:
                        _b.trys.push([2, 4, , 6]);
                        return [4 /*yield*/, axios_1.default.get(url)];
                    case 3:
                        _b.sent();
                        return [2 /*return*/];
                    case 4:
                        _a = _b.sent();
                        return [4 /*yield*/, new Promise(function (resolve) { return setTimeout(resolve, 1000); })];
                    case 5:
                        _b.sent();
                        return [3 /*break*/, 6];
                    case 6: return [3 /*break*/, 1];
                    case 7: throw new Error('Server startup timeout');
                }
            });
        });
    };
    ModelManager.prototype.keepModelWarm = function (modelName, port) {
        return __awaiter(this, void 0, void 0, function () {
            var error_2;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        _a.trys.push([0, 2, , 3]);
                        return [4 /*yield*/, axios_1.default.post("http://localhost:".concat(port, "/api/generate"), {
                                model: modelName,
                                prompt: 'Hi',
                                stream: false,
                                options: {
                                    num_predict: 1
                                }
                            })];
                    case 1:
                        _a.sent();
                        return [3 /*break*/, 3];
                    case 2:
                        error_2 = _a.sent();
                        console.error("Failed to warm up model ".concat(modelName, ":"), error_2);
                        return [3 /*break*/, 3];
                    case 3: return [2 /*return*/];
                }
            });
        });
    };
    ModelManager.prototype.shutdown = function () {
        return __awaiter(this, void 0, void 0, function () {
            var _i, _a, _b, process_1;
            return __generator(this, function (_c) {
                // Clean up model processes if needed
                for (_i = 0, _a = this.processes; _i < _a.length; _i++) {
                    _b = _a[_i], process_1 = _b[1];
                    if (process_1 && !process_1.killed) {
                        process_1.kill();
                    }
                }
                this.processes.clear();
                this.initialized = false;
                return [2 /*return*/];
            });
        });
    };
    return ModelManager;
}());
exports.ModelManager = ModelManager;
