"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AgentAuthSystem = void 0;
var AgentAuthSystem = /** @class */ (function () {
    function AgentAuthSystem() {
        this.authCodes = new Map();
        this.codeExpiry = 5 * 60 * 1000; // 5 minutes
        // Word lists for readable codes
        this.adjectives = [
            'swift', 'brave', 'bright', 'calm', 'clear',
            'cool', 'eager', 'fair', 'fast', 'free',
            'glad', 'good', 'grand', 'great', 'green',
            'happy', 'kind', 'light', 'neat', 'nice',
            'proud', 'pure', 'quick', 'sharp', 'smart',
            'solid', 'sound', 'strong', 'sweet', 'true'
        ];
        this.nouns = [
            'apple', 'arrow', 'badge', 'beach', 'bird',
            'block', 'boat', 'book', 'brain', 'bread',
            'brick', 'brush', 'cake', 'chair', 'clock',
            'cloud', 'coin', 'crown', 'desk', 'door',
            'eagle', 'earth', 'field', 'fire', 'flag',
            'flower', 'forest', 'game', 'gate', 'glass'
        ];
    }
    AgentAuthSystem.prototype.generateAuthCode = function (command, args, analysis) {
        var _this = this;
        // Generate readable but secure code
        var code = this.generateReadableCode();
        this.authCodes.set(code, {
            command: command,
            args: args,
            analysis: analysis,
            timestamp: Date.now(),
            used: false
        });
        // Schedule cleanup
        setTimeout(function () {
            _this.authCodes.delete(code);
        }, this.codeExpiry);
        return code;
    };
    AgentAuthSystem.prototype.validateAuthCode = function (code) {
        var authData = this.authCodes.get(code);
        if (!authData) {
            return { valid: false, reason: 'Invalid or expired auth code' };
        }
        if (authData.used) {
            return { valid: false, reason: 'Auth code already used' };
        }
        if (Date.now() - authData.timestamp > this.codeExpiry) {
            this.authCodes.delete(code);
            return { valid: false, reason: 'Auth code expired' };
        }
        // Mark as used
        authData.used = true;
        return { valid: true, data: authData };
    };
    AgentAuthSystem.prototype.generateReadableCode = function () {
        var adj = this.adjectives[Math.floor(Math.random() * this.adjectives.length)];
        var noun = this.nouns[Math.floor(Math.random() * this.nouns.length)];
        var num = Math.floor(Math.random() * 100);
        return "".concat(adj, "-").concat(noun, "-").concat(num);
    };
    // Clean up expired codes
    AgentAuthSystem.prototype.cleanup = function () {
        var now = Date.now();
        for (var _i = 0, _a = this.authCodes; _i < _a.length; _i++) {
            var _b = _a[_i], code = _b[0], data = _b[1];
            if (now - data.timestamp > this.codeExpiry) {
                this.authCodes.delete(code);
            }
        }
    };
    // Get active codes count (for monitoring)
    AgentAuthSystem.prototype.getActiveCodesCount = function () {
        this.cleanup();
        return this.authCodes.size;
    };
    return AgentAuthSystem;
}());
exports.AgentAuthSystem = AgentAuthSystem;
