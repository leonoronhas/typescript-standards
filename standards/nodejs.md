---
name: nodejs
description: Node.js runtime standards for backend services — process lifecycle, configuration, logging, async discipline, outbound I/O, and child processes.
load_when:
  - "Writing or modifying Node.js backend or server-side code"
  - "Setting up a new Node.js service, its runtime version, or its module system"
  - "Handling environment variables, configuration, or logging in a Node process"
  - "Working with promises, error handling, or process shutdown in a long-running Node service"
  - "Making outbound HTTP calls, spawning child processes, or processing large payloads in Node"
rule_prefix: NODE
---

# Node.js backend standards

Runtime-specific rules for TypeScript services running on Node.js: process lifecycle, configuration, logging, async and event-loop discipline, outbound I/O, and OS integration. Language and compiler rules live in `typescript-language.md`; vulnerability scanning and lint tooling in `security-and-linting.md`; test standards in `testing-tdd.md`; framework-level HTTP concerns in `nextjs.md` and structural concerns in `code-organization.md`. Where a more specific framework addendum conflicts with this file, the framework addendum wins — for example, `nextjs.md` NEXT-008/NEXT-009 override NODE-003's module-scope env parse in Next.js projects.

## Quick reference

| ID | Level | Rule |
|----|-------|------|
| NODE-001 | MUST | Run an active LTS Node version, declared in `engines` and a version file |
| NODE-002 | MUST | Use ESM as the module system for new code |
| NODE-003 | MUST | Validate environment configuration at boot with a schema and fail fast |
| NODE-004 | MUST NOT | Read `process.env` outside the config module |
| NODE-005 | MUST | Use a structured logger with levels; no `console.log` in production paths |
| NODE-006 | MUST NOT | Leave floating promises; enforce with `@typescript-eslint/no-floating-promises` |
| NODE-007 | MUST | Treat `unhandledRejection` and `uncaughtException` as fatal: log and exit |
| NODE-008 | MUST | Shut down gracefully on SIGTERM/SIGINT: stop intake, drain, close, exit |
| NODE-009 | MUST NOT | Block the event loop with CPU-heavy work; offload to worker threads |
| NODE-010 | SHOULD | Stream large payloads instead of buffering them in memory |
| NODE-011 | MUST | Set an explicit timeout on every outbound HTTP request |
| NODE-012 | SHOULD | Retry transient outbound failures with bounded backoff and jitter |
| NODE-013 | MUST | Separate operational from programmer errors; one central handler; never swallow |
| NODE-014 | MUST NOT | Build shell command strings; use `execFile`/`spawn` with argument arrays |
| NODE-015 | SHOULD | Carry request-scoped context with `AsyncLocalStorage`, not params or globals |
| NODE-016 | MUST | Harden inbound HTTP: security headers, CORS allowlist, body limits, rate limits |

## Rules

### NODE-001 MUST: Run an active LTS Node version, declared in `engines` and a version file

**Why:** Odd-numbered and end-of-life Node releases stop receiving security patches; an undeclared version lets every machine and CI runner pick a different runtime and diverge silently.

**Do:**

```jsonc
// package.json — 24 is Active LTS at the time of writing; check the current
// Node.js release schedule before copying any pinned example
{
  "engines": { "node": ">=24 <25" }
}
```

```bash
# .nvmrc (also honored by fnm, mise, and most CI setup actions)
echo "24" > .nvmrc
```

**Don't:**

```jsonc
// package.json — no engines field; runtime is whatever happens to be installed
{ "name": "api" }
```

**Exception:** A service pinned to an older LTS during a migration window may stay there, but the pin must still be explicit in `engines` and the version file.

### NODE-002 MUST: Use ESM as the module system for new code

**Why:** ESM is the standard JavaScript module system, is required by a growing share of dependencies published as ESM-only, and gives static import analysis that CommonJS cannot.

**Do:**

```jsonc
// package.json
{ "type": "module" }
```

```jsonc
// tsconfig.json — canonical runtime module/target settings
{
  "compilerOptions": {
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "target": "ES2024" // what the supported LTS (NODE-001) implements — bump with the runtime
  }
}
```

```ts
import { readFile } from "node:fs/promises";
export function loadTemplate(path: string): Promise<string> {
  return readFile(path, "utf8");
}
```

**Don't:**

```ts
const { readFile } = require("fs/promises"); // CJS in a new module
module.exports = { loadTemplate };
```

**Exception:** An existing CommonJS codebase may stay CJS until deliberately migrated; do not mix systems file-by-file within one package.

### NODE-003 MUST: Validate environment configuration at boot with a schema and fail fast

**Why:** A missing or malformed variable discovered at boot is a one-line fix; the same variable discovered mid-request is a production incident. One parse at startup turns the whole environment into typed, trusted data. This is the Node boot-time application of the general boundary-parsing rule, SEC-007 in `security-and-linting.md`.

**Do:**

```ts
// src/config.ts — the single typed config module
import { z } from "zod";

const schema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.url(),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export const config = schema.parse(process.env); // throws at boot on bad config
export type Config = typeof config;
```

**Don't:**

```ts
// deep inside a request handler, failing only when this line runs
const db = connect(process.env.DATABASE_URL!); // "!" hides the missing value
```

**Exception:** Build-time-only scripts may read the few variables they need directly, but must still validate them before use. In Next.js projects a module-scope `schema.parse(process.env)` breaks `next build`, which evaluates module side effects without runtime env — validate at boot in `instrumentation.ts` instead, per `nextjs.md` NEXT-008/NEXT-009.

### NODE-004 MUST NOT: Read `process.env` outside the config module

**Why:** Scattered `process.env` reads bypass boot-time validation (NODE-003), hide the service's real configuration surface, and make tests depend on ambient global state.

**Do:**

```ts
import { config } from "./config.js";

export function createPool() {
  return new Pool({ connectionString: config.DATABASE_URL });
}
```

**Don't:**

```ts
export function createPool() {
  return new Pool({ connectionString: process.env.DATABASE_URL ?? "" });
}
```

**Exception:** The config module itself, and process-bootstrap concerns that must run before config parses (for example choosing `NODE_ENV` for the parser).

### NODE-005 MUST: Use a structured logger with levels; no `console.log` in production paths

**Why:** Log aggregators index JSON fields, not prose; leveled structured logs are filterable, samplable, and cheap, while `console.log` is synchronous on some streams and unfilterable everywhere.

**Do:**

```ts
import { pino } from "pino";
import { config } from "./config.js";

export const logger = pino({ level: config.LOG_LEVEL });

logger.info({ orderId, userId }, "order created");
logger.error({ err }, "payment capture failed");
```

**Don't:**

```ts
console.log("order " + orderId + " created for " + userId);
```

**Exception:** CLI tools whose stdout is the user interface, and one-off local scripts. Enforce the ban in services with a lint rule (`no-console`) — see `security-and-linting.md`.

### NODE-006 MUST NOT: Leave floating promises; enforce with `@typescript-eslint/no-floating-promises`

**Why:** An unawaited promise swallows its rejection, breaks error propagation and graceful shutdown, and produces work the process cannot account for. The lint rule makes every fire-and-forget an explicit, reviewed decision.

**Do:**

```ts
await sendReceipt(order);

// deliberate fire-and-forget: mark it and attach a handler
void sendReceipt(order).catch((err) =>
  logger.error({ err }, "receipt send failed"),
);
```

```jsonc
// eslint config (flat): rules
{ "@typescript-eslint/no-floating-promises": "error" }
```

**Don't:**

```ts
sendReceipt(order); // rejection disappears; caller reports success anyway
```

### NODE-007 MUST: Treat `unhandledRejection` and `uncaughtException` as fatal: log and exit

**Why:** After an escaped exception or rejection the process is in an unknown state — continuing risks corrupt data and hung requests. Crashing loudly hands recovery to the supervisor (systemd, Kubernetes, PM2), which restarts a clean process.

**Do:**

```ts
process.on("unhandledRejection", (reason) => {
  logger.fatal({ reason }, "unhandled rejection — exiting");
  process.exit(1);
});
process.on("uncaughtException", (err) => {
  logger.fatal({ err }, "uncaught exception — exiting");
  process.exit(1);
});
```

**Don't:**

```ts
process.on("unhandledRejection", () => {
  /* ignore so the server "stays up" */
});
```

**Exception:** You may attempt a bounded flush of telemetry before exiting, with a hard deadline; you may not resume serving traffic.

### NODE-008 MUST: Shut down gracefully on SIGTERM/SIGINT: stop intake, drain, close, exit

**Why:** Orchestrators send SIGTERM before killing a container; a process that ignores it drops in-flight requests and leaks connections. Draining turns every deploy and scale-down into a zero-error event.

**Do:**

```ts
const server = app.listen(config.PORT);

async function shutdown(signal: string) {
  logger.info({ signal }, "shutting down");
  server.close(async () => {          // stop accepting; wait for in-flight
    await db.end();                   // release pools, queues, subscriptions
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref(); // hard deadline
}

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));
```

**Don't:**

```ts
process.on("SIGTERM", () => process.exit(0)); // kills in-flight requests instantly
```

### NODE-009 MUST NOT: Block the event loop with CPU-heavy work; offload to worker threads

**Why:** Node serves every connection on one loop; a single 200 ms synchronous computation stalls every concurrent request. CPU-bound work belongs on worker threads, keeping the loop free for I/O.

**Do:**

```ts
import { Worker } from "node:worker_threads";

export function renderReport(data: ReportInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./report.worker.js", import.meta.url), {
      workerData: data,
    });
    worker.once("message", resolve);
    worker.once("error", reject);
  });
}
```

**Don't:**

```ts
app.post("/report", (req, res) => {
  const pdf = renderReportSync(req.body); // pegs the loop; all requests stall
  res.send(pdf);
});
```

**Exception:** Sub-millisecond synchronous work is fine. For sustained load, pool workers (for example with `piscina`) instead of spawning per call.

### NODE-010 SHOULD: Stream large payloads instead of buffering them in memory

**Why:** Buffering a whole file or response body multiplies memory by concurrency and invites OOM kills; streams give constant memory and built-in backpressure.

**Do:**

```ts
import { createReadStream } from "node:fs";
import { pipeline } from "node:stream/promises";

app.get("/export", async (req, res) => {
  res.setHeader("content-type", "text/csv");
  await pipeline(createReadStream(exportPath), res); // handles backpressure + errors
});
```

**Don't:**

```ts
app.get("/export", async (req, res) => {
  res.send(await readFile(exportPath)); // whole file in memory per request
});
```

**Exception:** Payloads with a small, known upper bound (a few hundred KB) may be buffered for simplicity.

### NODE-011 MUST: Set an explicit timeout on every outbound HTTP request

**Why:** Default fetch and most HTTP clients wait indefinitely; one hung upstream then pins sockets and memory until the whole service degrades. A timeout converts a slow dependency into a fast, handleable error.

**Do:**

```ts
const res = await fetch(upstreamUrl, {
  signal: AbortSignal.timeout(5_000), // aborts socket + body after 5 s
});
if (!res.ok) throw new UpstreamError(res.status);
```

**Don't:**

```ts
const res = await fetch(upstreamUrl); // waits forever on a hung upstream
```

**Exception:** Deliberate long-lived connections (SSE, websockets, long polling) — but bound those with idle/heartbeat timeouts instead. To combine a deadline with caller cancellation, use `AbortSignal.any([callerSignal, AbortSignal.timeout(ms)])`.

### NODE-012 SHOULD: Retry transient outbound failures with bounded backoff and jitter

**Why:** Networks drop packets and upstreams restart; a single retry absorbs most transient failures. Unbounded or synchronized retries, though, amplify outages — bounds, exponential backoff, and jitter keep retry storms from finishing off a struggling dependency.

**Do:**

```ts
import { setTimeout as sleep } from "node:timers/promises";

async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i >= attempts - 1 || !isTransient(err)) throw err;
      const base = 200 * 2 ** i;
      await sleep(base + Math.random() * base); // exponential + full jitter
    }
  }
}
```

**Don't:**

```ts
while (true) {
  try { return await fn(); } catch { /* retry forever, immediately */ }
}
```

**Exception:** Never auto-retry non-idempotent operations (payments, sends) without an idempotency key. Skip retries entirely where the caller already retries end-to-end.

### NODE-013 MUST: Separate operational from programmer errors; one central handler; never swallow

**Why:** Expected, operational failures (bad input, upstream down, insufficient funds) are values: domain and application code returns a Result for them per `reusable-patterns.md` PAT-004 and never throws them. That leaves `throw` meaning exactly one thing — a programmer error and unknown process state. The central handler at the framework boundary is then a translation layer, not a catch-all: it maps a failed Result to an HTTP status or exit code, and treats any exception that actually reaches it as fatal (NODE-007). An empty `catch` erases the evidence either way.

**Do:**

```ts
// domain code: expected failures travel as Result values (`reusable-patterns.md` PAT-004)
declare function chargeCard(order: Order): Promise<Result<Receipt, ChargeError>>;

// boundary: translate the failed Result to a response — no throw/catch involved
app.post("/charge", async (req, res) => {
  const result = await chargeCard(req.body);
  if (!result.ok) {
    logger.warn({ code: result.error.code }, "charge failed");
    return res.status(statusFor(result.error.code)).json({ code: result.error.code });
  }
  res.json(result.value);
});

// central handler: anything *thrown* that reaches here is a programmer error —
// unknown state, so answer 500 and crash; the supervisor restarts (NODE-007)
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  logger.fatal({ err }, "unexpected exception — exiting");
  res.status(500).json({ code: "INTERNAL" });
  setTimeout(() => process.exit(1), 100).unref(); // let the response flush
});
```

**Don't:**

```ts
// expected failure modeled as a control-flow throw — the pattern PAT-004 exists to eliminate
class InsufficientFundsError extends Error {
  status = 402;
}

try {
  await chargeCard(order); // throws InsufficientFundsError two layers down
} catch {
  // or worse, swallowed: order marked paid, nobody charged, no log
}
```

**Exception:** Third-party and platform APIs that throw for expected failures get wrapped into a Result at the call site (PAT-004); a `catch` that performs that translation — or genuinely handles the error with a fallback or compensating action — is handling, not swallowing, and still logs at an appropriate level.

### NODE-014 MUST NOT: Build shell command strings; use `execFile`/`spawn` with argument arrays

**Why:** `exec` hands its string to a shell, so any interpolated value can inject arbitrary commands. `execFile`/`spawn` with an argument array never invokes a shell, making injection structurally impossible. Scanner and lint enforcement for this class of flaw lives in `security-and-linting.md`.

**Do:**

```ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const run = promisify(execFile);

await run("magick", [userUploadPath, "-resize", "512x512", outputPath]);
```

**Don't:**

```ts
import { exec } from "node:child_process";
exec(`magick ${userUploadPath} -resize 512x512 ${outputPath}`);
// userUploadPath = "x; rm -rf /" runs as a command
```

**Exception:** A fully static command string with zero interpolation may use shell features (pipes, globs) via `spawn` with `shell: true` — never with any runtime value in the string.

### NODE-015 SHOULD: Carry request-scoped context with `AsyncLocalStorage`, not params or globals

**Why:** Threading a request id or tenant through every function signature pollutes APIs, while a module-level variable is shared across concurrent requests and corrupts under load. `AsyncLocalStorage` scopes context to one async call chain safely.

**Do:**

```ts
// src/request-context.ts
import { AsyncLocalStorage } from "node:async_hooks";

export interface RequestContext { requestId: string; userId?: string }
export const requestContext = new AsyncLocalStorage<RequestContext>();

// middleware
app.use((req, _res, next) => {
  requestContext.run({ requestId: crypto.randomUUID() }, next);
});

// anywhere down the call chain — no parameter threading
logger.info({ requestId: requestContext.getStore()?.requestId }, "cache miss");
```

**Don't:**

```ts
let currentRequestId: string; // shared across concurrent requests
app.use((req, _res, next) => { currentRequestId = crypto.randomUUID(); next(); });
```

**Exception:** Data that a function genuinely operates on belongs in its parameters; reserve `AsyncLocalStorage` for cross-cutting context (tracing, auth principal, locale).

### NODE-016 MUST: Harden inbound HTTP: security headers, CORS allowlist, body limits, rate limits

**Why:** An unhardened HTTP surface fails in four predictable ways: missing security headers enable clickjacking and MIME sniffing; a permissive CORS policy combined with credentials lets any website make authenticated requests as the visitor; unbounded request bodies turn one request into memory exhaustion; unthrottled authentication and expensive endpoints invite credential stuffing and cheap denial of service. Scanner and lint tooling for this class of flaw lives in `security-and-linting.md`; the runtime hardening itself is this rule.

**Do:**

```ts
import express from "express";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";

const app = express();
app.use(helmet()); // security headers (or set HSTS, CSP/frame-ancestors, nosniff manually)
app.use(cors({ origin: ["https://app.example.com"], credentials: true })); // explicit allowlist
app.use(express.json({ limit: "100kb" })); // bound request bodies

const authLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 20 });
app.post("/login", authLimiter, loginHandler); // throttle auth + expensive endpoints
```

**Don't:**

```ts
app.use(cors({ origin: true, credentials: true })); // reflects every origin with credentials — a wildcard in effect
app.use(express.json({ limit: "1gb" })); // one request can exhaust memory
app.post("/login", loginHandler); // no rate limit — credential stuffing at line speed
```

**Exception:** A service reachable only through a gateway that already enforces a control (headers, limits, throttling) may rely on the gateway for it — document which layer owns each control, and keep the body-size bound on the service itself.
