---
name: code-organization
description: Large-scale structure, module boundaries, and dependency direction for TypeScript codebases
load_when:
  - "Designing folder structure or module boundaries for a project or feature"
  - "Deciding where a new file, module, type, or test file should live"
  - "Adding or reviewing imports that cross feature or layer boundaries"
  - "Configuring path aliases, barrel files, or boundary-enforcement tooling"
  - "Splitting a large file or module, or extracting code for reuse"
rule_prefix: ORG
---

# Code organization

This file governs how TypeScript code is arranged at scale: directory layout, module boundaries, dependency direction, and the tooling that enforces them. It applies to any TypeScript codebase regardless of framework. Reusable design patterns belong to `reusable-patterns.md`, compiler and language rules to `typescript-language.md`, lint tooling beyond boundary enforcement to `security-and-linting.md`, and multi-package mechanics (workspaces, versioning, publishing) to `monorepo.md`. Framework-specific layout conventions layer on top via `react.md`, `nextjs.md`, and `nodejs.md`.

## Quick reference

| ID | Level | Rule |
|----|-------|------|
| ORG-001 | MUST | Organize code by feature or domain, not by technical layer |
| ORG-002 | SHOULD | Adopt a standard top-level layout with a fixed meaning per directory |
| ORG-003 | MUST | Direct dependencies inward: domain ← application ← infrastructure; UI depends inward |
| ORG-004 | MUST | Give every module a single deliberate entry point that defines its public API |
| ORG-005 | MUST NOT | Deep-import into another module's internals |
| ORG-006 | MUST | Enforce module boundaries mechanically with lint or dependency tooling |
| ORG-007 | MUST NOT | Introduce circular dependencies; detect them in CI |
| ORG-008 | SHOULD | Restrict barrel files to module public APIs; never barrel internal folders |
| ORG-009 | SHOULD | Define path aliases once in tsconfig and mirror them in every consumer tool |
| ORG-010 | SHOULD | Colocate tests, types, and styles with the code they serve |
| ORG-011 | MUST NOT | Create utils/, helpers/, or misc/ dumping grounds; name modules by domain meaning |
| ORG-012 | MUST NOT | Let shared code depend on feature code |
| ORG-013 | SHOULD | Introduce layers inside a feature only when its complexity demands them |
| ORG-014 | SHOULD | Split files and modules when size or cohesion signals fire |
| ORG-015 | SHOULD | Name files and directories consistently: kebab-case, named for their primary export |
| ORG-016 | MAY | Graduate code to a shared package only under proven multi-consumer reuse |

## Rules

### ORG-001 MUST: Organize code by feature or domain, not by technical layer

**Why:** A change request arrives as "modify billing," not "modify controllers"; feature-based structure puts everything a change touches in one place and gives each team a directory it owns. Layer-based top-level structure scatters every feature across the tree and makes ownership and deletion impossible to reason about.

**Do:**
```text
src/
  features/
    billing/
    invoicing/
    user-accounts/
```

**Don't:**
```text
src/
  controllers/
  services/
  models/
  validators/
```

**Exception:** Tiny projects (roughly under ten source files) may stay flat until a second feature appears.

### ORG-002 SHOULD: Adopt a standard top-level layout with a fixed meaning per directory

**Why:** A predictable skeleton lets any engineer or agent locate code without exploration, and gives every new file exactly one correct home. Ambiguity about where things go is how dumping grounds start (see ORG-011).

**Do:**
```text
src/
  features/     # domain modules; each owns its UI, logic, data access (ORG-001)
  shared/       # cross-feature code with domain-meaningful names (ORG-011, ORG-012)
  app/          # composition root: wiring, routing, DI, startup
scripts/        # operational scripts, not imported by src/
tests/          # cross-feature e2e/integration only; unit tests are colocated (ORG-010)
```

**Don't:**
```text
src/
  components/   # some UI here...
  features/     # ...but each feature also has UI
  lib/          # unclear split between lib/, utils/, common/
  utils/
  common/
```

**Exception:** Frameworks with mandated directories (e.g. Next.js `app/`) keep their conventions; put domain code in `features/` (or `modules/`) and keep framework directories thin — see the relevant addendum.

### ORG-003 MUST: Direct dependencies inward: domain ← application ← infrastructure; UI depends inward

**Why:** Domain logic that imports nothing but itself can be tested without mocks, reused under any framework, and survives infrastructure swaps. Every outward import from the domain couples business rules to a vendor or transport detail.

Layer meaning: **domain** = entities, value objects, domain rules, and ports (interfaces); **application** = use cases orchestrating the domain; **infrastructure** = adapters implementing ports (DB, HTTP clients, queues); **UI** = presentation, calling application code. Arrows point inward only — infrastructure and UI may import application and domain; domain imports nothing outside itself.

**Do:**
```ts
// features/billing/domain/payment-gateway.ts — port defined by the domain
export interface PaymentGateway {
  charge(amountCents: number, customerId: string): Promise<void>;
}

// features/billing/infrastructure/stripe-gateway.ts — adapter depends inward
import type { PaymentGateway } from "../domain/payment-gateway";
export class StripeGateway implements PaymentGateway { /* ... */ }
```

**Don't:**
```ts
// features/billing/domain/invoice.ts
import { stripeClient } from "../infrastructure/stripe-client"; // domain reaching outward
```

### ORG-004 MUST: Give every module a single deliberate entry point that defines its public API

**Why:** A module with one curated entry point can refactor its internals freely; a module whose every file is importable has no internals — every file is API and every rename is a breaking change. The entry point is also where you decide what the module deliberately does not expose.

**Do:**
```ts
// features/billing/index.ts — the only file other modules may import
export { chargeCustomer } from "./application/charge-customer";
export { createInvoice } from "./application/create-invoice";
export type { Invoice, InvoiceStatus } from "./domain/invoice";
```

**Don't:**
```ts
// features/billing/index.ts
export * from "./application/charge-customer"; // exposes everything, curates nothing
export * from "./domain/invoice";
export * from "./infrastructure/stripe-gateway"; // adapters are never public API
```

### ORG-005 MUST NOT: Deep-import into another module's internals

**Why:** Deep imports bypass the public API from ORG-004, silently coupling consumers to file layout and private helpers; the owning team can no longer move or rewrite internals without breaking unknown callers.

**Do:**
```ts
import { chargeCustomer } from "@/features/billing";
```

**Don't:**
```ts
import { chargeCustomer } from "@/features/billing/application/charge-customer";
import { toCents } from "@/features/billing/internal/money";
```

**Exception:** Test files may import internals of their own module (colocated tests do this naturally, see ORG-010) — never of another module.

### ORG-006 MUST: Enforce module boundaries mechanically with lint or dependency tooling

**Why:** Boundaries that live only in a document decay with the first rushed PR; a rule the linter enforces is a rule that holds under deadline pressure and against agent-generated code alike. Reviewers should never spend attention on what a machine can reject.

**Do:**
```js
// eslint.config.js — eslint-plugin-boundaries (flat config)
import boundaries from "eslint-plugin-boundaries";

export default [
  {
    plugins: { boundaries },
    settings: {
      "boundaries/elements": [
        { type: "feature", pattern: "src/features/*", capture: ["name"] },
        { type: "shared", pattern: "src/shared/*" }
      ]
    },
    rules: {
      "boundaries/element-types": ["error", {
        default: "disallow",
        rules: [
          { from: "feature", allow: ["shared", "feature"] }, // features use shared and other features…
          { from: "shared", allow: ["shared"] }              // …shared never imports features
        ]
      }],
      "boundaries/entry-point": ["error", {
        default: "disallow",
        rules: [
          // ORG-004/ORG-005: cross-feature imports may only hit the target's entry point
          { target: ["feature"], allow: "index.ts" }
        ]
      }]
    }
  }
];
```

**Don't:**
```text
Boundary rules stated only in README/CONTRIBUTING, checked only in code review.
```

Equivalent tools are acceptable: `eslint-plugin-import-x` (`import-x/no-restricted-paths`; it supersedes `eslint-plugin-import`, whose peer range excludes ESLint 10) or `dependency-cruiser` with rules in CI. Pick one, wire it into the lint step (see `security-and-linting.md` for lint pipeline standards), and encode ORG-003/ORG-005/ORG-012 in it.

### ORG-007 MUST NOT: Introduce circular dependencies; detect them in CI

**Why:** A cycle means two modules are secretly one module: neither can be tested, loaded, or deleted alone, and runtime import order starts producing `undefined` bindings that surface far from the cause. Cycles almost always enter through barrel files (ORG-008) or misplaced shared types.

**Do:**
```bash
# CI: dependency-cruiser with a no-circular rule, alongside the ORG-006 boundary rules
npx depcruise --validate src/   # fails on any cycle
# alternatives: import-x/no-cycle (eslint-plugin-import-x) or skott
# avoid madge: unmaintained since 2024, TypeScript 5-only peer range, known missed cycles
```

**Don't:**
```ts
// features/billing/index.ts
import { notifyInvoicePaid } from "@/features/notifications";
// features/notifications/index.ts
import type { Invoice } from "@/features/billing";  // cycle closed
```

Break cycles by moving the shared type into the module that owns the concept (the other side imports it), or by inverting one direction with an interface or event.

### ORG-008 SHOULD: Restrict barrel files to module public APIs; never barrel internal folders

**Why:** At a module boundary a barrel is the entry point ORG-004 requires; everywhere else it is pure liability — internal barrels create the shortest path to circular imports, drag the whole folder into any bundle that touches one export, and defeat tree-shaking and editor auto-import precision.

**Do:**
```text
features/billing/
  index.ts            # the one barrel: curated public API (ORG-004)
  application/        # no index.ts — files import each other by direct path
  domain/             # no index.ts
```

**Don't:**
```ts
// features/billing/domain/index.ts — internal convenience barrel
export * from "./invoice";
export * from "./payment-gateway";
export * from "./money";
// invoice.ts imports money via "./index" → instant cycle risk
```

### ORG-009 SHOULD: Define path aliases once in tsconfig and mirror them in every consumer tool

**Why:** Aliases like `@/features/billing` keep imports stable when files move and make boundary rules (ORG-006) easy to pattern-match, but only if the compiler, bundler, and test runner agree — a drifted alias produces code that type-checks yet fails at runtime or in tests.

**Do:**
```jsonc
// tsconfig.json — the single source of truth
{ "compilerOptions": { "paths": { "@/*": ["./src/*"] } } }
```

Do not add `baseUrl`: it is deprecated in TypeScript 6 and removed in TypeScript 7, and `paths` has not needed it since TS 4.1. Write every `paths` target with an explicit `./` prefix, relative to the tsconfig.

```ts
// Vite/Vitest pick the aliases up FROM tsconfig — no second copy to drift.
// Vite 8+ has this built in (opt-in):
export default { resolve: { tsconfigPaths: true } };
```
```ts
// Vite 7 and earlier: the plugin does the same job
import tsconfigPaths from "vite-tsconfig-paths";
export default { plugins: [tsconfigPaths()] };
```

Node itself ignores tsconfig `paths`: under its now-default type stripping, or when running `tsc` output directly without a bundler, `@/*` imports fail at runtime. For Node-executed code, use package.json subpath imports as the runtime-native equivalent, or restrict `@/*` aliases to bundler-processed code:

```jsonc
// package.json — subpath imports resolve natively in Node, TypeScript, and bundlers
{ "imports": { "#src/*": "./src/*" } }
// import { createInvoice } from "#src/features/billing";
```

**Don't:**
```jsonc
// jest.config duplicating the map by hand — second source of truth, will drift
{ "moduleNameMapper": { "^@/(.*)$": "<rootDir>/source/$1" } }  // path already wrong
```

Keep the alias set small — one root alias (`@/*`) is usually enough; an alias per feature adds maintenance without adding clarity.

### ORG-010 SHOULD: Colocate tests, types, and styles with the code they serve

**Why:** Files that change together should live together: colocation makes staleness visible (a deleted module takes its tests with it), keeps relative imports short, and lets a reader or agent see a unit's full surface — code, contract, test — in one directory listing.

**Do:**
```text
features/billing/domain/
  invoice.ts
  invoice.test.ts
  invoice.types.ts      # only if types outgrow invoice.ts itself
```

**Don't:**
```text
src/features/billing/domain/invoice.ts
tests/unit/billing/domain/invoice.test.ts   # mirror tree, drifts on every move
types/billing.d.ts                          # global type dumping ground
```

**Exception:** Cross-feature e2e and integration suites that exercise many modules at once belong in a top-level `tests/` directory — they serve no single module. Test content standards live in `testing-tdd.md`.

### ORG-011 MUST NOT: Create utils/, helpers/, or misc/ dumping grounds; name modules by domain meaning

**Why:** A directory named by vagueness accepts anything, so it grows without limit, couples to everything, and can never be split or owned; a directory named by domain meaning has an obvious boundary and an obvious point of eventual extraction (ORG-016).

**Do:**
```text
src/shared/
  currency/format-currency.ts
  dates/business-days.ts
  result/result.ts          # a Result<T, E> type — named for what it is
```

**Don't:**
```text
src/utils/
  helpers.ts        # 900 lines, imported by everything
  misc.ts
  common.ts
```

When a function has no domain-meaningful home, that is a signal it is either dead weight or belongs inside the one feature that uses it — not evidence that a `utils/` folder is needed.

### ORG-012 MUST NOT: Let shared code depend on feature code

**Why:** `shared/` sits below every feature in the dependency graph; the moment it imports a feature, that feature becomes load-bearing for the whole codebase and the graph inverts into a cycle factory. Shared code stays generic precisely because it cannot see who uses it.

**Do:**
```ts
// shared/currency/format-currency.ts — knows nothing about invoices
export function formatCurrency(amountCents: number, currency: string): string { /* ... */ }

// features/billing/application/render-invoice.ts — the feature adapts its data
import { formatCurrency } from "@/shared/currency";
const total = formatCurrency(invoice.totalCents, invoice.currency);
```

**Don't:**
```ts
// shared/formatting/format-invoice-total.ts
import type { Invoice } from "@/features/billing";   // shared now knows a feature
export function formatInvoiceTotal(invoice: Invoice): string { /* ... */ }
```

If shared code needs feature knowledge, the code belongs in the feature. Encode this rule in the boundary tooling from ORG-006.

### ORG-013 SHOULD: Introduce layers inside a feature only when its complexity demands them

**Why:** ORG-003's layer discipline is about dependency direction, not mandatory folders; a three-file feature buried under `domain/application/infrastructure` scaffolding is ceremony that hides the code. Structure should be added at the moment it pays, not preemptively.

**Do:**
```text
features/feedback/            # small feature: flat, direction still respected
  index.ts
  submit-feedback.ts
  feedback.ts                 # types + rules
  feedback-store.ts           # adapter

features/billing/             # large feature: layers earn their keep
  index.ts
  domain/
  application/
  infrastructure/
  ui/
```

**Don't:**
```text
features/feedback/
  domain/feedback.ts          # one file per ceremonial folder
  application/submit-feedback.ts
  infrastructure/feedback-store.ts
```

Adopt layer folders when a feature crosses roughly ten files or two people work in it concurrently; the flat form must still keep domain logic free of outward imports (ORG-003).

### ORG-014 SHOULD: Split files and modules when size or cohesion signals fire

**Why:** Oversized units are where merge conflicts, review fatigue, and agent context overflows concentrate; splitting on explicit signals keeps the decision mechanical instead of a matter of taste.

Split a **file** when any of these hold:
- It exceeds ~300 lines (excluding generated code) or ~5 exports.
- Its exports serve disjoint callers — group A imports one half, group B the other.
- Its test file needs unrelated setup blocks for different exports.

Split a **module** when:
- Its public API (ORG-004) exceeds ~10 exports with no single theme.
- A subset of its files only ever changes together, independently of the rest.
- Two teams keep colliding in it.

Split along the seam the signal reveals (the disjoint caller groups, the co-changing subset) — never into `part1.ts` / `part2.ts`.

**Exception:** Generated files and exhaustive mapping tables (e.g. a locale table) may exceed the size thresholds; exempt them explicitly rather than raising the threshold for everyone.

### ORG-015 SHOULD: Name files and directories consistently: kebab-case, named for their primary export

**Why:** Case-sensitivity differences between filesystems make `Invoice.ts` vs `invoice.ts` a class of bug macOS hides and Linux CI surfaces; a single convention also makes paths predictable enough for tooling and agents to guess correctly.

**Do:**
```text
features/billing/domain/invoice-line-item.ts      # exports InvoiceLineItem
features/billing/application/charge-customer.ts   # exports chargeCustomer
features/billing/domain/invoice.test.ts           # role suffix: .test
```

**Don't:**
```text
features/billing/domain/InvoiceLineItem.ts   # PascalCase file, case-collision risk
features/billing/application/index2.ts       # name says nothing
features/billing/domain/utils.ts             # see ORG-011
```

Use dotted role suffixes (`.test.ts`, `.types.ts`, `.mock.ts`) rather than parallel folders. Framework addenda may override where a framework mandates names (e.g. Next.js `page.tsx`).

### ORG-016 MAY: Graduate code to a shared package only under proven multi-consumer reuse

**Why:** Extracting a package trades import convenience for versioning, publishing, and coordination overhead; paid before reuse is proven, that overhead buys nothing, and speculative packages calcify APIs that were never exercised by a second consumer.

Graduate a module out of `shared/` (or a feature) into its own package only when all of these hold:

- At least two genuinely independent consumers exist — separate deploy units or repos, not two files in one app.
- Its public API (ORG-004) has been stable across recent feature work, not reshaped by every consumer's needs.
- It carries its own tests and can be understood without the host app's context.

Until then, `shared/` inside the app (governed by ORG-011 and ORG-012) is the correct home — moving code within a repo is cheap; unpublishing a package is not. Workspace layout, versioning, and publishing mechanics for the extracted package are governed by `monorepo.md`.
