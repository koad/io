# Harness Extension — Testing Strategy

Test individual extension modules without launching a full entity session.

## Three Tiers

### Tier 1 — Pure Logic (no pi, no DDP, no filesystem mocks needed)

These modules are plain functions. Test with `node --test` directly.

| Module | What's testable |
|--------|----------------|
| `bond-gate/bash-policy.ts` | `inspectBashCommand()` — takes a command string + scope, returns block or undefined |
| `bond-gate/bash-routing.ts` | `lookupRouting()` — pure config lookup |
| `bond-gate/types.ts` | `expandPath`, `resolveToolPath`, `isUnder`, `isBlocked`, `parsePathList`, `parseNameList` |
| `bond-gate/resolve.ts` | `isExpired`, `bondAppliesToDevice`, with mocked bonds |
| `context-budget.ts` | State machine transitions — extract the threshold logic |
| `circuit-breaker.ts` | Failure counting, sliding window pruning |

### Tier 2 — Filesystem Integration

Need temp directories with bond files. Still no pi.

| Module | What's testable |
|--------|----------------|
| `bond-gate/parse.ts` | `parseBonds()`, `extractClearsignedBody()`, YAML frontmatter parsing |
| `bond-gate/resolve.ts` | `effectiveBonds()`, `resolveGate()` with real bond files |
| `bond-gate/bash-routing.ts` | `loadConfig()` with temp routing.json |
| `bond-gate/bash-denylist.ts` | `loadDenyCommands()`, `loadDenyPatterns()` with env vars |

### Tier 3 — Pi Integration

Needs a running pi session in ephemeral mode. Use `--no-session` to avoid session files.

```bash
# Test a specific tool registration
ENTITY=test KOAD_IO_BOND_GATE_BYPASS=1 \
  pi --no-session --no-context-files \
  -e ~/.koad-io/harness/extension/index.ts \
  "Run this test scenario: ..."
```

Or use pi in print mode for non-interactive validation:

```bash
ENTITY=test KOAD_IO_BOND_GATE_BYPASS=1 \
  pi -p --no-session --no-context-files \
  -e ~/.koad-io/harness/extension/index.ts \
  "List the tools available to you. Do not use any tools — just list their names."
```

## Quick Start

```bash
cd ~/.koad-io/harness

# Run all Tier 1 unit tests
node --test test/unit/

# Run a specific test file
node --test test/unit/bash-policy.test.ts

# Run with watch mode (re-run on changes)
node --test --watch test/unit/bash-policy.test.ts

# Run Tier 2 filesystem tests
node --test test/integration/

# Run Tier 3 pi integration smoke test
./test/pi-smoke.sh
```

## Writing New Tests

### For pure functions (Tier 1)

```typescript
// test/unit/my-module.test.ts
import { describe, it } from "node:test";
import assert from "node:assert";
import { myFunction } from "../../extension/path/to/module";

describe("myFunction", () => {
  it("handles the happy path", () => {
    const result = myFunction("input");
    assert.equal(result, "expected");
  });

  it("handles edge case", () => {
    assert.throws(() => myFunction(null));
  });
});
```

### For bond-gate modules

Set `ENTITY` and `KOAD_IO_HARNESS_*` env vars in your test to simulate different permission configurations without touching real bond files.

### For pi-dependent modules (Tier 3)

Use the smoke test pattern: launch pi in print mode with `-p`, set bypass env vars, and verify the extension loads without crashing. For deeper testing, use the pi SDK programmatically.

## Current Test Coverage

| Module | Tier | Status |
|--------|------|--------|
| `bash-policy.ts` | 1 | ✅ 58 tests |
| `types.ts` helpers | 1 | ✅ 36 tests |
| `resolve.ts` gate logic | 2 | ✅ 36 tests (env-var lanes, bypass, deny, dispatch dir, isExpired, compat vars) |
| `bash-routing.ts` | 1 | ✅ 18 tests |
| `bash-denylist.ts` | 1 | ✅ 19 tests |
| `scrub.ts` (secret scrubbing) | 1-2 | ✅ 20 tests (isProtectedPath, inputLooksSensitive, scrubText, scrubUnknown, scrubToolResult) |
| `index.ts` visitor mode | 2 | ✅ 16 tests (public visitor deny, bonded caller allow, file scope enforcement, scrubbing) |
| `parse.ts` bond parsing | 2 | — (needs gpg mock or signed test bonds) |
| `context-budget.ts` | 3 | — |
| `circuit-breaker.ts` | 3 | — |
| Tool registration | 3 | smoke test |
| DDP integration | 3 | — |

- = not yet written

**Total: 223 tests across 7 files**
