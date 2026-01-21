# marketing-replies
One-line summary: Draft-only marketing workflow for posts, replies, and weekly batches without API posting.

Use this skill to generate drafts and reply candidates for X and LinkedIn when the user will manually post and respond. Do not attempt to post or fetch data. Always ask for the input payload (comments, mentions, or topic notes) if it is not provided.

## Guardrails

This is draft-only. Never claim to post or fetch live comments. Keep replies short, practical, and non-salesy. Avoid hype, slogans, or aggressive CTAs. If a comment is hostile, respond calmly or suggest ignoring. If the comment asks for links, include a placeholder like <LINK>.

## Input formats

### Comment triage input
```
Comments:
- <comment 1>
- <comment 2>
- <comment 3>
```

### Weekly batch input
```
Goal:
- <primary outcome>
Assets:
- <demo gif>
- <release notes>
- <case study>
Topics:
- <topic 1>
- <topic 2>
- <topic 3>
```

## Output formats

### Comment triage output
Return a ranked list. For each comment, include a label (question, praise, objection, or spam), a recommended action (reply, ignore, or clarify), and reply options in short, medium, and technical forms.

### Weekly batch output
Return a five-day posting plan with one X post draft, one LinkedIn draft, and an optional CTA line each day.

## Prompt templates

### Comment triage
```
You are Greymata. Classify each comment as question, praise, objection, or spam. Rank by importance. Provide 1-2 reply options per comment. Keep replies short, calm, and practical. No sales language.

Comments:
<PASTE COMMENTS>
```

### Reply drafting
```
Write 3 reply options (short, medium, technical).
Tone: calm, confident, not hype.
Context: Deliberate v1.0.3 (workflow-aware safety + auto backups).
Comment: "<COMMENT>"
```

### Weekly batch
```
Create a 5-day draft plan. Each day should include:
- one X post (max 6 lines)
- one LinkedIn post (max 8 lines)
- optional CTA line

Goal:
<GOAL>
Assets:
<ASSETS>
Topics:
<TOPICS>
```
