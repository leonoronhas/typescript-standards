---
name: reusable-patterns
description: Reusable, typed design patterns for TypeScript — when to reach for each pattern and when not to abstract at all.
load_when:
  - "Deciding whether to extract a shared abstraction from duplicated code"
  - "Choosing a design pattern (factory, builder, strategy, repository, pub-sub) for new code"
  - "Designing error handling for operations that are expected to fail"
  - "Wiring dependencies, external services, or test doubles into application code"
  - "Modeling domain state, workflow transitions, or domain identifiers in types"
rule_prefix: PAT
---

# Reusable patterns

This file governs typed design patterns: which pattern fits which problem, how to express each one idiomatically in TypeScript, and — just as important — when to refuse the abstraction entirely. Language and compiler mechanics (strictness flags, narrowing, utility types, exhaustiveness plumbing) live in `typescript-language.md`; where modules and layers physically live is `code-organization.md`; how these seams are exploited by tests is `testing-tdd.md`. Framework-specific applications of these patterns are layered on by `nodejs.md`, `react.md`, and `nextjs.md`.

## Quick reference

| ID | Level | Rule |
| --- | --- | --- |
| PAT-001 | MUST NOT | Introduce an abstraction before the third real occurrence of the pattern |
| PAT-002 | SHOULD | Compose small units of behavior instead of building inheritance hierarchies |
| PAT-003 | MUST | Model state with discriminated unions so illegal combinations cannot be constructed |
| PAT-004 | SHOULD | Return a Result type for expected failures; throw only for bugs |
| PAT-005 | MUST | Receive dependencies as parameters and wire concrete implementations in one composition root |
| PAT-006 | MUST NOT | Resolve dependencies through service locators or ambient singletons |
| PAT-007 | MUST | Put a domain-owned interface (port) between domain logic and every external service |
| PAT-008 | SHOULD | Encapsulate construction behind factory functions; use an abstract factory for object families |
| PAT-009 | SHOULD | Implement interchangeable behavior as a union-keyed object map, not a class hierarchy |
| PAT-010 | SHOULD | Route data access through a repository interface the domain owns |
| PAT-011 | SHOULD | Brand domain identifiers so different id types cannot be mixed |
| PAT-012 | SHOULD | Reach for an options object first; use a builder only for genuinely staged construction |
| PAT-013 | SHOULD | Type event emitters and pub-sub channels with an event-map generic |
| PAT-014 | SHOULD | Constrain every type parameter and generalize only from real call sites |
| PAT-015 | MAY | Apply cross-cutting concerns with typed higher-order function wrappers |

## Rules

### PAT-001 MUST NOT: Abstract before the third occurrence

**Why:** Duplication is cheap to fix later; the wrong abstraction couples unrelated call sites and is expensive to unwind. Two occurrences are a coincidence — only a third proves the shape of the commonality.

Apply the rule of three:

1. First occurrence: write it inline.
2. Second occurrence: copy it, and note the duplication (a comment or tracker entry is enough).
3. Third occurrence: now the invariant parts are visible — extract an abstraction shaped by all three call sites.

When an existing abstraction no longer fits a new call site, do not add flags and optional parameters to force the fit. Inline it back into the callers and let the better abstraction emerge. Every pattern in this file is subject to this rule: a factory, builder, or repository introduced for a single caller "because we might need it" is speculative complexity.

**Exception:** Public API surfaces and security-critical logic (auth checks, sanitization) may be centralized on first use — there, divergent copies are the greater risk.

### PAT-002 SHOULD: Compose behavior instead of inheriting it

**Why:** Inheritance couples children to parent implementation details and forces every variation into one hierarchy; composition lets independent capabilities combine freely and be tested in isolation.

**Don't:**

```ts
class EmailSender {
  async send(to: string, body: string): Promise<void> {
    /* smtp */
  }
}
class RetryingEmailSender extends EmailSender {
  /* overrides send, reaches into parent state */
}
class LoggingRetryingEmailSender extends RetryingEmailSender {
  /* every new capability multiplies subclasses */
}
```

**Do:**

```ts
type Send = (to: string, body: string) => Promise<void>;

const send: Send = async (to, body) => {
  /* smtp */
};

// Capabilities are independent wrappers, combined at wiring time
const robustSend = withLogging(withRetry(send));
```

**Exception:** Shallow inheritance (one level) is fine when a framework requires it (e.g. extending `Error` for custom error classes) or when the subtype relationship is genuinely "is-a" and stable.

### PAT-003 MUST: Make illegal states unrepresentable with discriminated unions

**Why:** When invalid combinations of fields cannot be constructed, an entire class of runtime checks and defensive branches disappears — the compiler rejects the bug instead of a reviewer catching it.

**Don't:**

```ts
// 8 boolean/optional combinations exist; only 4 are meaningful
interface FetchState {
  loading: boolean;
  data?: string;
  error?: Error;
}
```

**Do:**

```ts
type FetchState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; data: string }
  | { status: "error"; error: Error };

function render(state: FetchState): string {
  switch (state.status) {
    case "idle":
      return "—";
    case "loading":
      return "…";
    case "success":
      return state.data; // data exists only where it is valid
    case "error":
      return state.error.message;
  }
}
```

Model workflows the same way: represent each state as a union member carrying exactly the data valid in that state, and expose transitions as functions from one member to another (`submit(draft: Draft): Submitted`). A transition that is not written cannot be taken. Exhaustiveness-checking mechanics (`never` guards, `satisfies`) are covered in `typescript-language.md`.

### PAT-004 SHOULD: Return a Result type for expected failures; throw only for bugs

**Why:** Failures that are part of a function's contract (validation, not-found, declined payment) deserve a spot in its return type, where the compiler forces callers to handle them; exceptions are invisible in signatures and are routinely forgotten.

**Don't:**

```ts
// The failure modes are invisible at the call site and easy to skip
function parsePort(raw: string): number {
  const n = Number(raw);
  if (Number.isNaN(n)) throw new Error("not a number");
  if (n < 1 || n > 65535) throw new Error("out of range");
  return n;
}
```

**Do:**

```ts
type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

function parsePort(raw: string): Result<number, "not_a_number" | "out_of_range"> {
  const n = Number(raw);
  if (Number.isNaN(n)) return { ok: false, error: "not_a_number" };
  if (n < 1 || n > 65535) return { ok: false, error: "out_of_range" };
  return { ok: true, value: n };
}

const port = parsePort(process.env.PORT ?? "");
if (!port.ok) {
  // the compiler made you look
}
```

Keep the split clean: expected failures return `Result`; programmer errors (violated invariants, impossible branches) throw, so they crash loudly and get fixed. Pick one Result implementation per codebase — a hand-rolled type like the above or one library (e.g. neverthrow) — and use it everywhere; mixing several, or mixing Result and thrown errors for the same failure, is worse than either alone.

**Exception:** At process boundaries (HTTP handlers, job runners, CLIs) convert Results to protocol-appropriate responses and let a top-level handler translate uncaught exceptions into 500s/non-zero exits.

### PAT-005 MUST: Inject dependencies through parameters and wire them in a composition root

**Why:** A function that receives its dependencies is honest about what it needs, swappable in tests, and reusable in new contexts; a function that imports them is welded to one concrete world. Centralizing the wiring in one composition root keeps construction knowledge out of business logic.

**Don't:**

```ts
import { mailer } from "./global-mailer"; // hidden, unswappable dependency

export async function sendReminder(email: string): Promise<void> {
  await mailer.send(email, "Invoice overdue");
}
```

**Do:**

```ts
interface Clock {
  now(): Date;
}
interface Mailer {
  send(to: string, body: string): Promise<void>;
}
interface ReminderService {
  remind(email: string, dueAt: Date): Promise<void>;
}

export function createReminderService(deps: { clock: Clock; mailer: Mailer }): ReminderService {
  return {
    async remind(email: string, dueAt: Date): Promise<void> {
      if (deps.clock.now() > dueAt) await deps.mailer.send(email, "Invoice overdue");
    },
  };
}

// main.ts — the composition root: the only file that knows concrete implementations
const reminders = createReminderService({
  clock: { now: () => new Date() },
  mailer: createSmtpMailer(config.smtp),
});
```

Constructor parameters, a `deps` object on a factory function, or plain function arguments all qualify — the mechanism matters less than the direction: dependencies flow in from the caller. No DI framework is required; plain parameters plus one wiring module scale a long way. How tests exploit this seam is covered in `testing-tdd.md`.

**Exception:** Pure, dependency-free utilities (formatters, math) need no injection; do not thread a `deps` object through code that uses none of it.

### PAT-006 MUST NOT: Resolve dependencies through service locators or ambient singletons

**Why:** A service locator hides the dependency edge from both the type system and the reader — the signature claims independence while the body reaches into a global registry, making usage untraceable and tests order-dependent.

**Don't:**

```ts
export async function generateReport(): Promise<void> {
  const mailer = container.resolve<Mailer>("mailer"); // stringly-typed, invisible edge
  const db = ServiceRegistry.get("db"); // fails at runtime, not compile time
}
```

**Do:**

```ts
// The signature is the dependency manifest
export async function generateReport(mailer: Mailer, db: Db): Promise<void> {
  /* ... */
}
```

The same applies to reach-out-and-grab mutable singletons (`import { db } from "./db"` where `db` is a live connection created at import time): they run side effects on import and cannot be substituted per test or per tenant. Export factories; let the composition root (PAT-005) create the one instance and pass it down.

**Exception:** Truly ambient, side-effect-free facilities with a project-wide single implementation (e.g. a logger) may be module-scoped, provided nothing needs to substitute them per call site.

### PAT-007 MUST: Put a domain-owned interface (port) between domain logic and every external service

**Why:** Vendor SDK types spread through a codebase like dye through water; a domain-owned port confines them to one adapter, so the vendor can be swapped, stubbed, or upgraded without touching business logic.

**Don't:**

```ts
// domain/billing.ts
import Stripe from "stripe"; // domain logic now depends on a vendor SDK

export async function chargeCustomer(stripe: Stripe, cents: number) {
  const intent = await stripe.paymentIntents.create({ amount: cents, currency: "usd" });
  return intent; // Stripe.PaymentIntent leaks to every caller
}
```

**Do:**

```ts
// domain/ports.ts — the domain names the contract in its own vocabulary
export interface PaymentGateway {
  charge(cents: number, customerId: CustomerId): Promise<ChargeResult>;
}

// adapters/stripe-payment-gateway.ts — vendor types stop here
import Stripe from "stripe";

export function createStripePaymentGateway(client: Stripe): PaymentGateway {
  return {
    async charge(cents, customerId) {
      const intent = await client.paymentIntents.create({
        amount: cents,
        currency: "usd",
        customer: customerId,
      });
      return toChargeResult(intent); // translate at the boundary
    },
  };
}
```

Two disciplines make this pattern real: the interface lives in the domain's own module (the domain owns the contract; the adapter conforms to it, never the reverse), and adapters translate external types into domain types at the boundary rather than re-exporting them. Where ports and adapters live on disk is governed by `code-organization.md`.

**Exception:** Glue scripts and one-off tools that are themselves nothing but a vendor call need no port — there is no domain to protect.

### PAT-008 SHOULD: Encapsulate construction behind factory functions

**Why:** A factory owns the invariants of construction — validation, defaulting, choosing the right variant — so objects can never escape half-initialized, and callers depend on a returned interface instead of a concrete class.

**Don't:**

```ts
const notifier = new EmailNotifier();
notifier.host = config.smtpHost; // half-initialized object escaped
notifier.port = config.smtpPort; // every call site repeats the setup, differently
```

**Do:**

```ts
interface Notifier {
  send(to: string, body: string): Promise<void>;
}

type NotifierConfig =
  | { kind: "email"; smtpHost: string; smtpPort: number }
  | { kind: "sms"; accountSid: string };

export function createNotifier(cfg: NotifierConfig): Notifier {
  switch (cfg.kind) {
    case "email":
      return createEmailNotifier(cfg); // fully constructed or not at all
    case "sms":
      return createSmsNotifier(cfg);
  }
}
```

The return type is the interface, so the concrete class (if one exists at all) stays private to its module. A factory that validates may return a `Result` (PAT-004) — a "smart constructor" that is the only way to obtain the type.

When several related objects must vary together, use an abstract factory: one interface that produces the whole consistent family, implemented once per family.

```ts
interface MessagingFactory {
  createNotifier(): Notifier;
  createTemplateRenderer(): TemplateRenderer;
}

// createProductionMessaging(cfg) and createFakeMessaging() each return a
// MessagingFactory whose products are guaranteed to be compatible.
```

**Exception:** Plain data with no invariants needs no factory — an object literal checked against an interface is already safe.

### PAT-009 SHOULD: Implement interchangeable behavior as a union-keyed object map, not a class hierarchy

**Why:** In TypeScript, a `Record` keyed by a literal union delivers the strategy pattern with compile-time exhaustiveness and zero instantiation ceremony — adding a variant breaks the build until every dispatch table handles it.

**Don't:**

```ts
abstract class ShippingStrategy {
  abstract cost(weightKg: number): number;
}
class StandardShipping extends ShippingStrategy {
  cost(w: number) {
    return w * 2;
  }
}
class ExpressShipping extends ShippingStrategy {
  cost(w: number) {
    return 15 + w * 3;
  }
}
// ...plus a registry, plus `new`, plus nothing stopping a forgotten variant
```

**Do:**

```ts
type ShippingMethod = "standard" | "express" | "pickup";

const shippingCost: Record<ShippingMethod, (weightKg: number) => number> = {
  standard: (w) => w * 2,
  express: (w) => 15 + w * 3,
  pickup: () => 0,
}; // adding "overnight" to ShippingMethod fails compilation here until handled

const cost = shippingCost[order.method](order.weightKg);
```

When each variant needs different data, dispatch on a discriminated union (PAT-003) with a `switch` instead of a map — same guarantee, richer payloads. Reserve class-based strategies for the rare case where each strategy carries injected dependencies and internal state; even then, prefer factory functions returning a shared interface (PAT-008).

### PAT-010 SHOULD: Route data access through a repository interface the domain owns

**Why:** A repository is the port (PAT-007) for persistence: domain logic speaks in aggregates and identifiers, one adapter speaks SQL/ODM, and tests run against an in-memory implementation instead of a database.

**Don't:**

```ts
import { db } from "../db";

// Domain rule buried in infrastructure; untestable without a live database
export async function promoteToAdmin(id: string): Promise<void> {
  await db.query("UPDATE users SET role = 'admin' WHERE id = $1", [id]);
}
```

**Do:**

```ts
// domain/user-repository.ts — the domain owns the seam
export interface UserRepository {
  findById(id: UserId): Promise<User | null>;
  save(user: User): Promise<void>;
}

// domain/promote.ts — pure domain logic against the seam
export async function promoteToAdmin(repo: UserRepository, id: UserId): Promise<void> {
  const user = await repo.findById(id);
  if (!user) return;
  await repo.save({ ...user, role: "admin" });
}
```

Keep repository methods in domain vocabulary (`findActiveByEmail`), not storage vocabulary (`queryWithJoin`). Do not let ORM entities or query builders cross the interface — return domain types. Grow methods from real call sites (PAT-001), not from an imagined generic CRUD surface.

**Exception:** In a thin CRUD service where the ORM model effectively *is* the domain, a repository that mirrors it one-to-one adds indirection without value — but keep some seam if you intend to test logic without a database (`testing-tdd.md`).

### PAT-011 SHOULD: Brand domain identifiers so different id types cannot be mixed

**Why:** To the compiler, every raw `string` id is interchangeable — `getOrder(userId)` type-checks and fails in production. A brand makes each identifier a distinct type at zero runtime cost.

**Don't:**

```ts
function getOrder(orderId: string, userId: string) {}
getOrder(userId, orderId); // arguments swapped; compiles cleanly
```

**Do:**

```ts
type UserId = string & { readonly __brand: "UserId" };
type OrderId = string & { readonly __brand: "OrderId" };

// The only sanctioned casts — validate at the boundary, then brand
const asUserId = (raw: string): UserId => {
  if (!/^u_[a-z0-9]+$/.test(raw)) throw new TypeError(`invalid UserId: ${raw}`);
  return raw as UserId;
};
const asOrderId = (raw: string): OrderId => {
  if (!/^o_[a-z0-9]+$/.test(raw)) throw new TypeError(`invalid OrderId: ${raw}`);
  return raw as OrderId;
};

function getOrder(orderId: OrderId, userId: UserId) {}
getOrder(userId, orderId); // compile error
```

Brand at system boundaries (request parsing, database rows) and pass branded types everywhere inside; a validating brand constructor is a smart constructor (PAT-008), ideally returning a `Result` (PAT-004), and its `as` cast is the sanctioned exception to `typescript-language.md` TS-013 — a bare cast without the preceding validation is not. The same technique guards validated values generally: `SanitizedHtml`, `PositiveInt`, `IsoTimestamp`. Schema libraries such as Zod ship built-in brand support.

**Exception:** Do not brand values that never cross a function boundary or that exist only inside one module — the ceremony must buy real confusion-prevention.

### PAT-012 SHOULD: Reach for an options object first; use a builder only for genuinely staged construction

**Why:** A single typed options parameter with defaults handles "many optional parts" in one line per option; a builder earns its extra surface only when construction spans multiple sites, accumulates repeated parts, or must enforce ordering.

**Don't:**

```ts
// Builder ceremony wrapping three flat options
const client = new HttpClientBuilder()
  .withBaseUrl("https://api.example.com")
  .withTimeout(5000)
  .withRetries(3)
  .build();
```

**Do:**

```ts
interface HttpClientOptions {
  baseUrl: string;
  timeoutMs?: number;
  retries?: number;
}

function createHttpClient({ baseUrl, timeoutMs = 5000, retries = 3 }: HttpClientOptions) {
  /* ... */
}
```

A builder is the right tool when parts accumulate incrementally (possibly conditionally, across functions) and a final `build()` should validate the combination once:

```ts
const report = reportBuilder()
  .addSection(salesSummary)
  .addSection(inventory) // repeatable — an options object cannot express "add N"
  .withFooter(legalNotice)
  .build(); // validates the whole combination at the end
```

If some steps are mandatory, encode the protocol in types: each step returns a narrower builder type, and `build()` exists only on the fully-specified one — misuse then fails at compile time, not in `build()`.

### PAT-013 SHOULD: Type event emitters and pub-sub channels with an event-map generic

**Why:** Stringly-typed emitters accept misspelled event names and `any` payloads, silently decoupling producers from consumers; an event map makes every channel name and payload shape a compile-time contract.

**Don't:**

```ts
emitter.emit("user.created", { userld: "u_1" }); // typo'd key, unchecked payload
emitter.on("user.craeted", (data) => {}); // listener never fires; compiles fine
```

**Do:**

```ts
type Events = {
  "user.created": { userId: UserId };
  "order.paid": { orderId: OrderId; amountCents: number };
};

interface TypedEmitter<E extends Record<string, unknown>> {
  on<K extends keyof E>(event: K, handler: (payload: E[K]) => void): () => void;
  emit<K extends keyof E>(event: K, payload: E[K]): void;
}

declare const bus: TypedEmitter<Events>;
bus.on("order.paid", ({ amountCents }) => {}); // payload fully typed
bus.emit("user.created", { userId: asUserId("u_1") });
```

Define the event map once next to the bus and import it everywhere; it doubles as the catalog of everything that can happen in the system. The same shape types Node's `EventEmitter` (via wrappers or libraries), browser `CustomEvent` dispatch, and message-queue producers/consumers. For cross-process pub-sub, validate incoming payloads at the boundary before trusting the type.

### PAT-014 SHOULD: Constrain every type parameter and generalize only from real call sites

**Why:** An unconstrained `<T>` tells the compiler and the reader nothing, and generics invented before concrete usage exists routinely generalize the wrong axis (PAT-001 applies to type parameters too).

**Don't:**

```ts
// T is unconstrained and unused meaningfully; the generic is decoration
function process<T>(input: T): T {
  return input;
}

// Speculative parameterization: only ever called with one type
function loadConfig<T = Config>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T; // unchecked cast hiding as flexibility
}
```

**Do:**

```ts
// The constraint states what the function actually relies on
function pluck<T, K extends keyof T>(items: readonly T[], key: K): T[K][] {
  return items.map((item) => item[key]);
}

function maxBy<T>(items: readonly T[], score: (item: T) => number): T | undefined {
  let best: T | undefined;
  let bestScore = -Infinity;
  for (const item of items) {
    const s = score(item);
    if (s > bestScore) [best, bestScore] = [item, s];
  }
  return best;
}
```

Write the concrete version first; introduce a type parameter only when a second call site with a different type exists, and give it the tightest constraint that still fits both. A type parameter used exactly once in a signature is usually noise — inline it. Deeper generic mechanics (variance, conditional types, `satisfies`) belong to `typescript-language.md`.

### PAT-015 MAY: Wrap cross-cutting concerns with typed higher-order functions

**Why:** Retry, logging, caching, and timing are orthogonal to business logic; a generic wrapper applies them to any function without inheritance (PAT-002), middleware frameworks, or copy-pasted try/catch blocks.

**Do:**

```ts
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function withRetry<A extends unknown[], R>(
  fn: (...args: A) => Promise<R>,
  isTransient: (err: unknown) => boolean,
  { attempts = 3, baseDelayMs = 100 } = {},
): (...args: A) => Promise<R> {
  return async (...args) => {
    for (let attempt = 1; ; attempt++) {
      try {
        return await fn(...args);
      } catch (err) {
        if (attempt >= attempts || !isTransient(err)) throw err;
        const backoff = baseDelayMs * 2 ** (attempt - 1);
        await sleep(backoff + Math.random() * backoff); // exponential backoff + jitter
      }
    }
  };
}

const fetchProfile = withRetry(fetchProfileOnce, isNetworkError); // signature preserved
```

**Don't:**

```ts
// Retry logic hand-woven into every function that needs it
async function fetchProfile(id: UserId): Promise<Profile> {
  for (let i = 0; i < 3; i++) {
    try {
      return await api.get(`/profiles/${id}`);
    } catch {
      /* duplicated in fetchOrders, fetchInvoices, ... */
    }
  }
  throw new Error("unreachable-ish"); // and the loop is subtly different each time
}
```

Wrappers compose at the wiring site (`withCache(withRetry(withLogging(fn)))`), keeping each concern testable alone. Keep them signature-preserving — a wrapper that changes the return type is a different function and deserves a different name. Apply PAT-001 before writing one: two hand-rolled retry loops do not yet justify a generic `withRetry`. This rule covers only the wrapper mechanics; for outbound I/O the retry policy itself — bounded attempts, exponential backoff, jitter, retrying transient failures only — is governed by `nodejs.md` NODE-012.

**Exception:** When a framework already provides the concern as configuration (HTTP client retry options, framework middleware), use that instead of a bespoke wrapper.
