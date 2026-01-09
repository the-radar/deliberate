# Deliberate Test Specifications

These tests ensure we're building exactly what was discussed and agreed upon. They act as executable specifications - if all tests pass, we've built the right system.

## Running Tests

```bash
# Run all specification tests
npm run test:specs

# Run individual specifications
npm run test:toggle    # Toggle system (no shims!)
npm run test:filter    # Safety filter (safe commands pass instantly)
npm run test:ai        # AI integration (only for dangerous commands)
npm run test:agent     # AI agent detection
npm run test:perf      # Performance (<10ms for safe commands)
npm run test:ux        # User experience
```

## Test Structure

Each spec file tests a specific aspect of our agreed design:

### 1. Toggle System (`toggle-system.spec.ts`)
- MUST NOT use shims
- MUST use shell functions instead
- MUST cleanly toggle on/off
- MUST persist state

### 2. Safety Filter (`safety-filter.spec.ts`)
- Safe commands MUST pass in <10ms with "✓ Safe command - proceeding"
- System files MUST trigger path check
- Dangerous commands MUST go to AI

### 3. AI Integration (`ai-integration.spec.ts`)
- AI is ONLY called for dangerous/unknown commands
- MUST include confidence scores
- MUST use RAG for context
- MUST complete within 500ms

### 4. Agent Detection (`agent-detection.spec.ts`)
- MUST detect Claude Code, GitHub Copilot, etc.
- MUST generate single-use auth tokens
- MUST respect `deliberate ai on/off`

### 5. Performance (`performance.spec.ts`)
- Safe commands MUST complete in <10ms
- AI decisions MUST return within 500ms
- MUST work on systems with 2GB RAM

### 6. User Experience (`user-experience.spec.ts`)
- Clear, concise messages
- No technical jargon
- Obvious protection status

## Test Philosophy

These aren't just tests - they're the **specification**. If a test fails, it means we're not building what we agreed to build.

- Tests use REAL command interception (no mocks)
- Tests use REAL AI models (no fake responses)
- Tests measure REAL performance (no estimates)
- Tests run in REAL sandboxed environment (safe but real)

## Before Implementing

1. Run `npm run test:specs` - all tests will fail (red)
2. Implement features to make tests pass (green)
3. If tempted to change a test, ask: "Did our requirements change?"

The tests define success. Build to the tests.