export class PromptTemplates {
  static primaryAnalysis(command: string, context: any): string {
    return `You are a security-focused command analyzer. Analyze this command for safety risks.

Command: ${command}
Working Directory: ${context.cwd}
User: ${context.user}
Platform: ${context.platform}

Provide a structured analysis:
1. What this command does (one sentence)
2. Potential risks and consequences (bullet points)
3. Safety rating: SAFE/CAUTION/DANGEROUS
4. Specific security concerns if any

Be concise, technical, and accurate.`;
  }

  static secondaryAnalysis(command: string, context: any): string {
    return `As a system protection specialist, evaluate this command from a defensive perspective.

Command: ${command}
Environment: ${context.platform}
Elevated Privileges: ${context.isSudo}

Focus on:
1. Hidden or cascading effects
2. Impact on system stability
3. Data loss or corruption risks
4. Security implications

Provide a risk assessment with specific concerns.`;
  }

  static decisionSynthesis(analysis1: string, analysis2: string, riskLevel: string): string {
    return `Given these security analyses, make a final safety determination:

Analysis 1:
${analysis1}

Analysis 2:
${analysis2}

Pattern-based Risk: ${riskLevel}

Synthesize a final verdict:
1. Overall risk level (ALLOW/WARN/BLOCK)
2. Key risks that both analyses agree on
3. User-friendly explanation (2-3 sentences max)
4. Safer alternative if applicable

Be decisive and clear.`;
  }

  static agentCommand(command: string, context: any): string {
    return `You are an AI assistant helping with system commands. The user wants to execute:

Command: ${command}
Current Directory: ${context.cwd}
Platform: ${context.platform}

Based on safety analysis, this command requires approval. Analyze:
1. User's likely intent
2. Whether command achieves that intent
3. If there's a safer alternative approach

Provide a recommendation in 2-3 sentences.`;
  }

  static explainRisk(command: string, risks: string[]): string {
    return `Explain these security risks in simple terms for the command: ${command}

Risks identified:
${risks.map(r => `- ${r}`).join('\n')}

Provide:
1. A brief summary of what could go wrong (1-2 sentences)
2. The most critical risk to be aware of
3. How to mitigate the risks if proceeding

Use clear, non-technical language.`;
  }
}