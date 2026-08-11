---
name: live-verification
description: Evidence-based live verification workflow - prove a change works by executing it before claiming it is done
load_when:
  - "About to claim a change is done, fixed, working, or passing"
  - "Finishing an implementation and reporting its status"
  - "Fixing a reported bug and confirming the fix"
  - "Deploying or releasing a change to any environment"
  - "Writing manual test checklists or smoke scripts"
  - "Deciding how to verify behavior beyond automated tests"
rule_prefix: VER
---

# Live Verification

This file governs the workflow of proving that work actually works: what counts as evidence, when to gather it, and how to report it honestly. It applies to humans and agents equally, after any implementation, however small. Authoring automated tests is covered by `testing-tdd.md`; vulnerability scanning and lint gates by `security-and-linting.md`; recording the change for posterity by `documentation.md`.

## Quick reference

| ID | Level | Rule |
| --- | --- | --- |
| VER-001 | MUST NOT | Claim done, fixed, or working without evidence generated in the current session |
| VER-002 | MUST NOT | Substitute prediction ("should work") for execution |
| VER-003 | MUST | State the verification verdict honestly: proven, not yet proven, or cannot verify here |
| VER-004 | MUST | Exercise the change at the user-visible surface, not only through tests |
| VER-005 | MUST | Reproduce a bug before fixing it, then rerun the same steps to prove it no longer reproduces |
| VER-006 | MUST | Verify error paths, not only the happy path |
| VER-007 | SHOULD | Verify against the real build artifact when behavior could differ from dev mode |
| VER-008 | MUST | Record evidence as exact commands and outputs, not paraphrase |
| VER-009 | SHOULD | Maintain a repeatable manual test checklist per user-visible change |
| VER-010 | SHOULD | Commit smoke scripts to the repository instead of re-inventing ad-hoc checks |
| VER-011 | MUST | Run a post-deploy smoke check of the critical path |
| VER-012 | SHOULD | Verify from a clean state when caching or local state could mask failure |
| VER-013 | SHOULD | Roll out progressively and observe metrics before declaring the deploy verified |

## Rules

### VER-001 MUST NOT: Claim done, fixed, or working without evidence generated in the current session

**Why:** Reasoning about code predicts behavior; only execution demonstrates it. A completion claim backed by nothing but reading the diff is a guess wearing a conclusion's clothes, and a wrong one becomes a production incident discovered by someone else.

Evidence means an artifact produced in this session by actually running something: command output, an HTTP response, a rendered page, a log line, a screenshot, a test run. Evidence from a previous session, or from before the latest edit, does not count - the code has changed since it was produced.

**Do:**

```bash
npm run build && node dist/cli.js export --env prod
# exit 0; output: "Exported 42 variables to .env.prod"
# -> now the claim "export works" is backed by this run
```

**Don't:**

```ts
// "I updated the export command to include prod variables.
//  The export should now work correctly."  <- no run, no evidence, no claim
```

**Exception:** Changes with no runtime behavior (comment wording, README prose). Say explicitly that the change is not runtime-verifiable and what you checked instead (e.g., rendered the markdown, ran the formatter).

### VER-002 MUST NOT: Substitute prediction ("should work") for execution

**Why:** "Should work", "will fix it", and "I expect this passes" are predictions, and predictions are exactly what verification exists to replace. If the command is runnable here, run it; the sentence costs more credibility than the run costs time.

Banned status vocabulary: "should work", "should pass", "should fix", "likely works", "I believe this is correct" - whenever the thing being described can be executed in the current environment. Replace the prediction with the run and report what happened.

**Do:**

```bash
npx vitest run src/parser.test.ts
# Test Files  1 passed (1) - Tests  14 passed (14)
```

**Don't:**

```ts
// "The parser change should make all 14 tests pass." <- run them instead
```

**Exception:** Genuinely un-runnable statements (behavior on a customer's machine, load at 100x traffic). Then label the statement as a prediction, not a result, per VER-003.

### VER-003 MUST: State the verification verdict honestly: proven, not yet proven, or cannot verify here

**Why:** A verification workflow is only as good as the honesty of its final sentence. Smuggling an unverified claim past the reader as if it were verified is worse than not verifying at all, because it disables their skepticism.

Every status report ends in exactly one of three verdicts:

- **Proven** - the claim, plus the evidence from this session that backs it (VER-008).
- **Not yet proven** - verification ran and surfaced a gap; name the gap and go back to work. No "done".
- **Cannot verify here** - name precisely why (missing credentials, no access to the target environment, hardware-dependent), state what was verified instead, and flag what therefore remains unverified.

Never blend the categories: "tests pass (proven), and the OAuth callback is unverified here because this environment has no client secret" is honest; "everything works" covering both is not.

**Exception:** None. This rule has no escape hatch by design.

### VER-004 MUST: Exercise the change at the user-visible surface, not only through tests

**Why:** Tests prove the units they cover; users hit the composed system - CLI argument parsing, route wiring, middleware order, serialization, environment config - which tests routinely bypass. Green tests are necessary but not sufficient for "it works".

After tests pass, drive the change the way its consumer will: run the actual CLI binary, curl the actual endpoint, load the actual page and click the actual button. Test-level strategy and coverage belong to `testing-tdd.md`; this rule is about the extra step after tests.

**Do:**

```bash
npx vitest run                          # necessary
curl -sf http://localhost:3000/api/projects | head -c 200
# {"projects":[{"id":"p1","name":"demo"}]}   <- sufficient: the wired route responds
```

**Don't:**

```bash
npx vitest run   # all green
# "The new endpoint works." <- the route handler was tested; the route was never hit
```

### VER-005 MUST: Reproduce a bug before fixing it, then rerun the same steps to prove it no longer reproduces

**Why:** Without a reproduction you cannot distinguish "fixed the bug" from "changed code near a bug that was never understood". The before/after pair on identical steps is the only proof that the fix addressed the reported failure and not a coincidental one.

Workflow: (1) execute steps that demonstrate the failure and capture the failing output; (2) implement the fix; (3) execute the identical steps and capture the passing output. Present both. Also encode the reproduction as a regression test where feasible - see `testing-tdd.md`.

**Do:**

```bash
# before fix
node dist/cli.js pull --env "Prod "
# Error: unknown environment "Prod "        <- reproduced

# after fix (same command, verbatim)
node dist/cli.js pull --env "Prod "
# Pulled 12 variables from prod             <- same steps, no longer reproduces
```

**Don't:**

```bash
# never reproduced; fixed by inspection; verified with a different, simpler input
node dist/cli.js pull --env prod   # this always worked - proves nothing about the report
```

**Exception:** Bugs that are impractical to reproduce locally (race under production load). Then say so under VER-003's "cannot verify here" and verify the closest attainable proxy, naming the gap.

### VER-006 MUST: Verify error paths, not only the happy path

**Why:** Error handling is where regressions hide, because the happy path is what everyone runs by default. A change that returns 200 correctly but 500s on bad input, or exits 0 on failure, is broken in the way users will actually notice.

For each change, exercise at least the nearest failure modes: invalid input, missing/expired auth, the not-found case, and - where a downstream dependency exists - its unavailability. Confirm the observable contract: status code, error shape, exit code, log line.

**Do:**

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:3000/api/keys -d '{}'
# 400
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/api/keys
# 401   <- unauthenticated is rejected, not 500
```

**Don't:**

```bash
curl -sf -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/keys
# 200 -> "verified"   <- only the path that was always going to work
```

### VER-007 SHOULD: Verify against the real build artifact when behavior could differ from dev mode

**Why:** Dev servers and dev builds differ from shipped artifacts in ways that change behavior: bundling and tree-shaking, minification, environment-variable inlining, `NODE_ENV` branches, native type stripping (`node script.ts`, flag-free since Node 22.18.0 for erasable syntax) or tsx versus compiled `tsc` output. Node's built-in type stripping ignores `tsconfig.json` and does no type checking, so its behavior can diverge from the compiled artifact. "Works in dev" does not transfer to "works as shipped".

When the change touches anything the build pipeline transforms - imports, env access, dynamic loading, framework config, published CLI entry points - run the production build and verify against its output, not the dev server.

**Do:**

```bash
npm run build && npm run start &
sleep 2 && curl -sf http://localhost:3000/dashboard >/dev/null && echo "prod build OK"
```

**Don't:**

```bash
npm run dev   # verified here only, then shipped
```

**Exception:** Changes provably outside the build pipeline's reach (a test-only file, a script executed directly by Node with no transform step).

### VER-008 MUST: Record evidence as exact commands and outputs, not paraphrase

**Why:** "I ran the tests and they passed" is a memory, not evidence - it cannot be audited, rerun, or checked for the classic failures (wrong directory, wrong filter, exit 0 on zero tests collected). The verbatim command plus the relevant output slice is what lets a reviewer trust or challenge the claim.

Include: the exact command, the directory or environment it ran in if non-obvious, and the output lines that carry the verdict (counts, status codes, exit code). Trim noise; never trim the part that could have contradicted you.

**Do:**

```bash
npx vitest run cli/src/confirm.test.ts
# Test Files  1 passed (1)
# Tests  9 passed (9)
```

**Don't:**

```ts
// "Ran the test suite, everything green."  <- which suite? which filter? zero tests also prints green
```

### VER-009 SHOULD: Maintain a repeatable manual test checklist per user-visible change

**Why:** Verification that lives only in one session's shell history dies with the session. A written checklist - numbered steps, each with an expected observable result - lets the next person (or the same person post-deploy) rerun the exact verification and makes review of the verification itself possible.

Keep the checklists in the repository (for example `docs/manual/`), one per change or PR that alters user-visible behavior. Each step names an action and its expected result; a checklist entry without an expected result is a tour, not a test. Backend-only or doc-only changes may record an explicit not-applicable marker instead - the deliberate skip is itself the record.

**Exception:** Throwaway spikes and prototypes that will not merge.

### VER-010 SHOULD: Commit smoke scripts to the repository instead of re-inventing ad-hoc checks

**Why:** A verification sequence typed fresh each time drifts, gets abbreviated under time pressure, and cannot be run by CI or by teammates. A committed script makes the check cheap, uniform, and honest - it fails loudly instead of being quietly skipped.

Scripts must be safe to run repeatedly (read-only or self-cleaning), exit nonzero on any failed check, and take the target base URL as input so the same script serves local, staging, and production (see VER-011).

**Do:**

```bash
#!/usr/bin/env bash
# scripts/smoke.sh <base-url>
set -euo pipefail
base="${1:?usage: smoke.sh <base-url>}"
curl -sf "$base/api/health" | grep -q '"ok":true'
curl -sf -o /dev/null "$base/login"
echo "smoke OK: $base"
```

**Don't:**

```bash
# retyped from memory each release, different every time, forgotten under pressure
curl $BASE/health ; curl $BASE/loginn   # typo silently checks the wrong route
```

### VER-011 MUST: Run a post-deploy smoke check of the critical path

**Why:** Local and CI verification prove the code; they say nothing about the deploy - wrong environment variables, stale artifact, failed migration, misrouted traffic. The deploy is not done when the pipeline goes green; it is done when the deployed system demonstrably serves the critical path.

Immediately after any deploy, exercise the critical user journey against the deployed environment, and confirm the running version is the one just shipped (a health or version endpoint exposing the commit SHA makes this trivial). A smoke check against the wrong or previous version proves nothing.

**Do:**

```bash
curl -sf https://app.example.com/api/health
# {"ok":true,"commit":"59ef694"}   <- matches the SHA just deployed
scripts/smoke.sh https://app.example.com
# smoke OK: https://app.example.com
```

**Don't:**

```bash
# pipeline green -> post "deployed successfully" -> log off
```

### VER-012 SHOULD: Verify from a clean state when caching or local state could mask failure

**Why:** Stale `node_modules`, build caches, service workers, warm databases, and logged-in browser sessions can make broken code appear to work - the failure only surfaces for the fresh user or the CI machine. A dirty environment verifies the environment, not the change.

When the change touches dependencies, build configuration, migrations, onboarding, or first-run behavior, verify at least once from a state a new consumer would have: clean install, cleared build cache, private browser window, empty or freshly seeded database.

**Do:**

```bash
rm -rf node_modules dist && npm ci && npm run build   # npm ci removes node_modules itself; the explicit rm makes the clean state visible and clears dist too
# succeeds from scratch -> the lockfile and build config are actually sufficient
```

**Don't:**

```bash
npm run build   # passes locally, fails in CI: the missing dep was in node_modules all along
```

**Exception:** Tight inner-loop iteration - clean-state verification is a gate before claiming done (VER-001), not a tax on every edit.

### VER-013 SHOULD: Roll out progressively and observe metrics before declaring the deploy verified

**Why:** A smoke check (VER-011) proves the critical path once, at one moment, with one request; release-related defects - error spikes under real payloads, memory growth, degraded latency - surface only under real traffic. Progressive rollout bounds the blast radius while that evidence accumulates.

Where the platform supports it, deploy to a slice first - canary instance, percentage rollout, feature-flag gate - and watch error rates and the key metrics for a defined observation window before promoting to full traffic. The deploy verdict (VER-003) stays "not yet proven" until the window closes clean.

**Do:**

```bash
deploy --strategy canary --weight 10               # 10% of traffic for 30 minutes
scripts/smoke.sh https://canary.app.example.com    # critical path holds on the canary (VER-011)
# observe: 5xx rate 0.1% (baseline 0.1%), p95 182ms (baseline 178ms) -> promote to 100%
deploy --promote
```

**Don't:**

```bash
deploy --all-at-once && scripts/smoke.sh https://app.example.com
# smoke OK at T+0 -> "verified" -> the T+20min error spike hits 100% of users
```

**Exception:** Platforms with no traffic-splitting mechanism (single-instance apps, CLI releases, package publishes). Verify per VER-011 and watch whatever error reporting exists for an equivalent window.
