# LLM explanation visibility regression WORKFILE

One-line summary: restore in-depth command explanations by fixing runtime LLM configuration and validating terminal/TUI surfacing end-to-end.

## Problem statement and requirements
The user reports that Deliberate is no longer showing in-depth explanations. Terminal output falls back to generic local-rule messaging, and TUI details do not include expected model-backed analysis.

Requirements:
- Find root cause of missing LLM analysis output.
- Restore full explanation behavior for command review flow.
- Preserve review-first UX (no silent bypasses).
- Validate behavior in terminal hook output and TUI history/review views.

## Detailed implementation plan (checklist)
- [x] Inspect live runtime config and hook code path for LLM availability checks.
- [x] Restore/normalize runtime LLM provider settings when keychain OAuth token exists.
- [x] Reproduce hook run and verify rich explanation text in hook output.
- [x] Verify TUI review/history panels show non-generic explanation lines.
- [x] Update docs/troubleshooting if setup gap is user-facing.
- [x] Run full local validation suite (syntax + tests).

## System context (relevant files, methods, line numbers)
- `/Users/h4tch1ing/Documents/deliberate/hooks/deliberate-commands.py`
  - `load_llm_config()` (~1889)
  - `call_llm_for_explanation()` (~2160)
  - fallback text assignment and cache write (~2480+)
  - `build_local_rule_reason()` (~1960)
- `/Users/h4tch1ing/Documents/deliberate/hooks/deliberate-commands-post.py`
  - terminal surfacing mode handling (~220+)
- `/Users/h4tch1ing/Documents/deliberate/src/tui/index.js`
  - queue title/details rendering for explanation text
- Runtime config:
  - `/Users/h4tch1ing/.deliberate/config.json`

## Directory structure
- Hook logic: `/Users/h4tch1ing/Documents/deliberate/hooks/`
- CLI/config install path: `/Users/h4tch1ing/Documents/deliberate/src/`
- TUI rendering: `/Users/h4tch1ing/Documents/deliberate/src/tui/`

## Pseudocode for critical algorithms
```text
on PreToolUse(Bash):
  config = load_llm_config()
  pre = local_rule_assessment(command)
  evidence = web_search_evidence(command)
  llm_result = call_llm_for_explanation(command, pre, script_or_inline_content, evidence)

  if llm_result exists:
    explanation = llm_result.explanation
  else if pre exists:
    explanation = pre.reason + "LLM unavailable" marker
  else:
    allow fail-open

  cache explanation for PostToolUse and broadcast to TUI
```

## Security considerations and potential vulnerabilities
- Do not log or expose OAuth token values.
- Keep fail-open behavior unchanged for hook stability, but preserve explicit warning when LLM is unavailable.
- Ensure explanation restoration does not weaken approval gates for dangerous commands.

## Alternative approaches considered
- Hard-fail when LLM missing: rejected, too disruptive for user workflows.
- Keep current behavior and only adjust text: rejected, does not restore expected explainability value.
- Auto-default provider to `claude-subscription` if keychain token exists: viable fallback if config is unset.

## Research findings and reference code
- Live config had `llm.provider = null`, causing `load_llm_config()` to return `None`.
- Hook intentionally fell back to local rules and emitted “LLM unavailable”.
- After restoring provider, explanations still failed with API 401 because hook force-injected a stale keychain token.
- Direct Claude SDK call without forced token succeeds, proving auth fallback works when we let SDK resolve credentials.

## Design decisions and rationale
- Restore explicit provider config first to recover intended experience quickly.
- Remove forced keychain token injection for subscription mode and rely on Claude SDK native auth unless user explicitly sets `llm.apiKey`.
- Keep local-rule explanation improvements as fallback only, not primary path.
- Validate across both terminal and TUI to ensure user-visible behavior is consistent.

## Testing strategy and test cases
- Syntax checks:
  - `python3 -m py_compile hooks/*.py`
  - `node --check src/tui/index.js`
- Automated tests:
  - `npm test`
- Runtime checks:
  - Trigger dangerous command hook and confirm in-depth explanation text present.
  - Open TUI and verify explanation appears in details panel and list snippet.

## Progress tracking
- [x] Workfile created
- [x] Root cause identified (provider unset)
- [x] Fix applied
- [x] Runtime validated
- [x] Tests green
- [ ] User evidence/screenshots ready

## Questions and uncertainties to resolve
- Should Deliberate auto-heal `llm.provider` when unset but keychain token exists?
- Should installer/status command explicitly flag “provider unset but token available” as actionable warning?
- Should we deprecate keychain scraping entirely across code paths and only use SDK auth + explicit override tokens?
