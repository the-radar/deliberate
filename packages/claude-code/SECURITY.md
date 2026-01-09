# Security Model & Honest Limitations

This document describes what @deliberate/claude-code can and cannot protect against.

## What This Tool Does

1. **Pattern Matching**: Regex-based detection of known dangerous patterns
2. **ML Classification**: Prompt injection detection using a fine-tuned DeBERTa model
3. **LLM Explanation**: Human-readable explanations of commands/changes

## What It Protects Against

### Accidental Destruction
- `rm -rf /` and similar destructive commands
- Unintended permission changes (`chmod 777`)
- Database drops, file overwrites

### Obvious Attacks
- Known dangerous command patterns
- Attempts to escalate privileges
- Common prompt injection patterns

### Cognitive Load
- You don't have to parse every command yourself
- Explanations help non-experts understand what's happening

## What It Does NOT Protect Against

### Novel Attacks
The pattern matcher only catches known patterns. A sufficiently creative attacker can construct commands that:
- Achieve the same effect with different syntax
- Use obfuscation (base64, hex encoding, variable expansion)
- Chain benign-looking commands

### Sophisticated Prompt Injection
While the ML model detects many prompt injection attempts, it:
- Was trained on a specific dataset and may miss novel techniques
- Can be fooled by adversarial inputs designed to evade detection
- Has false negatives (dangerous content classified as safe)

### Compromised Dependencies
If the LLM provider, classifier model, or this package itself is compromised:
- Explanations could be misleading
- Risk classifications could be wrong
- The hooks themselves could be malicious

### Insider Threats
If Claude itself is acting maliciously (rather than being tricked), this tool only adds friction. A determined attacker with access to your conversation could:
- Propose actions in small, innocuous-looking steps
- Wait for you to auto-approve patterns
- Exploit legitimate tools in unintended ways

### Time-of-Check vs Time-of-Use
The explanation is generated before execution. The actual command could behave differently if:
- Environment variables change
- Files are modified between check and execution
- Network conditions change

## The Trust Model

```
┌─────────────────────────────────────────────────────────────┐
│  YOU (final authority)                                      │
│    ↑                                                        │
│  This tool (friction + explanation)                         │
│    ↑                                                        │
│  Claude Code (powerful but potentially confused/tricked)    │
│    ↑                                                        │
│  External inputs (files, web content, user messages)        │
└─────────────────────────────────────────────────────────────┘
```

This tool sits between Claude and your approval. It:
- **Adds friction**: You see an explanation before approving
- **Provides context**: Risk level + plain English description
- **Cannot guarantee safety**: Novel attacks will get through

## Layer-Specific Limitations

### Pattern Matcher
- Only catches exact patterns in the list
- Easy to bypass with encoding or alternatives
- No semantic understanding

### ML Classifier (DeBERTa)
- Trained for prompt injection, not general command safety
- ~85% threshold for DANGEROUS may miss edge cases
- Model size limits complexity of analysis
- Can be adversarially attacked

### LLM Explainer
- Subject to the same prompt injection risks as any LLM
- May hallucinate or misunderstand commands
- Depends on external API availability
- Could be manipulated if the provider is compromised

## Recommendations

1. **Don't rely solely on this tool**
   - Read commands before approving, especially destructive ones
   - Be suspicious of unexpected commands

2. **Use the classifier server**
   - ML detection catches more than pattern matching alone
   - Start with `deliberate-claude-code serve`

3. **Review the explanation critically**
   - LLMs can be wrong or manipulated
   - If something seems off, investigate

4. **Keep software updated**
   - Pattern lists and models improve over time
   - Security vulnerabilities get patched

5. **Limit Claude's permissions**
   - Use Claude Code's built-in permission system
   - Don't auto-approve destructive commands

## Reporting Security Issues

If you find a way to bypass the classifier or trick the tool:
1. Please report it responsibly
2. Create an issue or contact the maintainers
3. We'll update patterns/models accordingly

## This Is Defense in Depth

This tool is one layer of protection, not a complete solution. Combine with:
- Claude Code's permission system
- OS-level sandboxing
- Regular backups
- Principle of least privilege
- Your own judgment

**No security tool is perfect. Stay vigilant.**
