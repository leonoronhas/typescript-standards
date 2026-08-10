---
name: typescript-language
description: TypeScript language and compiler rules - strict tsconfig baseline, type modeling, narrowing, assertion discipline, naming, and immutability defaults for every TS file.
load_when:
  - "Writing or modifying any TypeScript source file"
  - "Creating or editing a tsconfig.json or changing compiler options"
  - "Designing types, interfaces, unions, or enums for a data model"
  - "Typing a value that crosses a trust boundary (API response, parsed JSON, env var, user input)"
  - "Reviewing TypeScript code for type-safety, casting, or naming issues"
rule_prefix: TS
---

# TypeScript language and compiler standards

Core language and compiler rules for every TypeScript file, in any framework: compiler strictness, how to model data with types, how to narrow and assert safely, and baseline naming and immutability conventions. Module boundaries and folder structure live in `code-organization.md`; deep design patterns in `reusable-patterns.md`; ESLint/formatter configuration in `security-and-linting.md`; test standards in `testing-tdd.md`. Runtime- and framework-specific settings (module resolution targets, JSX options) belong to the addenda `nodejs.md`, `react.md`, `nextjs.md`, and `monorepo.md`, which layer on top of these rules and never contradict them.

## Quick reference

| ID | Level | Rule |
|----|-------|------|
| TS-001 | MUST | Compile every project against the strict baseline tsconfig. |
| TS-002 | MUST NOT | Type values as `any`; model imprecision with `unknown` or unions. |
| TS-003 | MUST | Type boundary data as `unknown` and narrow before use. |
| TS-004 | MUST | Declare with `const` by default, `let` only when rebinding, never `var`. |
| TS-005 | MUST | Compare with `===` and `!==`; never rely on implicit coercion. |
| TS-006 | MUST | Organize code as ES modules, not namespaces. |
| TS-007 | MUST | Use type-only imports and exports for types. |
| TS-008 | MUST | Annotate return types of exported functions. |
| TS-009 | SHOULD | Model alternative states as discriminated unions. |
| TS-010 | MUST | Make discriminant switches exhaustive with `never`. |
| TS-011 | SHOULD | Centralize narrowing in type guards and assertion functions. |
| TS-012 | MUST NOT | Use the non-null assertion operator `!`. |
| TS-013 | MUST | Restrict `as` assertions to validated boundaries. |
| TS-014 | SHOULD | Validate without widening using `satisfies`. |
| TS-015 | SHOULD | Use `as const` for literal inference and derived unions. |
| TS-016 | SHOULD | Prefer literal unions and `as const` objects over enums. |
| TS-017 | SHOULD | Define object contracts as interfaces with `readonly` creation-time fields, extending shared shapes. |
| TS-018 | MUST NOT | Declare empty interfaces. |
| TS-019 | SHOULD | Derive related types with utility types instead of duplicating members. |
| TS-020 | SHOULD | Mark data that must not mutate as `readonly`. |
| TS-021 | SHOULD | Destructure when extracting multiple values. |
| TS-022 | MUST | Follow the naming conventions (camelCase, PascalCase, UPPER_SNAKE_CASE, kebab-case files). |
| TS-023 | SHOULD | Use access modifiers deliberately; prefer `#private` for runtime privacy. |
| TS-024 | MAY | Use factory functions for non-trivial object construction. |
| TS-025 | MUST | Enforce these rules mechanically with ESLint and a formatter. |

## Rules

### TS-001 MUST: Compile every project against the strict baseline tsconfig

**Why:** Every flag below removes a class of silent runtime bug; `strict` alone leaves unchecked index access, optional-property confusion, accidental overrides, and switch fallthrough uncovered. A project that compiles under this baseline gets the rest of this guide's guarantees for free.

**Do:**

```jsonc
// tsconfig.json (compiler-strictness core; module/target settings per runtime addendum)
{
  "compilerOptions": {
    "strict": true,                      // all strict-family checks, incl. useUnknownInCatchVariables
    "noUncheckedIndexedAccess": true,    // arr[i] and record[key] are T | undefined
    "exactOptionalPropertyTypes": true,  // `prop?: T` no longer accepts an explicit undefined
    "noImplicitOverride": true,          // subclass methods must say `override`
    "noFallthroughCasesInSwitch": true,  // non-empty cases must break/return
    "verbatimModuleSyntax": true         // type imports must be marked `import type`
  }
}
```

**Don't:**

```jsonc
{
  "compilerOptions": {
    "strict": false,          // opts out of null checks, implicit any, and more
    "skipLibCheck": true      // acceptable, but never as a fix for your own type errors
  }
}
```

**Exception:** A legacy codebase may adopt the non-`strict` flags one at a time, ratcheting forward only — never disable a flag that is already on. `strict: true` itself is non-negotiable for new projects.

### TS-002 MUST NOT: Type values as `any`

**Why:** `any` opts the value — and everything it flows into — out of type checking entirely, so one `any` poisons every downstream expression. Describe data precisely: if a value can be several things, say which with a union; if you genuinely do not know, use `unknown` (TS-003).

**Do:**

```ts
type ConfigValue = string | number | boolean;

function readSetting(raw: unknown): ConfigValue {
  if (typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean") {
    return raw;
  }
  throw new TypeError(`Unsupported setting type: ${typeof raw}`);
}
```

**Don't:**

```ts
function readSetting(raw: any) {
  return raw.value.toUpperCase(); // compiles; explodes at runtime
}
```

**Exception:** `any` inside a generic constraint used purely for matching, e.g. `<F extends (...args: any[]) => unknown>` — the `any` never leaks into inferred call-site types. Justify each occurrence with a comment.

### TS-003 MUST: Type boundary data as `unknown` and narrow before use

**Why:** Data from the network, disk, environment, or a thrown exception has no compile-time guarantee; `unknown` forces a runtime check before the first property access instead of after the first production incident. Under the strict baseline (TS-001), `catch` variables are already `unknown`.

**Do:**

```ts
const payload: unknown = JSON.parse(raw);
if (isOrder(payload)) {
  process(payload); // payload: Order
}

try {
  await sync();
} catch (err) { // err: unknown
  const message = err instanceof Error ? err.message : String(err);
  logger.error(message);
}
```

**Don't:**

```ts
const payload = JSON.parse(raw) as Order; // trusts the network blindly
console.log(payload.total.toFixed(2));    // may crash on malformed input
```

**Exception:** None for external input. For complex shapes, prefer a schema validator over hand-written narrowing (see TS-011 and `security-and-linting.md` for input-validation tooling).

### TS-004 MUST: Declare with `const` by default, `let` only when rebinding, never `var`

**Why:** `var` is function-scoped and hoisted, which permits use-before-declaration and cross-block leakage. `const` documents that a binding never changes, which shrinks the state a reader must track.

**Do:**

```ts
const limit = 10;
let attempts = 0;
while (attempts < limit) {
  attempts += 1;
}
```

**Don't:**

```ts
var limit = 10; // hoisted, function-scoped, rebindable
```

### TS-005 MUST: Compare with `===` and `!==`; never rely on implicit coercion

**Why:** `==` applies coercion rules almost nobody can recite (`"" == 0` is true), so loose comparisons hide type mismatches the compiler would otherwise surface.

**Do:**

```ts
if (items.length === 0) { /* ... */ }
if (status !== "active") { /* ... */ }
```

**Don't:**

```ts
if (count == "0") { /* ... */ }  // string/number coercion
if (flag == true) { /* ... */ }  // just write `if (flag)`
```

**Exception:** `value == null` as a deliberate, idiomatic check for `null` or `undefined` in one comparison — allowed when the intent is exactly "nullish".

### TS-006 MUST: Organize code as ES modules, not namespaces

**Why:** `namespace` predates ES modules and fights modern tooling: bundler tree-shaking, `verbatimModuleSyntax`, and runtime type-stripping all assume file-scoped modules. Files with `import`/`export` are the unit of encapsulation.

**Do:**

```ts
// pricing.ts
export function applyDiscount(total: number, pct: number): number {
  return total * (1 - pct / 100);
}

// checkout.ts
import { applyDiscount } from "./pricing";
```

**Don't:**

```ts
namespace Pricing {
  export function applyDiscount(total: number, pct: number) { /* ... */ }
}
```

**Exception:** Declaration files (`.d.ts`) describing legacy globals or augmenting third-party modules, where declaration merging requires `declare namespace`.

### TS-007 MUST: Use type-only imports and exports for types

**Why:** `import type` guarantees the import is erased at compile time, so it can never create a runtime dependency, a circular-import crash, or a bundler side effect. `verbatimModuleSyntax` (TS-001) makes the compiler reject unmarked type imports, keeping emit predictable.

**Do:**

```ts
import type { User } from "./user";
import { createUser, type UserRole } from "./user";
export type { User };
```

**Don't:**

```ts
import { User, createUser } from "./user"; // User is a type; unmarked, it survives into emit
```

### TS-008 MUST: Annotate return types of exported functions

**Why:** An inferred return type on a public function makes the module's contract whatever the implementation happens to be — an internal edit can silently change every caller's type. The explicit annotation turns accidental contract changes into compile errors at the source.

**Do:**

```ts
export function parseDuration(input: string): number | null {
  const ms = Number(input);
  return Number.isFinite(ms) ? ms : null;
}
```

**Don't:**

```ts
export function parseDuration(input: string) {
  // return type drifts with the implementation
  const ms = Number(input);
  return Number.isFinite(ms) ? ms : null;
}
```

**Exception:** Module-private helpers and short inline callbacks may rely on inference. React function components may rely on the inferred JSX return type (see `react.md` REACT-001).

### TS-009 SHOULD: Model alternative states as discriminated unions

**Why:** A single object with optional fields makes illegal combinations representable (`data` and `error` both set); a union with a literal discriminant lets the compiler prove which fields exist in each state.

**Do:**

```ts
type FetchState<T> =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; data: T }
  | { status: "error"; error: Error };
```

**Don't:**

```ts
interface FetchState<T> {
  loading: boolean;
  data?: T;
  error?: Error; // what does loading:true with error set mean?
}
```

### TS-010 MUST: Make discriminant switches exhaustive with `never`

**Why:** When a new variant is added to a union, an exhaustive switch fails to compile at every site that must handle it; a silent `default` ships the gap to production instead.

**Do:**

```ts
function assertNever(value: never): never {
  throw new Error(`Unhandled variant: ${JSON.stringify(value)}`);
}

function render(state: FetchState<string>): string {
  switch (state.status) {
    case "idle":
    case "loading":
      return "…";
    case "success":
      return state.data;
    case "error":
      return state.error.message;
    default:
      return assertNever(state); // compile error if a variant is missed
  }
}
```

**Don't:**

```ts
switch (state.status) {
  case "success":
    return state.data;
  default:
    return ""; // swallows current and future variants silently
}
```

### TS-011 SHOULD: Centralize narrowing in type guards and assertion functions

**Why:** A named `value is T` guard or `asserts value is T` function makes runtime validation reusable and keeps ad-hoc casts out of call sites. The compiler trusts the signature unconditionally, so the body carries full responsibility for actually checking every claimed property — an incomplete guard is a disguised cast.

**Do:**

```ts
interface Order { id: string; total: number }

function isOrder(value: unknown): value is Order {
  return (
    typeof value === "object" && value !== null &&
    "id" in value && typeof value.id === "string" &&
    "total" in value && typeof value.total === "number"
  );
}

function assertOrder(value: unknown): asserts value is Order {
  if (!isOrder(value)) throw new TypeError("Expected an Order");
}
```

**Don't:**

```ts
function isOrder(value: unknown): value is Order {
  return typeof value === "object"; // claims Order, checks almost nothing
}
```

**Exception:** For large or nested shapes, generate guards from a schema validator instead of writing them by hand.

### TS-012 MUST NOT: Use the non-null assertion operator `!`

**Why:** `!` deletes `null | undefined` from a type with zero runtime backing — it is a bet that the strict null checker (TS-001) is wrong, and every incorrect bet is a `TypeError` in production. An explicit check documents the invariant and fails loudly with context.

**Do:**

```ts
const user = users.get(id);
if (!user) throw new Error(`Unknown user: ${id}`);
notify(user);
```

**Don't:**

```ts
notify(users.get(id)!); // crashes with a bare TypeError when the bet loses
```

**Exception:** None in application code. If an invariant genuinely guarantees presence, restructure so the types say so (e.g., build the object with the field required), or throw a descriptive error as above.

### TS-013 MUST: Restrict `as` assertions to validated boundaries

**Why:** `as` overrides the compiler's judgment with yours and is checked by nobody at runtime. It is legitimate only where a runtime check has just established the shape — and even there, a validator that returns a typed value (TS-011, TS-003) usually removes the need.

**Do:**

```ts
const body: unknown = await res.json();
assertOrder(body);          // runtime-validated
const order: Order = body;  // no cast needed after narrowing
```

**Don't:**

```ts
const order = (await res.json()) as Order;       // unvalidated claim
const user = {} as User;                          // lies about required fields
const n = value as unknown as number;             // double-cast defeats all checking
```

**Exception:** `as const` (TS-015); widening to a declared supertype; branding casts inside a smart constructor that has just validated the value (see `reusable-patterns.md` PAT-011); and test files constructing partial doubles where the test controls the runtime shape — each `as` there should be visibly justified by adjacent code.

### TS-014 SHOULD: Validate without widening using `satisfies`

**Why:** A type annotation or `as` widens the value to the declared type and discards the precise inferred literals; `satisfies` checks conformance while keeping the narrow type, so use sites retain key-level and literal-level precision.

**Do:**

```ts
const routes = {
  home: "/",
  settings: "/settings",
} satisfies Record<string, `/${string}`>;

routes.settings; // type "/settings" — typo'd keys and malformed paths are compile errors
```

**Don't:**

```ts
const routes: Record<string, string> = {
  home: "/",
  settings: "/settings",
};
routes.setings; // compiles: every string key is now legal
```

### TS-015 SHOULD: Use `as const` for literal inference and derived unions

**Why:** `as const` freezes an expression to its exact literal shape (readonly, no widening), which lets a single runtime value be the source of truth for a compile-time union — no duplicate list to drift.

**Do:**

```ts
const ROLES = ["admin", "editor", "viewer"] as const;
type Role = (typeof ROLES)[number]; // "admin" | "editor" | "viewer"
```

**Don't:**

```ts
const ROLES = ["admin", "editor", "viewer"];   // string[]
type Role = "admin" | "editor" | "viewer";     // second copy, drifts independently
```

### TS-016 SHOULD: Prefer literal unions and `as const` objects over enums

**Why:** Plain string unions and `as const` objects give the same named-constant ergonomics with zero runtime emit, structural compatibility with plain strings, and no conflict with erased-syntax toolchains (Node.js type stripping, `erasableSyntaxOnly`). This deliberately supersedes the traditional "use enums for shared named constants" guidance: the goal that guidance protects — one shared named constant set imported everywhere — is preserved by `as const` objects and literal unions, and string enums remain acceptable per the exception below. Whatever the form, define each constant set once and import it everywhere — never re-declare it per file.

**Do:**

```ts
const LogLevel = {
  Debug: "debug",
  Info: "info",
  Error: "error",
} as const;
type LogLevel = (typeof LogLevel)[keyof typeof LogLevel];

function log(level: LogLevel, msg: string): void { /* ... */ }
log(LogLevel.Info, "started");
log("info", "started"); // plain literals also accepted
```

**Don't:**

```ts
enum LogLevel { Debug, Info, Error }  // numeric: serializes as 0/1/2, opaque in logs
const enum Stage { Dev, Prod }        // breaks single-file transpilers and isolatedModules
```

**Exception:** A codebase already standardized on string enums may keep using them consistently. Never introduce numeric enums or `const enum`.

### TS-017 SHOULD: Define object contracts as interfaces with `readonly` creation-time fields, extending shared shapes

**Why:** An interface names the contract between a constructor or factory and its callers; `readonly` marks fields fixed at creation so accidental reassignment is a compile error. Extending a base interface keeps shared members defined once instead of drifting across copies.

**Do:**

```ts
interface ClientOptions {
  readonly baseUrl: string;
  readonly retries?: number;
}

interface AdminClientOptions extends ClientOptions {
  readonly auditLog: boolean;
}
```

**Don't:**

```ts
interface AdminClientOptions {
  baseUrl: string;   // duplicated from ClientOptions, mutable
  retries?: number;  // drifts when the base changes
  auditLog: boolean;
}
```

### TS-018 MUST NOT: Declare empty interfaces

**Why:** An empty interface constrains nothing — structural typing lets nearly any value satisfy it — so it documents a contract that does not exist and invites divergent assumptions about what belongs in it.

**Do:**

```ts
type ButtonProps = BaseProps; // alias until Button needs members of its own
```

**Don't:**

```ts
interface ButtonProps {}                    // matches almost anything
interface ButtonProps extends BaseProps {}  // adds nothing over BaseProps
```

**Exception:** Declaration-merging targets in `.d.ts` files, where an intentionally empty interface exists to be augmented.

### TS-019 SHOULD: Derive related types with utility types instead of duplicating members

**Why:** `Partial`, `Required`, `Pick`, `Omit`, `Readonly`, `Record`, `ReturnType`, `Parameters`, and friends express a derived type as a function of its source, so a change to the source propagates instead of silently diverging.

**Do:**

```ts
interface User { id: string; email: string; displayName: string }

type UserUpdate = Partial<Omit<User, "id">>;
type UsersById = Record<string, User>;
type CreateResult = ReturnType<typeof createUser>;
```

**Don't:**

```ts
interface UserUpdate {
  email?: string;
  displayName?: string; // hand-copied; misses the next User field
}
```

### TS-020 SHOULD: Mark data that must not mutate as `readonly`

**Why:** `readonly` properties, `readonly T[]` parameters, and `Readonly<T>` turn accidental mutation — the classic shared-state bug — into a compile error, and document at the signature which functions may change their inputs.

**Do:**

```ts
interface Config { readonly tags: readonly string[] }

function highest(prices: readonly number[]): number | undefined {
  return [...prices].sort((a, b) => b - a)[0]; // copy before sorting
}
```

**Don't:**

```ts
function highest(prices: number[]): number | undefined {
  return prices.sort((a, b) => b - a)[0]; // silently reorders the caller's array
}
```

### TS-021 SHOULD: Destructure when extracting multiple values

**Why:** Destructuring names the extracted fields once, at the point of extraction, and fails the compile if a named field disappears — repeated `obj.prop` chains hide which fields a block actually depends on.

**Do:**

```ts
const { host, port, protocol } = parseUrl(input);
function format({ level, msg }: LogEntry): string {
  return `[${level}] ${msg}`;
}
```

**Don't:**

```ts
const parsed = parseUrl(input);
const host = parsed.host;
const port = parsed.port;
const protocol = parsed.protocol;
```

### TS-022 MUST: Follow the naming conventions

**Why:** One consistent convention makes a symbol's kind readable from its name alone and keeps diffs free of rename churn. Do not prefix interfaces with `I` or type parameters with meaningless single letters when a descriptive name fits.

**Do:**

```ts
// file: http-client.ts (kebab-case file names)
const MAX_RETRIES = 3;                       // module-level true constant: UPPER_SNAKE_CASE
interface RetryPolicy { maxAttempts: number } // types PascalCase, members camelCase
class HttpClient { /* ... */ }               // classes PascalCase
function buildClient(): HttpClient { /* ... */ } // functions/variables camelCase
```

**Don't:**

```ts
// file: HTTPClient_v2.ts
interface IRetryPolicy { MaxAttempts: number }
const maxRetries = 3; // exported constant hiding as a variable
```

**Exception:** File-name casing, including all edge cases, is governed solely by `code-organization.md` ORG-015.

### TS-023 SHOULD: Use access modifiers deliberately; prefer `#private` for runtime privacy

**Why:** Everything on a class is public by default, so an unmarked member is an accidental API commitment. `private`/`protected` are erased at compile time; ECMAScript `#private` fields are enforced at runtime and invisible even to `JSON.stringify` and property enumeration.

**Do:**

```ts
class SessionStore {
  #cache = new Map<string, Session>(); // runtime-enforced privacy
  private readonly ttlMs: number;      // compile-time-only, fine for internals

  constructor(ttlMs: number) {
    this.ttlMs = ttlMs;
  }

  get(id: string): Session | undefined {
    return this.#cache.get(id);
  }
}
```

**Don't:**

```ts
class SessionStore {
  cache = new Map<string, Session>(); // implicitly public; now part of the API
}
```

### TS-024 MAY: Use factory functions for non-trivial object construction

**Why:** When creation involves validation, defaulting, or choosing among implementations, a factory returning an interface keeps the concrete class or literal an implementation detail and gives callers one audited entry point. Full treatment of the factory pattern lives in `reusable-patterns.md`.

**Do:**

```ts
export function createClient(options: ClientOptions): Client {
  const retries = options.retries ?? 3;
  return new HttpClient({ ...options, retries });
}
```

### TS-025 MUST: Enforce these rules mechanically with ESLint and a formatter

**Why:** Rules that only live in a document decay; a type-aware linter (typescript-eslint) plus an auto-formatter make most of this file's rules fail CI instead of relying on reviewer vigilance. Tool selection and configuration detail live in `security-and-linting.md`.

**Do:**

```bash
npm run lint && npm run format:check   # both wired into CI, not optional local habits
```
