---
name: nextjs
description: "Next.js App Router addendum: server/client component boundaries, secrets and env handling, server actions, caching, and routing conventions"
load_when:
  - "Working in a Next.js project (app/ directory, next.config.*, next build)"
  - "Deciding where 'use client' goes or structuring server/client component boundaries"
  - "Writing server actions, route handlers, or proxy (middleware) in Next.js"
  - "Adding data fetching, caching, or revalidation logic in a Next.js app"
  - "Handling environment variables or secrets in a Next.js codebase"
  - "Creating routes, layouts, loading/error states, or organizing files under app/"
rule_prefix: NEXT
---

# Next.js Standards (App Router)

This file layers Next.js App Router rules on top of the framework-agnostic core: component boundaries, secret and environment handling, server actions, caching semantics, and routing conventions. General component design, hooks, and rendering rules live in `react.md`; generic backend runtime concerns live in `nodejs.md`; language and compiler rules live in `typescript-language.md`. Vulnerability scanning and lint tooling belong to `security-and-linting.md`; test strategy belongs to `testing-tdd.md`.

## Quick reference

| ID | Level | Rule |
|---|---|---|
| NEXT-001 | MUST | Keep components server-rendered by default; push `"use client"` to interactive leaves |
| NEXT-002 | MUST NOT | Mark a layout as a client component to gain interactivity |
| NEXT-003 | MUST | Import `server-only` in every module that must never reach the client bundle |
| NEXT-004 | MUST | Treat every `NEXT_PUBLIC_` variable as a deliberate, audited public API |
| NEXT-005 | MUST | Validate input with a schema and authorize inside every server action |
| NEXT-006 | MUST | Declare caching intent explicitly at every data access |
| NEXT-007 | MUST | Type route handler params and set their caching semantics deliberately |
| NEXT-008 | MUST NOT | Run module-scope side effects that assume runtime environment |
| NEXT-009 | MUST | Validate client-exposed env at build time and server env at boot |
| NEXT-010 | SHOULD | Organize `app/` with route groups, private folders, and colocation |
| NEXT-011 | SHOULD | Stream with Suspense at meaningful UI seams and provide segment state files |
| NEXT-012 | MUST | Parallelize independent data fetches |
| NEXT-013 | MUST | Keep proxy (formerly middleware) thin |
| NEXT-014 | SHOULD | Use `next/image` and `next/font` instead of raw tags |

## Rules

### NEXT-001 MUST: Keep components server-rendered by default; push `"use client"` to interactive leaves

**Why:** Server Components ship zero JavaScript to the browser and can read data directly. A `"use client"` directive converts the entire imported subtree into client bundle, so placing it high multiplies bundle size and forfeits server data access for everything below it.

**Do:**

```tsx
// app/posts/[id]/page.tsx — server component (no directive needed)
import { LikeButton } from "./_components/like-button";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const post = await getPost((await params).id);
  return (
    <article>
      {post.body}
      <LikeButton postId={post.id} /> {/* only the leaf is client code */}
    </article>
  );
}
```

```tsx
// app/posts/[id]/_components/like-button.tsx — the interactive leaf
"use client";

export function LikeButton({ postId }: { postId: string }) {
  return <button onClick={() => like(postId)}>Like</button>;
}
```

**Don't:**

```tsx
// page.tsx
"use client"; // one onClick handler dragged the whole page into the client bundle
export default function Page() { /* ... */ }
```

### NEXT-002 MUST NOT: Mark a layout as a client component to gain interactivity

**Why:** A layout wraps every route beneath it, so a client-side layout drags the whole segment tree into the client bundle and blocks server-side data access for every descendant page. Extract the interactive part into a client child instead.

**Do:**

```tsx
// app/dashboard/layout.tsx — stays a server component
import { SidebarNav } from "./_components/sidebar-nav"; // client island

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid">
      <SidebarNav />
      {children}
    </div>
  );
}
```

**Don't:**

```tsx
// app/dashboard/layout.tsx
"use client"; // every route under /dashboard is now client-rendered
export default function Layout({ children }: { children: React.ReactNode }) { /* ... */ }
```

**Exception:** A segment that is intrinsically one interactive surface (e.g. a canvas editor occupying the entire subtree) may use a client layout — record the decision where the team keeps architecture notes (see `documentation.md`).

### NEXT-003 MUST: Import `server-only` in every module that must never reach the client bundle

**Why:** Nothing else stops a client component from importing a module that touches secrets or privileged infrastructure; the failure is silent until runtime. The `server-only` package turns that mistake into a build error at the exact import site.

**Do:**

```ts
// lib/db.ts
import "server-only";

export const db = createPool(getEnv("DATABASE_URL"));
```

**Don't:**

```ts
// lib/db.ts — no guard: a stray client import fails confusingly at runtime
export const db = createPool(process.env.DATABASE_URL!);
```

### NEXT-004 MUST: Treat every `NEXT_PUBLIC_` variable as a deliberate, audited public API

**Why:** `NEXT_PUBLIC_` values are inlined into the client JavaScript at build time — they are visible to every visitor forever, and rotating them requires a rebuild. Adding the prefix is publishing, not configuring.

**Do:**

```bash
# audit the public surface before release; every hit must be intentionally public
grep -rn "NEXT_PUBLIC_" src/ .env.example | sort
```

**Don't:**

```bash
# .env — this "hides" nothing: the value ships in every visitor's bundle
NEXT_PUBLIC_STRIPE_SECRET_KEY=sk_live_...
```

### NEXT-005 MUST: Validate input with a schema and authorize inside every server action

**Why:** A server action is a public HTTP endpoint: anyone can invoke it with arbitrary payloads using curl, regardless of what the UI renders or which page-level checks ran. Authorization performed outside the action protects nothing.

**Do:**

```ts
"use server";
import { z } from "zod";

const Input = z.object({ projectId: z.string().min(1) });

export async function deleteProject(raw: unknown) {
  const { projectId } = Input.parse(raw);          // validate the wire payload
  const user = await requireUser();                 // authenticate inside the action
  await assertCanDelete(user, projectId);           // authorize inside the action
  await projects.delete(projectId);
}
```

**Don't:**

```ts
"use server";
export async function deleteProject(formData: FormData) {
  // trusts the caller: no schema, no auth — the page's checks do not apply here
  await projects.delete(formData.get("projectId") as string);
}
```

### NEXT-006 MUST: Declare caching intent explicitly at every data access

**Why:** Next.js caching defaults have changed across major versions and vary by context (fetch cache, full route cache, router cache); relying on a default you have not read produces stale data or accidental dynamic rendering. Since Next 15, `fetch()` and `GET` route handlers are uncached by default; under Next 16's Cache Components model (opted in via `cacheComponents: true`) all caching is fully opt-in via `"use cache"` and all dynamic code runs at request time — while without it, eligible pages are still statically prerendered by default. Written intent survives upgrades and review.

**Do:**

```ts
// intent is visible at the call site
const stats = await fetch(api("/stats"), { next: { revalidate: 300 } });
const me = await fetch(api("/me"), { cache: "no-store" });
```

```ts
// Cache Components (the current official model — Next 16, `cacheComponents: true`):
// declare intent with "use cache" plus cacheLife/cacheTag (stable in 16)
import { cacheLife, cacheTag } from "next/cache";

export async function getStats() {
  "use cache";
  cacheLife("minutes");
  cacheTag("stats");
  return fetchStats();
}
```

```ts
// previous model only — declared per segment, at the top of page.tsx / route.ts;
// removed when Cache Components is enabled
export const revalidate = 300;
// export const dynamic = "force-dynamic";
```

**Don't:**

```ts
// cached? for how long? depends on Next version and surrounding context
const stats = await fetch(api("/stats"));
```

When invalidating tagged data, use the two-argument `revalidateTag(tag, profile)` or `updateTag(tag)` in Server Actions — the single-argument `revalidateTag(tag)` form is deprecated in Next 16.

### NEXT-007 MUST: Type route handler params and set their caching semantics deliberately

**Why:** Since Next 15, `params` is a `Promise` and an untyped destructure hides that — and the temporary synchronous access from the 15.x period is fully removed in Next 16, so a hand-rolled sync destructure is now a hard runtime bug, not just a hidden typing gap. Caching defaults for `GET` handlers flipped across major versions: Next 14 cached them by default, silently freezing responses that should be per-request; since Next 15 they are dynamic unless explicitly opted in via `force-static` or `revalidate`. Declare caching intent explicitly either way so behavior survives major upgrades.

**Do:**

```ts
// app/api/projects/[id]/route.ts
export const dynamic = "force-dynamic"; // documents per-request intent; or opt into caching with `revalidate`

// RouteContext (with PageProps / LayoutProps) is generated during `next dev`,
// `next build`, or `npx next typegen` (since 15.5) — globally available, no import
export async function GET(_req: NextRequest, ctx: RouteContext<"/api/projects/[id]">) {
  const { id } = await ctx.params;
  return Response.json(await getProject(id));
}
```

```ts
// manual fallback without typegen: spell out the Promise explicitly
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return Response.json(await getProject(id));
}
```

**Don't:**

```ts
export async function GET(req, { params }) {
  return Response.json(await getProject(params.id)); // untyped; params is a Promise
}
```

### NEXT-008 MUST NOT: Run module-scope side effects that assume runtime environment

**Why:** `next build` imports and evaluates route-reachable modules, and CI build machines have no runtime env — a top-level client construction or env assertion crashes the build or bakes in wrong values. Initialize lazily so evaluation is free of side effects.

**Do:**

```ts
// lib/stripe.ts
import "server-only";

let stripe: Stripe | undefined;
export function getStripe(): Stripe {
  return (stripe ??= new Stripe(getEnv("STRIPE_SECRET_KEY")));
}
```

**Don't:**

```ts
// lib/stripe.ts — evaluated by `next build`; CI has no STRIPE_SECRET_KEY
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
```

### NEXT-009 MUST: Validate client-exposed env at build time and server env at boot

**Why:** `NEXT_PUBLIC_` values are frozen into the bundle at build, so a missing one must fail the build, not production. Server values must be proven present when the server starts — discovering a missing secret on the first request turns a config error into a user-facing 500.

**Do:**

```jsonc
// package.json — client-exposed vars checked before the bundle is produced
{ "scripts": { "prebuild": "node scripts/check-public-env.mjs" } }
```

```ts
// instrumentation.ts — server vars checked once, at boot, not per request
export async function register() {
  const { assertServerEnv } = await import("./lib/env"); // schema-parses process.env
  assertServerEnv();
}
```

**Don't:**

```ts
// deep in a request path — the deploy "succeeds", then the first user hits a 500
const key = process.env.RESEND_API_KEY ?? throwMissing("RESEND_API_KEY");
```

### NEXT-010 SHOULD: Organize `app/` with route groups, private folders, and colocation

**Why:** Route groups `(name)` organize segments and scope layouts without changing URLs; `_folders` opt out of routing entirely; colocating route-specific components next to their route keeps the blast radius of a change local and discoverable.

**Do:**

```text
app/
  (marketing)/          # route group: own layout, no URL segment
    layout.tsx
    page.tsx
  dashboard/
    _components/        # private: never routable, colocated with its route
      revenue-chart.tsx
    page.tsx
```

**Don't:**

```text
app/
  dashboard/page.tsx
components/
  dashboard-revenue-chart.tsx   # route-specific code stranded in a global bin
```

Cross-route shared modules still belong in a shared location per `code-organization.md` — colocation is for code owned by one route.

### NEXT-011 SHOULD: Stream with Suspense at meaningful UI seams and provide segment state files

**Why:** Wrapping slow data in a Suspense boundary lets the shell render immediately while the slow part streams in; `loading.tsx`, `error.tsx`, and `not-found.tsx` give each segment isolated loading, failure, and 404 states instead of blanking the whole page.

**Do:**

```tsx
// app/dashboard/page.tsx — header paints now, chart streams when ready
export default function Page() {
  return (
    <>
      <Header />
      <Suspense fallback={<ChartSkeleton />}>
        <RevenueChart /> {/* async server component */}
      </Suspense>
    </>
  );
}
// siblings: loading.tsx (route-level fallback), error.tsx ("use client" boundary), not-found.tsx
```

**Don't:**

```tsx
export default async function Page() {
  const revenue = await getRevenue(); // slowest fetch blocks first paint of everything
  return (<><Header /><RevenueChart data={revenue} /></>);
}
```

Place boundaries at seams a user would recognize (a card, a panel), not around every await.

### NEXT-012 MUST: Parallelize independent data fetches

**Why:** Sequential `await`s in a server component serialize network round trips; three independent 200 ms fetches become 600 ms of blocking for no reason. Waterfalls are the dominant self-inflicted latency in App Router code.

**Do:**

```ts
const [user, projects] = await Promise.all([getUser(id), getProjects(id)]);
```

```ts
// preload pattern: kick off a fetch before the component that awaits it renders
export function preloadProjects(id: string) {
  void getProjects(id); // getProjects is deduplicated via React cache()
}
```

**Don't:**

```ts
const user = await getUser(id);
const projects = await getProjects(id); // does not depend on `user`, yet waits for it
```

**Exception:** Genuinely dependent fetches (the second needs the first's result) are sequential by nature.

### NEXT-013 MUST: Keep proxy (formerly middleware) thin

**Why:** Proxy runs before every matched request, so any heavy work — DB session lookups, slow fetches — multiplies into site-wide latency; it is officially not intended for slow data fetching nor as a full session-management or authorization solution, and fetch cache options have no effect there. In Next 16 proxy runs on the Node.js runtime (edge is not supported in proxy; `middleware.ts` survives only as a deprecated edge-runtime escape hatch slated for removal). Keep it to routing decisions on cheap signals; do real work in the route.

**Do:**

```ts
// proxy.ts — cookie presence check and redirect only
// (a default export is also accepted; standardize on the named export)
export function proxy(request: NextRequest): NextResponse | undefined {
  if (!request.cookies.has("session")) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
}
export const config = { matcher: ["/dashboard/:path*"] };
```

**Don't:**

```ts
export async function proxy(request: NextRequest) {
  const session = await db.sessions.findOne(/* ... */); // DB call on every matched
  // request — site-wide latency; proxy is not a session or authorization layer
}
```

### NEXT-014 SHOULD: Use `next/image` and `next/font` instead of raw tags

**Why:** `next/image` provides sizing, responsive srcsets, lazy loading, and layout-shift prevention that a raw `<img>` forfeits; `next/font` self-hosts fonts with zero layout shift and no render-blocking third-party request.

**Do:**

```tsx
import Image from "next/image";
import { Inter } from "next/font/google";

const inter = Inter({ subsets: ["latin"] });

<Image src={hero} alt="Dashboard overview" priority />
```

**Don't:**

```tsx
<img src="/hero.png" /> {/* no dimensions: layout shift; no lazy loading */}
<link href="https://fonts.googleapis.com/css2?family=Inter" rel="stylesheet" />
```

**Exception:** Inline SVG icons and images from loaders `next/image` cannot serve may use raw tags — set explicit `width`/`height` to avoid layout shift.
