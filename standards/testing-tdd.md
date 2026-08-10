---
name: testing-tdd
description: Test-driven development workflow, test pyramid selection, and test quality standards for TypeScript projects
load_when:
  - "Implementing new behavior or a new feature"
  - "Fixing a bug or regression"
  - "Writing, reviewing, or refactoring test code"
  - "Choosing between unit, integration, and e2e tests"
  - "Configuring test runs in CI or handling flaky tests"
  - "Evaluating code coverage or test quality"
rule_prefix: TDD
---

# Testing and Test-Driven Development

This file governs how tests drive development and how test code is written, structured, and kept trustworthy: the red-green-refactor loop, test-level selection, test structure and naming, test doubles, determinism, coverage discipline, and CI hygiene. It deliberately leaves static analysis and lint gates to `security-and-linting.md`, evidence-based manual verification of running systems to `live-verification.md`, component and hook testing utilities to `react.md` (REACT-018), and test-file placement (colocation vs. a top-level `tests/`) to `code-organization.md` (ORG-010). Where a framework addendum names a concrete test tool, these rules still govern how that tool is used.

## Quick reference

| ID | Level | Rule |
|----|-------|------|
| TDD-001 | MUST | Write the failing test first and watch it fail |
| TDD-002 | MUST | Write the minimum code to reach green, then refactor on green |
| TDD-003 | MUST | Start every bug fix with a failing reproduction test |
| TDD-004 | SHOULD | Pick the smallest test level that proves the behavior |
| TDD-005 | MUST | Structure every test as Arrange-Act-Assert |
| TDD-006 | MUST | Test one behavior per test |
| TDD-007 | MUST | Name tests after the behavior, not the function under test |
| TDD-008 | MUST | Make every test deterministic: inject clock, randomness, and network |
| TDD-009 | SHOULD | Prefer hand-written fakes and stubs over deep mocks |
| TDD-010 | MUST NOT | Mock third-party code you do not own |
| TDD-011 | MUST | Hold test code to production standards |
| TDD-012 | MUST NOT | Write tests whose only purpose is to raise coverage |
| TDD-013 | MUST NOT | Use snapshot tests as a substitute for explicit assertions |
| TDD-014 | MUST | Run the full test suite in CI on every pull request |
| TDD-015 | MUST | Fix or quarantine a flaky test the same day it flakes |
| TDD-016 | SHOULD | Add type-level tests for published type signatures |
| TDD-017 | MAY | Use property-based testing for algorithmic code |

## Rules

### TDD-001 MUST: Write the failing test first and watch it fail

**Why:** A test that has never failed proves nothing — it may be asserting the wrong thing, testing dead code, or passing vacuously. Seeing it fail for the expected reason is the only evidence the test can detect the defect it exists to catch.

For any NEW behavior, follow red-green-refactor: write the test before the implementation exists, run it, and confirm it fails because the behavior is missing — not because of a typo, a missing import, or a broken fixture. Only then write implementation code.

**Do:**

```ts
// 1. Test written before validateCart has any quantity check.
it("rejects a cart containing a negative quantity", () => {
  const cart = buildCart({ items: [buildItem({ sku: "A1", qty: -1 })] });
  expect(() => validateCart(cart)).toThrow(InvalidQuantityError);
});
// 2. Run it. Confirm the failure is "InvalidQuantityError was not thrown",
//    i.e. the missing behavior — then implement.
```

**Don't:**

```ts
// Implementation written first; test added after and never seen red.
it("validates carts", () => {
  expect(validateCart(buildCart())).toBeUndefined(); // green on first run — proves nothing
});
```

**Exception:** Pure refactors of already-tested behavior need no new red test — the existing suite staying green is the point (see TDD-002).

### TDD-002 MUST: Write the minimum code to reach green, then refactor on green

**Why:** Code written beyond what the failing test demands is untested by construction and speculative by definition. Separating "make it pass" from "make it clean" keeps both steps safe: the refactor happens under a green suite that catches regressions.

Implement only what the red test requires. Once green, refactor freely — rename, extract, deduplicate — while keeping the suite green after every step. New capability means a new failing test first (TDD-001), never opportunistic additions during green.

**Don't:**

```ts
// The failing test only requires the 10+ unit discount, but the "fix"
// ships speculative knobs no test exercises:
function priceCart(
  cart: Cart,
  opts?: { currency?: string; roundingMode?: "up" | "down" },
) {
  /* ... */
}
```

### TDD-003 MUST: Start every bug fix with a failing reproduction test

**Why:** A reproduction test proves you understand the actual defect, and it permanently prevents the same regression. A fix without one is a guess that can silently un-fix itself.

Translate the bug report into the smallest automated test that fails the same way the report describes. Watch it fail, fix the code, watch it pass, and keep the test forever. If the bug cannot be reproduced in a test at any level of the pyramid, say so explicitly and record why — do not skip silently.

**Do:**

```ts
// Bug report: totals wrong for carts of exactly 100 items.
it("prices a cart of exactly 100 items correctly", () => {
  const items = Array.from({ length: 100 }, () => buildItem({ qty: 1, unitCents: 50 }));
  expect(priceCart(buildCart({ items }))).toBe(5000);
});
// Run: fails with the reported wrong total. Now fix priceCart.
```

### TDD-004 SHOULD: Pick the smallest test level that proves the behavior

**Why:** Small tests fail fast, fail precisely, and run cheaply; every level you escalate adds runtime, flake surface, and diagnostic distance from the defect. A suite skewed toward e2e is slow, fragile, and vague about what broke.

Target roughly the pyramid: unit ~70%, integration ~25%, e2e ~5%.

- **Unit** — pure logic: parsers, validators, reducers, pricing rules. No I/O, no framework runtime.
- **Integration** — the behavior lives in a real boundary crossing (database, auth library, queue, filesystem), exercised against a local or in-memory substrate.
- **E2E** — a cross-component user journey that only exists end to end (sign-up through first action, checkout and return flow, session-cookie redirects).

Ask: what is the smallest test that can fail *for the reason I care about*? Write that one. Escalate only when the behavior genuinely lives in the seam, not because the higher level feels more "real."

### TDD-005 MUST: Structure every test as Arrange-Act-Assert

**Why:** A fixed three-phase shape makes any test skimmable in seconds and makes structural smells — multiple acts, assertions on setup, act-assert ping-pong — visually obvious.

Arrange the state, perform exactly one act, then assert on the outcome. Blank lines (or `// Arrange` / `// Act` / `// Assert` comments in longer tests) separate the phases.

**Do:**

```ts
it("applies the bulk discount at 10 or more units", () => {
  // Arrange
  const cart = buildCart({ items: [buildItem({ qty: 10, unitCents: 100 })] });
  // Act
  const total = priceCart(cart);
  // Assert
  expect(total).toBe(900);
});
```

**Don't:**

```ts
it("discount", () => {
  const cart = buildCart();
  expect(cart.items).toHaveLength(0);       // asserting on setup
  cart.items.push(buildItem({ qty: 10 }));  // act
  expect(priceCart(cart)).toBe(900);        // assert
  cart.items.push(buildItem({ qty: 1 }));   // second act — new behavior, same test
  expect(priceCart(cart)).toBe(1000);
});
```

### TDD-006 MUST: Test one behavior per test

**Why:** Test runners stop a test at its first failing assertion, so a multi-behavior test hides every failure after the first — and its name cannot identify which behavior broke.

One test, one behavior, one reason to fail. Multiple assertions are fine when they all describe facets of the same single outcome; assertions about unrelated behaviors are not.

**Do:**

```ts
it("prices an empty cart at zero", () => {
  expect(priceCart(buildCart())).toBe(0);
});

it("rejects a cart containing a negative quantity", () => {
  const cart = buildCart({ items: [buildItem({ qty: -1 })] });
  expect(() => priceCart(cart)).toThrow(InvalidQuantityError);
});
```

**Don't:**

```ts
it("handles carts", () => {
  expect(priceCart(buildCart())).toBe(0);
  expect(priceCart(discountedCart)).toBe(900);
  expect(() => priceCart(negativeQtyCart)).toThrow(); // never reached if line 2 fails
});
```

### TDD-007 MUST: Name tests after the behavior, not the function under test

**Why:** When a test fails in CI, its name is the first — often only — line a reader sees. "returns 404 when the project does not exist" diagnoses itself; "test getProject" diagnoses nothing.

State the observable behavior and, where relevant, the condition: *does X when Y*. The function name may appear in the `describe` block; the `it` string describes behavior in plain language.

**Do:**

```ts
describe("findUser", () => {
  it("returns null when no user has the given email", () => { /* ... */ });
  it("matches the email case-insensitively", () => { /* ... */ });
});
```

**Don't:**

```ts
describe("findUser", () => {
  it("test findUser", () => { /* ... */ });
  it("works", () => { /* ... */ });
});
```

### TDD-008 MUST: Make every test deterministic: inject clock, randomness, and network

**Why:** A test that reads the real clock, real entropy, or the real network has an input you do not control, so its verdict varies between runs and machines. Nondeterminism is the root cause of flakes (see TDD-015).

Pass time, randomness, and I/O in as parameters (or use the runner's fake timers) so the test fixes every input. Real network calls belong only in e2e tests against environments provisioned for them — never in unit or integration tests.

**Do:**

```ts
function isExpired(token: Token, now: () => Date = () => new Date()): boolean {
  return token.expiresAt.getTime() < now().getTime();
}

it("treats a token that expired one second ago as expired", () => {
  const fixedNow = () => new Date("2026-01-01T00:00:00Z");
  const token = buildToken({ expiresAt: new Date("2025-12-31T23:59:59Z") });
  expect(isExpired(token, fixedNow)).toBe(true);
});
```

**Don't:**

```ts
it("expires tokens", () => {
  const token = buildToken({ expiresAt: new Date(Date.now() - 1000) }); // real clock
  expect(isExpired(token)).toBe(true); // timing-dependent: flakes under load or a paused debugger
});
```

### TDD-009 SHOULD: Prefer hand-written fakes and stubs over deep mocks

**Why:** A fake with real (simplified) behavior lets tests assert outcomes; a deep mock forces tests to assert call sequences, welding them to the current implementation so any behavior-preserving refactor breaks them.

Write a small in-memory fake per port (repository, gateway, mailer) and reuse it across the suite. Reserve mock-function spies for genuinely interaction-shaped behavior — "sends exactly one email" — not as the default double.

**Do:**

```ts
class InMemoryUserRepo implements UserRepo {
  private users = new Map<string, User>();
  async save(user: User): Promise<void> { this.users.set(user.id, user); }
  async findById(id: string): Promise<User | null> { return this.users.get(id) ?? null; }
}

it("activates a pending user", async () => {
  const repo = new InMemoryUserRepo();
  await repo.save(buildUser({ id: "u1", status: "pending" }));
  await activateUser(repo, "u1");
  expect((await repo.findById("u1"))?.status).toBe("active");
});
```

**Don't:**

```ts
// Asserts the call choreography, not the outcome — breaks on any refactor.
const repo = {
  save: vi.fn(),
  findById: vi.fn().mockResolvedValueOnce(buildUser({ id: "u1", status: "pending" })),
};
await activateUser(repo as unknown as UserRepo, "u1");
expect(repo.findById).toHaveBeenCalledWith("u1");
expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({ status: "active" }));
```

### TDD-010 MUST NOT: Mock third-party code you do not own

**Why:** Mocking a vendor SDK encodes your guesses about behavior you do not control, and couples every test to an API surface that changes on the vendor's schedule. When the guess is wrong, the tests stay green while production breaks.

Wrap the dependency behind an interface you define (see `code-organization.md` for boundary placement), then fake the wrapper. Verify the thin adapter itself with a small number of integration tests against the vendor's local emulator or sandbox — not with mocks.

**Do:**

```ts
// Your interface, sized to what the app needs.
interface PaymentGateway {
  charge(cents: number, customerId: string): Promise<{ chargeId: string }>;
}

// Test double is a fake of YOUR interface.
class FakePaymentGateway implements PaymentGateway {
  charges: Array<{ cents: number; customerId: string }> = [];
  async charge(cents: number, customerId: string) {
    this.charges.push({ cents, customerId });
    return { chargeId: `ch_${this.charges.length}` };
  }
}
```

**Don't:**

```ts
// Guessing at the vendor SDK's shape and behavior.
vi.mock("stripe", () => ({
  default: vi.fn(() => ({ charges: { create: vi.fn().mockResolvedValue({ id: "ch_1" }) } })),
}));
```

**Exception:** Transport-level stubbing of your own HTTP boundary (e.g. an msw handler for your API's contract) is faking a contract you own, not mocking vendor internals.

### TDD-011 MUST: Hold test code to production standards

**Why:** Tests are the code's executable specification and outlive most implementations; a sprawl of copy-pasted 40-line fixtures makes every schema change a mass edit and trains the team to distrust and skip tests.

Apply the same review bar as production code: no duplication, clear naming, typed helpers. Centralize object construction in builder functions with per-test overrides, so each test states only the fields relevant to its behavior.

**Do:**

```ts
// test/builders.ts — one canonical builder per aggregate.
export function buildOrder(overrides: Partial<Order> = {}): Order {
  return { id: "o1", status: "open", items: [], totalCents: 0, ...overrides };
}

// In a test: only the relevant field is stated.
const order = buildOrder({ status: "shipped" });
```

**Don't:**

```ts
// Full object literal copy-pasted into every test file; every schema
// change now touches dozens of tests that never cared about the field.
const order: Order = {
  id: "o1",
  status: "open",
  items: [],
  totalCents: 0,
  // ...plus every other required field, duplicated per test
};
```

### TDD-012 MUST NOT: Write tests whose only purpose is to raise coverage

**Why:** Coverage measures which lines executed, not which behaviors are verified; an assertion-free test raises the number while adding zero defect-detection power, and worse, it makes the metric lie to everyone who reads it.

Treat coverage as a signal for finding untested branches: inspect an uncovered branch, decide whether a behavior lives there, and write a real behavior test (or delete the dead code — see `security-and-linting.md` for dead-code tooling). Never set a coverage percentage as a goal that tests are written "for."

**Don't:**

```ts
it("covers exportReport", async () => {
  await exportReport(buildReport()); // no assertions: executes lines, verifies nothing
});
```

**Exception:** A ratchet that fails CI when coverage *drops* is legitimate — it detects untested new code without making the percentage a target to chase.

### TDD-013 MUST NOT: Use snapshot tests as a substitute for explicit assertions

**Why:** A large snapshot asserts everything and therefore effectively nothing: every incidental change fails it, the team learns to press "update" reflexively, and real regressions ride through in the noise.

Reserve snapshots for output that is genuinely a stable serialized artifact — generated config, codegen output, CLI help text — where the whole byte-for-byte content is the contract and diffs are small enough to be read in review. For everything else, assert the specific properties the test is about.

**Do:**

```ts
// The generated config file IS the deliverable; its exact content is the contract.
it("emits the tsconfig for a library package", () => {
  expect(generateTsconfig({ kind: "library" })).toMatchSnapshot();
});
```

**Don't:**

```ts
it("renders the dashboard", () => {
  expect(renderDashboard(state)).toMatchSnapshot(); // 400-line blob nobody reads;
  // the real assertion ("shows the overdue banner") is buried and unverified
});
```

### TDD-014 MUST: Run the full test suite in CI on every pull request

**Why:** Locally scoped runs and path-filtered CI both let cross-module regressions land unseen; the pull request is the last gate where the whole suite can veto a change cheaply.

CI executes the complete suite — unit, integration, and e2e — on every PR, and a red suite blocks merge with no manual override as routine practice. Keep the suite fast enough that running all of it stays viable; speed problems are fixed with smaller tests (TDD-004) and parallelism, not by skipping tests.

**Do:**

```bash
# CI runs the same entry point developers run locally — no curated subset.
npm test          # e.g. "vitest run" — entire suite, no path filters
npm run test:e2e  # e2e suite on every PR, not nightly-only
```

**Exception:** Splitting the suite across parallel CI shards is fine — the requirement is that every test runs before merge, not that one process runs them. Affected-only CI runs in a monorepo (see `monorepo.md` MONO-012) count as running the full suite ONLY when unaffected packages' test results are replayed from a verified remote cache, so every test is executed or cache-replayed on every PR.

### TDD-015 MUST: Fix or quarantine a flaky test the same day it flakes

**Why:** One tolerated flake teaches the team to rerun red builds, and from then on the suite's verdict is negotiable — which is the end of its value. Automatic retries institutionalize that: they convert real intermittent defects into green checkmarks.

The moment a test shows a nondeterministic verdict: reproduce it (loop the test), fix the root cause (usually a violation of TDD-008), or quarantine it the same day with an explicit skip, an owner, and a tracking issue. Never configure blanket retries to make flakes pass.

**Do:**

```ts
// Quarantined 2026-08-08: order-dependent under parallel run — issue #482.
// Owner: payments team. Fix or delete within one sprint.
it.skip("syncs seat counts after concurrent invites", async () => { /* ... */ });
```

**Don't:**

```ts
// vitest.config.ts — retries convert intermittent defects into green builds.
export default defineConfig({
  test: { retry: 3 },
});
```

**Exception:** A narrowly scoped retry on an e2e step that exercises a third-party sandbox outside your control may be acceptable — only with the flake documented in a tracking issue, never as a global default.

### TDD-016 SHOULD: Add type-level tests for published type signatures

**Why:** For a library, exported types are API: a widened parameter, a lost generic inference, or an accidentally-`any` return breaks consumers with zero runtime test failing. Type-level tests make the compiler assert the contract.

Use `expectTypeOf` (vitest / expect-type) or `tsd` to pin exact types of public exports, and `@ts-expect-error` to pin what must NOT compile. Strongly recommended for published libraries; optional for application-internal types.

**Do:**

```ts
import { expectTypeOf } from "expect-type";

it("parseEvent narrows to the event union", () => {
  expectTypeOf(parseEvent).returns.toEqualTypeOf<UserEvent | SystemEvent>();
  // @ts-expect-error — an empty object lacks the required discriminant
  parseEvent({});
});
```

**Exception:** Purely internal application code gets this for free from strict compilation (see `typescript-language.md`); dedicated type tests there are usually redundant.

### TDD-017 MAY: Use property-based testing for algorithmic code

**Why:** Example-based tests check the inputs you thought of; property-based tests generate thousands you did not, and shrink failures to a minimal counterexample. For parsers, serializers, and math-like code, invariants catch edge cases examples miss.

Use `fast-check` to state invariants — round-trips, idempotence, ordering, commutativity — over generated inputs. Keep the properties alongside, not instead of, a few readable example tests that document typical behavior.

**Do:**

```ts
import fc from "fast-check";

it("slugification is idempotent for any input string", () => {
  fc.assert(
    fc.property(fc.string(), (input) => {
      const once = toSlug(input);
      expect(toSlug(once)).toBe(once);
    }),
  );
});
```
