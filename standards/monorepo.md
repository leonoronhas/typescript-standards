---
name: monorepo
description: Monorepo workspace layout, shared config packages, package boundaries, task orchestration, and versioned publishing for multi-package TypeScript repositories.
load_when:
  - "Setting up or restructuring a multi-package repository (workspaces, apps/, packages/)"
  - "Adding a new package, or importing code across package boundaries in a monorepo"
  - "Configuring shared tsconfig, ESLint, or Prettier packages for a workspace"
  - "Wiring monorepo CI, task running, or build caching (Turborepo, Nx)"
  - "Versioning or publishing packages from a monorepo"
rule_prefix: MONO
---

# Monorepo Standards

This file governs multi-package TypeScript repositories: workspace tooling, lockfile discipline, shared configuration packages, internal package structure, dependency boundaries, task orchestration, and publishing. It layers on top of the core guide and must be read with it: in-package module structure belongs to `code-organization.md`, compiler options themselves to `typescript-language.md`, lint rule content to `security-and-linting.md`, and test standards to `testing-tdd.md`. Framework-specific packages inside the monorepo additionally follow `nodejs.md`, `react.md`, or `nextjs.md`.

## Quick reference

| ID | Level | Rule |
| --- | --- | --- |
| MONO-001 | MUST | Manage all packages with one workspace tool declared at the repository root (pnpm workspaces by default). |
| MONO-002 | MUST | Keep exactly one lockfile, at the repository root; never commit nested lockfiles. |
| MONO-003 | MUST | Name internal packages under a single scope and expose entry points only through an `exports` map. |
| MONO-004 | MUST | Reference internal dependencies with the `workspace:*` protocol. |
| MONO-005 | MUST NOT | Deep-import another package's internal files; import only its declared entry points. |
| MONO-006 | MUST | Declare every imported dependency in the importing package's own `package.json` (no phantom dependencies). |
| MONO-007 | MUST | Extend every package's `tsconfig.json` from a shared base config package. |
| MONO-008 | MUST | Centralize ESLint and formatter configuration in shared config packages consumed by every package. |
| MONO-009 | MUST | Enforce one dependency direction: apps depend on `packages/`; apps never depend on apps. |
| MONO-010 | SHOULD | Keep shared external dependency versions aligned across packages (pnpm catalog or syncpack). |
| MONO-011 | SHOULD | Adopt a task orchestrator with caching (Turborepo or Nx) once tasks depend on other packages' outputs. |
| MONO-012 | SHOULD | Run affected-only CI with remote caching instead of rebuilding the whole repository. |
| MONO-013 | SHOULD | Typecheck packages against built or referenced types, not source reach-ins (project references or per-package builds). |
| MONO-014 | MUST | Version and publish packages through changesets, never by hand-editing versions. |
| MONO-015 | SHOULD | Validate publishable packages with publint and @arethetypeswrong/cli against the packed output in CI before publishing. |

## Rules

### MONO-001 MUST: Manage all packages with one workspace tool declared at the repository root

**Why:** A single workspace declaration gives every package one install step, one dependency graph, and one node_modules strategy; mixing tools or installing per-package fragments the graph and breaks cross-package linking. Choose pnpm workspaces as the default (fastest installs, strictest node_modules); npm or Yarn workspaces are acceptable if the team already standardizes on them — but pick exactly one.

**Do:**

```jsonc
// pnpm-workspace.yaml (repository root)
// packages:
//   - "apps/*"
//   - "packages/*"

// package.json (repository root)
{
  "name": "org-monorepo",
  "private": true,
  "packageManager": "pnpm@11.21.0"   // pin a currently supported major (pnpm 11 requires Node 22+)
}
```

**Don't:**

```bash
# Installing inside one package with a different tool than the root
cd packages/ui && npm install   # root uses pnpm — now two resolution graphs exist
```

**Exception:** A repository that vendors a truly foreign artifact (e.g., a Go service) may keep it outside the workspace globs; every Node/TypeScript package lives inside them.

### MONO-002 MUST: Keep exactly one lockfile, at the repository root

**Why:** The root lockfile is the single source of truth for resolved versions across the whole graph; a nested lockfile silently forks resolution for that package and produces builds that pass locally and fail in CI. The lockfile format must match the workspace tool from MONO-001.

**Do:**

```bash
# Only the root lockfile is tracked
git ls-files | grep -E '(pnpm-lock.yaml|package-lock.json|yarn.lock)$'
# -> pnpm-lock.yaml   (exactly one line, at the root)
```

**Don't:**

```bash
# A stray per-package install left a nested lockfile — remove it, don't commit it
git add packages/ui/package-lock.json   # forks resolution for packages/ui
```

### MONO-003 MUST: Name internal packages under a single scope and expose entry points only through an `exports` map

**Why:** A shared scope (`@org/*`) makes internal imports unambiguous and greppable, and an `exports` map is the package's public API contract — it defines what consumers may import and hides everything else at the resolver level.

**Do:**

```jsonc
// packages/ui/package.json
{
  "name": "@org/ui",
  "type": "module",
  "exports": {
    ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" },
    "./button": { "types": "./dist/button.d.ts", "import": "./dist/button.js" }
  }
}
```

**Don't:**

```jsonc
// packages/ui/package.json
{
  "name": "ui-stuff",          // unscoped, collides with the npm registry namespace
  "main": "./src/index.ts"     // no exports map: every file is importable
}
```

### MONO-004 MUST: Reference internal dependencies with the `workspace:*` protocol

**Why:** `workspace:*` guarantees the dependency resolves to the local package (install fails if it is missing from the workspace) and is rewritten to a real semver range at publish time — a plain version range can silently fetch a stale copy from the registry instead of the local source.

**Do:**

```jsonc
// apps/web/package.json
{
  "dependencies": {
    "@org/ui": "workspace:*"
  }
}
```

**Don't:**

```jsonc
// apps/web/package.json
{
  "dependencies": {
    "@org/ui": "^1.2.0"   // may resolve to the registry, not the sibling package
  }
}
```

### MONO-005 MUST NOT: Deep-import another package's internal files

**Why:** Deep imports bypass the `exports` contract from MONO-003, coupling consumers to the target package's file layout and build output shape; any internal refactor then breaks other packages. If a symbol is needed, export it from an entry point.

**Do:**

```ts
// apps/web/src/page.ts
import { Button } from "@org/ui";
import { formatDate } from "@org/utils/dates"; // "./dates" is a declared exports subpath
```

**Don't:**

```ts
// apps/web/src/page.ts
import { Button } from "@org/ui/src/components/button";   // internal path
import { formatDate } from "../../../packages/utils/src/dates"; // relative reach-in
```

**Exception:** A package may deep-import its own files, and test files may import a sibling's declared test-only subpath (e.g., `@org/ui/testing`) when that subpath is listed in `exports`.

### MONO-006 MUST: Declare every imported dependency in the importing package's own `package.json`

**Why:** An import that works only because another package hoisted it (a phantom dependency) breaks the moment the hoisting changes or the package is published or built in isolation. pnpm's default non-flat node_modules enforces this at resolve time — keep that strictness on.

**Do:**

```jsonc
// packages/api-client/package.json — zod is imported, so zod is declared here
{
  "name": "@org/api-client",
  "dependencies": { "zod": "catalog:" }
}
```

**Don't:**

```yaml
# pnpm-workspace.yaml — reintroduces phantom dependencies by flattening node_modules
# (pnpm 11+ reads these settings only here; .npmrc carries auth/registry settings only)
shamefullyHoist: true
nodeLinker: hoisted
```

**Exception:** Genuinely shared singletons that must not be duplicated (e.g., `react`) belong in `peerDependencies` of library packages — still declared, just in the correct field.

### MONO-007 MUST: Extend every package's `tsconfig.json` from a shared base config package

**Why:** Compiler strictness must be identical across the repository, or code moves between packages and changes meaning; a base config package makes every option change a single reviewed edit. What the strict options are is defined in `typescript-language.md` — this rule only fixes where they live.

**Do:**

```jsonc
// packages/tsconfig/base.json  (package @org/tsconfig)
{ "compilerOptions": { "strict": true, "module": "NodeNext", "moduleResolution": "NodeNext" } }

// packages/api-client/tsconfig.json
{
  "extends": "@org/tsconfig/base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src"]
}
```

**Don't:**

```jsonc
// packages/api-client/tsconfig.json — a private fork of compiler behavior
{ "compilerOptions": { "strict": false, "target": "ES2017" } }
```

**Exception:** Per-package overrides are limited to path-shaped options (`outDir`, `rootDir`, `include`, `references`) and environment `lib`/`types`; never weaken strictness locally.

### MONO-008 MUST: Centralize ESLint and formatter configuration in shared config packages consumed by every package

**Why:** Per-package lint and formatter forks drift immediately and turn every cross-package diff into a formatting war; a config package versions the ruleset like any other dependency. Prettier is the worked example below; the formatter choice itself (Prettier or Biome — pick one) is governed by SEC-017 in `security-and-linting.md`, as are lint rule content and security plugins.

**Do:**

```ts
// packages/eslint-config/index.ts  (package @org/eslint-config)
export default [/* shared flat config */];

// packages/prettier-config/index.js  (package @org/prettier-config)
export default { /* shared formatter options */ };

// apps/web/eslint.config.js
import org from "@org/eslint-config";
export default [...org];

// apps/web/package.json — consume the shared formatter config
// "prettier": "@org/prettier-config"
```

**Don't:**

```js
// apps/web/eslint.config.js — redefines rules locally instead of extending @org/eslint-config
// (legacy .eslintrc.* forks are worse still: ESLint 10 ignores eslintrc files entirely)
export default [{ rules: { "no-unused-vars": "off" } }];
```

**Exception:** A package may append rules that only make sense for its runtime (e.g., React hooks rules in UI packages) on top of the shared base — appending, never overriding the base to be weaker.

### MONO-009 MUST: Enforce one dependency direction: apps depend on packages, never on other apps

**Why:** Apps are deployment endpoints, not libraries; an app-to-app import couples release cycles and creates cycles no build orchestrator can schedule. Anything two apps need lives in `packages/` and flows downward.

**Do:**

```ts
// apps/admin/src/billing.ts
import { computeInvoice } from "@org/billing"; // shared logic promoted to packages/billing
```

**Don't:**

```ts
// apps/admin/src/billing.ts
import { computeInvoice } from "../../web/src/lib/invoice"; // app reaching into another app
```

Enforce mechanically, not by review memory — e.g., dependency-cruiser or Nx `enforce-module-boundaries` with tags (`app` may depend on `lib`; `lib` may not depend on `app`), run in CI.

### MONO-010 SHOULD: Keep shared external dependency versions aligned across packages

**Why:** Two packages resolving different versions of the same library cause duplicate bundles, incompatible types, and singleton bugs (two React copies, two zod instances across a validation boundary). Pin shared externals once and reference that pin everywhere. The catalog entry plus the single root lockfile (MONO-002) provides the application-level exact pinning that SEC-006 in `security-and-linting.md` requires, so caret ranges in the catalog are acceptable.

**Do:**

```jsonc
// pnpm-workspace.yaml
// catalog:
//   zod: ^4.0.0
//   react: ^19.0.0

// packages/api-client/package.json
{ "dependencies": { "zod": "catalog:" } }
```

**Don't:**

```jsonc
// packages/api-client: "zod": "^3.24.0"
// packages/forms:      "zod": "^3.21.0"   // silent split — two zod instances
```

**Exception:** A deliberate staged upgrade may pin one package to a newer major temporarily; record the intent and a removal deadline in that package's `package.json` comment or the migration issue. If pnpm's catalog is unavailable (npm/yarn workspaces), enforce alignment with syncpack in CI.

### MONO-011 SHOULD: Adopt a task orchestrator with caching once tasks depend on other packages' outputs

**Why:** The moment `apps/web` needs `@org/ui` built first, ad-hoc npm scripts either over-build everything or race; an orchestrator (Turborepo or Nx) derives task order from the workspace graph and caches outputs by input hash. Before that point, plain workspace scripts are fine — adopt the tool when the graph appears, not speculatively.

**Do:**

```jsonc
// turbo.json (repository root)
{
  "tasks": {
    "build": { "dependsOn": ["^build"], "outputs": ["dist/**"] },
    "test": { "dependsOn": ["build"] }
  }
}
```

**Don't:**

```jsonc
// package.json — hand-ordered, uncached, rebuilds the world every run
{ "scripts": { "build": "pnpm -r --sort run build && pnpm -r run test" } }
```

### MONO-012 SHOULD: Run affected-only CI with remote caching

**Why:** Building and testing every package on every commit scales linearly with repository size and quickly dominates CI time; the workspace graph already knows exactly which packages a change can affect. Remote caching makes unaffected tasks free even when they are scheduled. Graph-derived affected filtering satisfies TDD-014 in `testing-tdd.md` (CI executes the complete suite on every PR) only when unaffected packages' build and test results are replayed from a verified remote cache: on every PR, every test is either executed or replayed from a cache entry keyed to identical inputs. Plain path-filtering without remote cache verification skips tests instead of replaying them and is forbidden.

**Do:**

```bash
# CI: run build + test only for packages affected since the merge base, with remote cache
turbo run build test --affected   # TURBO_SCM_BASE overrides the default comparison base
# Nx equivalent: nx affected -t build test --base=origin/main
```

**Don't:**

```bash
# CI: full rebuild of every package on every push
pnpm -r run build && pnpm -r run test

# CI: workflow path filters with no verified remote cache — tests are
# skipped outright, not replayed; violates TDD-014 in testing-tdd.md
# on.pull_request.paths: ["packages/ui/**"]
```

**Exception:** Release pipelines and a scheduled (e.g., nightly) full run still build everything — affected-only is a pull-request optimization, not the only verification. Test standards themselves are governed by `testing-tdd.md`.

### MONO-013 SHOULD: Typecheck packages against built or referenced types, not source reach-ins

**Why:** When consumers typecheck against a package's emitted `.d.ts` (or a TypeScript project reference), the package boundary is real: its `exports` map and public types are what is checked, and `tsc` can build incrementally in dependency order. Resolving straight into a sibling's `src/` via `paths` hides boundary breaks until publish.

**Do:**

```jsonc
// packages/api-client/tsconfig.json
{
  "extends": "@org/tsconfig/base.json",
  "compilerOptions": { "composite": true, "outDir": "dist", "rootDir": "src" },
  "references": [{ "path": "../utils" }]
}
```

**Don't:**

```jsonc
// apps/web/tsconfig.json — aliasing the scope straight into sibling source
{ "compilerOptions": { "paths": { "@org/*": ["../../packages/*/src"] } } }
```

**Exception:** App-only monorepos may use just-in-time packages whose `exports` point at `.ts` source compiled by the app's bundler — acceptable while nothing is published, but the `exports` map from MONO-003 remains the only sanctioned entry point.

### MONO-014 MUST: Version and publish through changesets

**Why:** Hand-edited versions skip semver review, changelogs, and dependent-package bumps; changesets records intent (patch/minor/major plus a summary) alongside the code change and mechanically propagates version bumps through internal dependents at release time. The changeset file authored in the change PR is the changelog entry required by DOC-010 in `documentation.md` — it satisfies the written-in-the-PR requirement — and the changesets-generated CHANGELOG format is the accepted format for published monorepo packages. pnpm 11.11+ ships native release management (`pnpm change` / `pnpm lane`); this guide standardizes on changesets until that tooling matures, and a repository must never mix the two mechanisms.

**Do:**

```bash
pnpm changeset            # in the PR: pick bump level, write the summary
pnpm changeset version    # release PR: applies bumps + writes CHANGELOGs
pnpm changeset publish    # CI: publishes exactly the bumped packages
```

**Don't:**

```bash
# Bump by hand and publish from a laptop
sed -i '' 's/"1.2.0"/"1.3.0"/' packages/ui/package.json && npm publish
```

**Exception:** Packages that are never published (`"private": true` apps and internal-only tools) do not need changesets entries; the moment a package is published anywhere (npm, a private registry), this rule applies.

### MONO-015 SHOULD: Validate publishable packages with publint and @arethetypeswrong/cli against the packed output

**Why:** An `exports` map (MONO-003) that typechecks in the workspace can still ship broken: files missing from the tarball, `types` conditions no module resolution mode actually resolves, ESM/CJS mismatches only a consumer sees. publint validates the manifest against the actual packed contents, and @arethetypeswrong/cli resolves the package the way TypeScript consumers do under each resolution mode — mechanically closing the hides-until-publish gap MONO-013 warns about, before `changeset publish` runs.

**Do:**

```bash
# CI, in each publishable package, before changeset publish
pnpm publint            # manifest vs. packed files: exports, main, types
pnpm attw --pack .      # packs the tarball itself, then checks consumer-side type resolution
```

**Don't:**

```bash
# Publish on green typecheck alone — workspace resolution hides tarball breakage
pnpm changeset publish   # the first consumer install becomes the first real exports test
```

**Exception:** Private (`"private": true`) apps and internal-only tools are never packed for consumers and are exempt.
