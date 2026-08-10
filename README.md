# TypeScript Standards

An opinionated, LLM-queryable standards guide for TypeScript projects — Node.js backends, React frontends, Next.js apps, monorepos, and any other TypeScript codebase (the core files are framework-agnostic).

**Start at [AGENTS.md](AGENTS.md)** — the router. It indexes every standards file with *load when* triggers so a human or a coding agent loads only the file relevant to the task at hand.

## Layout

```
AGENTS.md                        # router: index, rule levels, precedence, how to extend
standards/
  code-organization.md   (ORG)   # large-scale structure & module boundaries
  reusable-patterns.md   (PAT)   # typed design patterns; when NOT to abstract
  typescript-language.md (TS)    # strict tsconfig, type modeling, assertion discipline
  security-and-linting.md (SEC)  # vuln scanning, supply chain, input validation, CI gates
  documentation.md       (DOC)   # TSDoc, READMEs, ADRs, changelogs, doc structure
  testing-tdd.md         (TDD)   # red–green–refactor, test pyramid, test quality
  live-verification.md   (VER)   # prove it live: evidence before "done"
  nodejs.md              (NODE)  # Node runtime addendum
  react.md               (REACT) # React addendum
  nextjs.md              (NEXT)  # Next.js App Router addendum
  monorepo.md            (MONO)  # workspaces & multi-package repos addendum
scripts/
  validate.mjs                   # zero-dependency structural contract check
```

## Design for LLM retrieval

- **Stable rule IDs** (`TS-016`, `SEC-004`) — grep anchors and citation handles; never renumbered.
- **RFC 2119 levels** (MUST / MUST NOT / SHOULD / MAY) — machine-followable severity.
- **Quick-reference table per file** — a cheap scan surface before loading full rule bodies.
- **Self-contained rules** — each `###` section stands alone with rationale and Do/Don't code.
- **Frontmatter `load_when` triggers** — task-shaped conditions a router or agent can match.

## Using it in a project

Point your project's agent instructions (CLAUDE.md, AGENTS.md, system prompt) at this folder — e.g. copy it in, add it as a git submodule, or reference it globally — and instruct: *"Consult the TypeScript standards guide via its AGENTS.md router; follow matched rules and cite their IDs."* Project-local conventions take precedence where they conflict (see the router's Precedence section).

## Maintaining

```bash
node scripts/validate.mjs   # structural contract check — run after any edit
```

Extension rules (new rules, new files, retiring rules) are in [AGENTS.md](AGENTS.md#extending-the-guide).

## Sources

Core TypeScript practices incorporate and generalize the AWS Prescriptive Guidance pages on [TypeScript best practices](https://docs.aws.amazon.com/prescriptive-guidance/latest/best-practices-cdk-typescript-iac/typescript-best-practices.html) and [documentation best practices](https://docs.aws.amazon.com/prescriptive-guidance/latest/best-practices-cdk-typescript-iac/documentation-best-practices.html), extended with current community consensus (strict compiler flags, `satisfies`, literal unions over enums, parse-don't-validate boundaries, TDD, and evidence-based verification).
