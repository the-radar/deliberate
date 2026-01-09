"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PromptTemplates = void 0;
var PromptTemplates = /** @class */ (function () {
    function PromptTemplates() {
    }
    PromptTemplates.primaryAnalysis = function (command, context) {
        return "You are a security-focused command analyzer. Analyze this command for safety risks.\n\nCommand: ".concat(command, "\nWorking Directory: ").concat(context.cwd, "\nUser: ").concat(context.user, "\nPlatform: ").concat(context.platform, "\n\nProvide a structured analysis:\n1. What this command does (one sentence)\n2. Potential risks and consequences (bullet points)\n3. Safety rating: SAFE/CAUTION/DANGEROUS\n4. Specific security concerns if any\n\nBe concise, technical, and accurate.");
    };
    PromptTemplates.secondaryAnalysis = function (command, context) {
        return "As a system protection specialist, evaluate this command from a defensive perspective.\n\nCommand: ".concat(command, "\nEnvironment: ").concat(context.platform, "\nElevated Privileges: ").concat(context.isSudo, "\n\nFocus on:\n1. Hidden or cascading effects\n2. Impact on system stability\n3. Data loss or corruption risks\n4. Security implications\n\nProvide a risk assessment with specific concerns.");
    };
    PromptTemplates.decisionSynthesis = function (analysis1, analysis2, riskLevel) {
        return "Given these security analyses, make a final safety determination:\n\nAnalysis 1:\n".concat(analysis1, "\n\nAnalysis 2:\n").concat(analysis2, "\n\nPattern-based Risk: ").concat(riskLevel, "\n\nSynthesize a final verdict:\n1. Overall risk level (ALLOW/WARN/BLOCK)\n2. Key risks that both analyses agree on\n3. User-friendly explanation (2-3 sentences max)\n4. Safer alternative if applicable\n\nBe decisive and clear.");
    };
    PromptTemplates.agentCommand = function (command, context) {
        return "You are an AI assistant helping with system commands. The user wants to execute:\n\nCommand: ".concat(command, "\nCurrent Directory: ").concat(context.cwd, "\nPlatform: ").concat(context.platform, "\n\nBased on safety analysis, this command requires approval. Analyze:\n1. User's likely intent\n2. Whether command achieves that intent\n3. If there's a safer alternative approach\n\nProvide a recommendation in 2-3 sentences.");
    };
    PromptTemplates.explainRisk = function (command, risks) {
        return "Explain these security risks in simple terms for the command: ".concat(command, "\n\nRisks identified:\n").concat(risks.map(function (r) { return "- ".concat(r); }).join('\n'), "\n\nProvide:\n1. A brief summary of what could go wrong (1-2 sentences)\n2. The most critical risk to be aware of\n3. How to mitigate the risks if proceeding\n\nUse clear, non-technical language.");
    };
    return PromptTemplates;
}());
exports.PromptTemplates = PromptTemplates;
