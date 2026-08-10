# TypeScript Standards — Router

This folder is a TypeScript standards guide engineered for selective loading: match your task against the index below, load **only** the file(s) that apply, and follow their rules. Every rule has a stable ID (e.g. `TS-003`) — cite IDs when applying, enforcing, or deviating from a rule. Do not load the whole guide to answer a narrow question.

## How to use this guide

1. **Match the task, not the topic.** Scan the *Load when* column (each file's frontmatter `load_when` list is the authoritative, fuller version). Load every file whose trigger matches the task at hand — usually one or two.
2. **Scan cheap, read deep.** Each file opens with a *Quick reference* table of all its rules (ID, level, one-line imperative). Use it to find the relevant rule, then read that rule's full body (`### <ID> <LEVEL>: …`) — each rule body is self-contained.
3. **Cite rule IDs** in reviews, commit discussions, and agent output so decisions are auditable (`per SEC-004…`, `deviating from ORG-008 because…`).
4. **Grep works.** Rule IDs are unique across the guide; `grep -rn "TS-016" standards/` finds a rule's one definition.

## Rule levels (RFC 2119 semantics)

| Level | Meaning |
| --- | --- |
| MUST / MUST NOT | Non-negotiable. Deviation requires explicit human sign-off, recorded where the deviation lives. |
| SHOULD | The default. Deviate only with a stated, reviewable reason. |
| MAY | Genuinely optional; listed because it is the recommended form *when* you do it. |

## Index

### Core standards (apply to every TypeScript project, any framework)

| File | Prefix | Rules | Governs | Load when |
| --- | --- | --- | --- | --- |
| [standards/code-organization.md](standards/code-organization.md) | ORG | 16 | Large-scale structure, module boundaries, dependency direction | Designing folder structure; deciding where code and its test/type/style files live (colocation); imports crossing feature/layer boundaries; path aliases, barrels, splitting modules |
| [standards/reusable-patterns.md](standards/reusable-patterns.md) | PAT | 15 | Typed design patterns and when *not* to abstract | Extracting shared abstractions; choosing factory/builder/strategy/repository; error-handling design; wiring dependencies; modeling domain state |
| [standards/typescript-language.md](standards/typescript-language.md) | TS | 25 | Language + compiler rules: strict tsconfig, type modeling, narrowing, assertions, naming | Writing any TS source; editing tsconfig; designing types/unions/enums; typing trust-boundary data; reviewing for type safety |
| [standards/security-and-linting.md](standards/security-and-linting.md) | SEC | 22 | Vulnerability scanning, supply chain, input validation, injection defense, lint/format/CI gates | Adding or auditing dependencies; handling external input; shell/SQL/regex/filesystem code; ESLint/formatter/pre-commit/CI setup; secrets and .env |
| [standards/documentation.md](standards/documentation.md) | DOC | 14 | TSDoc, comments, READMEs, ADRs, changelogs, examples, LLM-retrievable docs | Writing doc comments; creating/restructuring READMEs, ADRs, changelogs; publishing packages; adding examples or diagrams; organizing docs for retrieval |
| [standards/testing-tdd.md](standards/testing-tdd.md) | TDD | 17 | Test-driven development loop, test pyramid, test quality | Implementing new behavior; fixing bugs; writing or reviewing tests; choosing unit vs integration vs e2e; CI test runs, flakes, coverage |
| [standards/live-verification.md](standards/live-verification.md) | VER | 12 | Evidence-based verification: prove it live before claiming done | About to claim done/fixed/working; reporting implementation status; confirming a bug fix; deploying; writing smoke checklists |

### Stack addenda (load *in addition to* the core when the stack matches)

| File | Prefix | Rules | Governs | Load when |
| --- | --- | --- | --- | --- |
| [standards/nodejs.md](standards/nodejs.md) | NODE | 16 | Node runtime: process lifecycle, config, logging, async discipline, inbound/outbound I/O | Writing Node backend code; service setup; env/config/logging; promises and shutdown; HTTP calls, child processes, large payloads |
| [standards/react.md](standards/react.md) | REACT | 18 | Components, hooks, state, context, forms, accessibility, component testing | Writing/reviewing React components or hooks; props/state design; server data fetching; re-render/effect debugging; forms, context, a11y |
| [standards/nextjs.md](standards/nextjs.md) | NEXT | 14 | App Router: server/client boundaries, secrets, server actions, caching, routing | Any work in a Next.js project: `use client` placement, server actions, route handlers, caching/revalidation, env handling, app/ conventions |
| [standards/monorepo.md](standards/monorepo.md) | MONO | 14 | Workspaces, shared config packages, package boundaries, orchestration, publishing | Multi-package repos: adding packages, cross-package imports, shared tsconfig/lint config, CI/task caching, versioning and publishing |

## Precedence

1. **Project-local instructions win.** A repo's own CLAUDE.md / AGENTS.md / documented conventions override this guide where they conflict — but surface the conflict rather than silently ignoring the standard.
2. **Addenda over core.** Where a stack addendum tightens or specializes a core rule for its stack, the addendum wins (it is the more specific rule).
3. **More specific addendum over more general.** When two addenda both apply, the more stack-specific one wins — e.g. in a Next.js project, `nextjs.md` overrides `nodejs.md` where they conflict (NEXT-008/NEXT-009 override NODE-003's module-scope env parse).
4. **MUST over SHOULD.** When two applicable rules tension against each other, satisfy the higher level and record the tradeoff.

## Validation

The guide's structural contract (frontmatter, sequential unique rule IDs, quick-reference/heading agreement, live cross-references, router completeness) is machine-checked:

```bash
node scripts/validate.mjs
```

Run it after any edit to this guide. Exit 0 means the contract holds.

## Extending the guide

- **New rule:** append to the end of the owning file with the next sequential ID. Never renumber, reuse, or reorder existing IDs — external references depend on them. To retire a rule, keep its heading and replace the body with `Retired: <reason, date>`.
- **New file:** follow the file contract (frontmatter with `name`/`description`/`load_when`/`rule_prefix`, quick-reference table, `### PREFIX-NNN LEVEL: title` rule bodies), add it to the index above, then run the validator.
- **New batch of topics:** stack addenda and core files are deliberately independent — new files slot into the index without touching existing ones.
