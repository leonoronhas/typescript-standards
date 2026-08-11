---
name: react
description: React component, hook, state, context, form, and accessibility standards layered on top of the core TypeScript guide
load_when:
  - "Writing or reviewing React components, hooks, or JSX"
  - "Designing the props or state shape of a React component"
  - "Fetching, caching, or mutating server data from a React app"
  - "Debugging unnecessary re-renders, stale state, or effect loops"
  - "Building forms, context providers, or accessible interactive UI in React"
  - "Deciding whether to memoize, split context, or extract a custom hook"
rule_prefix: REACT
---

# React standards

This file governs React-specific concerns: component and prop typing, hooks, state architecture, effects, server state, context, forms, keys, memoization, error boundaries, and accessibility. Language- and compiler-level rules live in `typescript-language.md`; framework-agnostic design patterns in `reusable-patterns.md`; sanitization and lint tooling in `security-and-linting.md`; test standards in `testing-tdd.md`; file placement and colocation (components, hooks, their tests) in `code-organization.md`. Next.js-specific concerns (server components, routing, data loaders) layer on top in `nextjs.md` and win where they are more specific. One compiler setting `typescript-language.md` delegates to this addendum: React projects set `"jsx": "react-jsx"` in tsconfig (Next.js manages this automatically — see `nextjs.md`).

## Quick reference

| ID | Level | Rule |
| --- | --- | --- |
| REACT-001 | MUST | Write function components as plain functions with an explicitly typed props parameter |
| REACT-002 | MUST | Type children, event handlers, and refs with the precise React types |
| REACT-003 | MUST | Model mutually exclusive prop variants as a discriminated union |
| REACT-004 | MUST NOT | Define one component inside another component's body |
| REACT-005 | MUST | Keep state minimal and compute derived values at render |
| REACT-006 | SHOULD | Colocate state with the lowest component that needs it |
| REACT-007 | MUST NOT | Use useEffect for data transforms or reactions to state you own |
| REACT-008 | MUST | Manage server state with a query library, not useState plus useEffect |
| REACT-009 | SHOULD | Extract reusable stateful logic into custom hooks with explicitly shaped returns |
| REACT-010 | MUST | Key list items by stable identity, never by array index for reorderable lists |
| REACT-011 | SHOULD | Memoize only for problems you have measured |
| REACT-012 | MUST | Wrap each feature surface in an error boundary |
| REACT-013 | SHOULD | Keep form inputs deliberately controlled with typed values; adopt a form library at scale |
| REACT-014 | MUST | Keep context small, split by change frequency, and expose it through a throwing typed accessor |
| REACT-015 | MUST | Use semantic elements and keep every interactive element keyboard-reachable |
| REACT-016 | MUST | Sanitize any value that reaches dangerouslySetInnerHTML |
| REACT-017 | MAY | Code-split heavy feature surfaces with lazy and Suspense |
| REACT-018 | SHOULD | Test components and hooks through their accessible, user-visible surface |

## Rules

### REACT-001 MUST: Write function components as plain functions with an explicitly typed props parameter

**Why:** Function components are the only component form current React invests in, and typing the props parameter directly keeps generics, narrowing, and return types working without wrapper friction. `React.FC` is not required: it adds nothing for typed props, blocks generic components, and (in older type definitions) implied a `children` prop the component may not accept — this guide standardizes on the plain-function form so there is exactly one way to declare a component. A component's inferred JSX return type is the sanctioned exception to TS-008 in `typescript-language.md` — exported functions otherwise annotate their returns.

**Do:**

```tsx
interface ButtonProps {
  label: string;
  onClick: () => void;
}

export function Button({ label, onClick }: ButtonProps) {
  return <button onClick={onClick}>{label}</button>;
}
```

**Don't:**

```tsx
// Class components and React.FC are both off-standard.
export const Button: React.FC<ButtonProps> = ({ label, onClick }) => (
  <button onClick={onClick}>{label}</button>
);
```

**Exception:** Class components remain acceptable where React requires them, i.e. hand-written error boundaries (see REACT-012).

### REACT-002 MUST: Type children, event handlers, and refs with the precise React types

**Why:** `ReactNode`, the specific `React.*EventHandler` types, and element-typed refs give the compiler enough information to catch wrong element types, wrong event shapes, and null-ref mistakes; `Function`, `any`, or `JSX.Element` for children erase exactly the checks React code needs most. A component that exposes a ref accepts it as an ordinary prop typed with the element-specific `Ref` type (e.g. `ref?: Ref<HTMLInputElement>`); new code must not use `forwardRef` — it is no longer necessary in React 19 and will be deprecated in a future release.

**Do:**

```tsx
import { useRef, type ReactNode, type ChangeEventHandler, type Ref } from "react";

interface FieldProps {
  children: ReactNode; // accepts elements, strings, fragments, null
  onChange: ChangeEventHandler<HTMLInputElement>;
  ref?: Ref<HTMLInputElement>; // ref as an ordinary prop — no forwardRef
}

export function Field({ children, onChange, ref }: FieldProps) {
  return (
    <label>
      {children}
      <input ref={ref} onChange={onChange} />
    </label>
  );
}

export function Form({ onEmailChange }: { onEmailChange: ChangeEventHandler<HTMLInputElement> }) {
  const emailRef = useRef<HTMLInputElement>(null); // local ref typed to the element
  return <Field ref={emailRef} onChange={onEmailChange}>Email</Field>;
}
```

**Don't:**

```tsx
interface FieldProps {
  children: JSX.Element; // rejects strings, arrays, null
  onChange: Function; // no event or element type checking
}
// const inputRef = useRef<any>(null); // discards element typing entirely
// export const Field = forwardRef<HTMLInputElement, FieldProps>(...);
//   // legacy pattern: pass ref as a plain prop instead
```

### REACT-003 MUST: Model mutually exclusive prop variants as a discriminated union

**Why:** When a component has modes whose props only make sense together, a discriminated union makes illegal combinations unrepresentable at the type level, so misuse fails at compile time instead of producing a half-configured component at runtime.

**Do:**

```ts
type AlertProps =
  | { kind: "confirm"; onConfirm: () => void; onCancel: () => void }
  | { kind: "notice"; dismissAfterMs: number };
// <Alert kind="notice" onConfirm={...}> is now a type error.
```

**Don't:**

```ts
interface AlertProps {
  kind: "confirm" | "notice";
  onConfirm?: () => void; // nothing stops kind="confirm" without it
  onCancel?: () => void;
  dismissAfterMs?: number; // nothing stops it on kind="confirm"
}
```

### REACT-004 MUST NOT: Define one component inside another component's body

**Why:** A component defined inside another gets a new function identity on every parent render, so React unmounts and remounts it each time — destroying its state, refetching, and re-running effects. This is a correctness bug, not a style issue.

**Do:**

```tsx
function Row({ item }: { item: Item }) {
  return <li>{item.name}</li>;
}

export function List({ items }: { items: Item[] }) {
  return <ul>{items.map((item) => <Row key={item.id} item={item} />)}</ul>;
}
```

**Don't:**

```tsx
export function List({ items }: { items: Item[] }) {
  // New component type every render: Row remounts and loses state.
  function Row({ item }: { item: Item }) {
    return <li>{item.name}</li>;
  }
  return <ul>{items.map((item) => <Row key={item.id} item={item} />)}</ul>;
}
```

### REACT-005 MUST: Keep state minimal and compute derived values at render

**Why:** Every piece of state that can be computed from other state is a synchronization liability — it can go stale, and keeping it fresh requires extra effects and renders. Store only the irreducible facts; derive everything else in the render body.

**Do:**

```tsx
const [items, setItems] = useState<Item[]>([]);
const total = items.reduce((sum, item) => sum + item.price, 0); // always fresh
```

**Don't:**

```tsx
const [items, setItems] = useState<Item[]>([]);
const [total, setTotal] = useState(0); // duplicate of items
useEffect(() => {
  setTotal(items.reduce((sum, item) => sum + item.price, 0)); // extra render, can lag
}, [items]);
```

**Exception:** Cache a genuinely expensive derivation with `useMemo` once profiling shows it matters (REACT-011) — that is still derivation, not duplicated state.

### REACT-006 SHOULD: Colocate state with the lowest component that needs it

**Why:** State held higher than necessary re-renders subtrees that do not care about it and couples unrelated components; state held too low gets duplicated across siblings. Place each piece of state in the closest common ancestor of everything that reads or writes it, and lift it only when a second consumer actually appears.

**Exception:** State that is legitimately app-wide (theme, session, feature flags) belongs in context (REACT-014) or a store, not threaded through every intermediate component as props.

### REACT-007 MUST NOT: Use useEffect for data transforms or reactions to state you own

**Why:** `useEffect` exists to synchronize a component with a system outside React — a socket, a subscription, the DOM, a browser API. Using it to derive data or to "respond" to your own state change produces an extra render per update, invites infinite loops, and hides data flow that belongs in the render body or in the event handler that caused the change.

**Do:**

```tsx
// External system: subscribe on mount/roomId change, clean up on the way out.
useEffect(() => {
  const socket = connectToRoom(roomId);
  return () => socket.close();
}, [roomId]);
```

**Don't:**

```tsx
// Owned state reacting to owned state: derive it at render instead (REACT-005),
// or set both pieces of state in the event handler that changed `first`/`last`.
useEffect(() => {
  setFullName(`${first} ${last}`);
}, [first, last]);
```

**Exception:** None for transforms. Effects that talk to external systems must also return a cleanup function and tolerate running twice in development Strict Mode.

### REACT-008 MUST: Manage server state with a query library, not useState plus useEffect

**Why:** Server data is a cache, not component state: it needs deduplication, race handling, revalidation, retries, and cancellation, and every hand-rolled `useEffect` fetch re-implements those badly (the classic bugs are out-of-order responses and setting state after unmount). A query layer — TanStack Query, SWR, or your framework's loader — provides all of it declaratively.

**Do:**

```tsx
const { data: user, error, isPending } = useQuery({
  queryKey: ["user", userId],
  queryFn: () => fetchUser(userId),
});
```

**Don't:**

```tsx
const [user, setUser] = useState<User | null>(null);
useEffect(() => {
  fetchUser(userId).then(setUser); // races on fast userId changes, no cache,
}, [userId]);                      // no retry, sets state after unmount
```

**Exception:** A one-shot fire-and-forget call inside an event handler (e.g. logging a click) needs no query library.

### REACT-009 SHOULD: Extract reusable stateful logic into custom hooks with explicitly shaped returns

**Why:** A custom hook is the unit of reuse for stateful logic — it keeps components declarative and makes the logic testable in isolation. Return `as const` tuples for two-value hooks (callers pick names, like `useState`) and a named object once there are three or more values (callers pick fields without positional errors).

**Do:**

```ts
export function useToggle(initial = false) {
  const [on, setOn] = useState(initial);
  const toggle = useCallback(() => setOn((v) => !v), []);
  return [on, toggle] as const; // readonly [boolean, () => void]
}
```

**Don't:**

```ts
export function useToggle(initial = false) {
  const [on, setOn] = useState(initial);
  const toggle = useCallback(() => setOn((v) => !v), []);
  return [on, toggle]; // widens to (boolean | (() => void))[] — callers lose types
}
```

### REACT-010 MUST: Key list items by stable identity, never by array index for reorderable lists

**Why:** React uses keys to match items across renders; an index key means that inserting, removing, filtering, or sorting reassigns identities, so component state, focus, and animations attach to the wrong rows. Use an identifier that survives reordering — a database id, a slug, a composite natural key.

**Do:**

```tsx
{items.map((item) => (
  <Row key={item.id} item={item} />
))}
```

**Don't:**

```tsx
{items.map((item, index) => (
  <Row key={index} item={item} /> // wrong state pairing after sort/filter/insert
))}
```

**Exception:** An index key is acceptable only for a static list that is never reordered, filtered, or edited and whose items carry no state of their own.

### REACT-011 SHOULD: Memoize only for problems you have measured

**Why:** `useMemo`, `useCallback`, and `memo` are caches: each one adds code, dependency-array maintenance, and its own comparison cost, and most of them guard renders that were never slow. The React Compiler (stable since 1.0, Oct 2025) memoizes automatically and should be enabled on new projects — with it, rely on the compiler and reach for manual memoization only where precise control is required. Without it, add memoization only when a profiler shows a concrete re-render or recomputation problem. When adopting the compiler in an existing codebase, leave existing memoization in place or remove it only with careful testing — removal can change compilation output. The compiler's lint rules ship in `eslint-plugin-react-hooks`' recommended presets (see `security-and-linting.md` for lint wiring).

**Do:**

```tsx
// Profiler showed this filter dominates render time on a 10k-row table.
const visibleRows = useMemo(() => rows.filter(matches(filter)), [rows, filter]);
```

**Don't:**

```tsx
// Reflexive memoization of a trivial computation and a cheap callback.
const label = useMemo(() => `${first} ${last}`, [first, last]);
const onClick = useCallback(() => setOpen(true), []);
```

**Exception:** Memoize for referential stability when identity is a correctness requirement, not a performance one — e.g. a value consumed in another hook's dependency array or by a `memo`-wrapped child whose contract demands stable props.

### REACT-012 MUST: Wrap each feature surface in an error boundary

**Why:** An uncaught render error unmounts the entire React tree; without boundaries, one broken widget blanks the whole app. A boundary per feature surface (route, panel, dialog, independent widget) contains the blast radius and gives each surface a meaningful fallback.

**Do:**

```tsx
import { ErrorBoundary } from "react-error-boundary";

<ErrorBoundary fallback={<PanelError />} onError={reportError}>
  <BillingPanel />
</ErrorBoundary>
```

**Don't:**

```tsx
// One boundary at the root only: any widget error blanks every surface at once,
// and the fallback can't say anything more useful than "something broke".
<ErrorBoundary fallback={<GlobalError />}>
  <App />
</ErrorBoundary>
```

**Exception:** A root-level boundary is still required as the last line of defense — the rule is that it must not be the only one. Error boundaries do not catch errors in event handlers or async code; handle those where they occur and report them (see `security-and-linting.md` for logging hygiene).

### REACT-013 SHOULD: Keep form inputs deliberately controlled with typed values; adopt a form library at scale

**Why:** For simple forms, controlled inputs with a typed value object keep the data flow visible and validated in one place; mixing controlled and uncontrolled behavior on the same input causes React warnings and lost keystrokes. Past a handful of fields, a typed form library (e.g. React Hook Form with a schema resolver) handles registration, validation, and error state better than hand-rolled `useState` per field.

For submission-centric forms — especially with server functions in a Next.js app — the React 19 Actions model is the sanctioned third option: pass an async function to `<form action>` and read its result with `useActionState` (plus `useOptimistic` for optimistic updates). React wraps the submission in a Transition, hands the action the submitted `FormData`, and exposes a built-in `isPending` — subsuming hand-rolled `isSubmitting`/error state. Controlled inputs and a form library remain the standard for rich interactive client-side validation.

**Do:**

```tsx
interface SignupValues {
  email: string;
}

const [values, setValues] = useState<SignupValues>({ email: "" });

<input
  value={values.email}
  onChange={(e) => setValues({ ...values, email: e.target.value })}
/>
```

**Don't:**

```tsx
// email is absent until the first keystroke, so value genuinely flips
// undefined → string: React logs a controlled/uncontrolled warning.
const [values, setValues] = useState<{ email?: string }>({});

<input value={values.email} onChange={handleChange} />
```

**Exception:** Uncontrolled inputs read via refs (or via a form library that manages them) are fine — the rule forbids accidental hybrids, not the uncontrolled model itself. Validate submitted values with a schema before trusting them (see `security-and-linting.md`).

### REACT-014 MUST: Keep context small, split by change frequency, and expose it through a throwing typed accessor

**Why:** Every consumer re-renders whenever its context value changes, so one broad context couples fast-changing state to consumers that only need stable state. Splitting by change frequency limits re-renders, and a `useX()` accessor that throws outside its provider converts a silent `null` at runtime into an immediate, located failure — and gives callers a non-nullable type.

**Do:**

```tsx
const ThemeContext = createContext<Theme | null>(null);

export function useTheme(): Theme {
  const theme = useContext(ThemeContext);
  if (theme === null) {
    throw new Error("useTheme must be used within <ThemeProvider>");
  }
  return theme; // non-nullable for every caller
}
```

**Don't:**

```tsx
// One mega-context: a keystroke in `draft` re-renders every theme consumer,
// and every consumer must null-check.
const AppContext = createContext<{ theme: Theme; draft: string } | null>(null);
const ctx = useContext(AppContext); // Ctx | null at every call site
```

### REACT-015 MUST: Use semantic elements and keep every interactive element keyboard-reachable

**Why:** Semantic elements (`button`, `a`, `label`, `nav`, heading levels) give assistive technology and the keyboard their behavior for free; a `div` with an `onClick` is invisible to screen readers and unreachable by keyboard until you rebuild focus, role, and key handling by hand. Accessibility is a requirement of done, not a polish pass — enforce it with eslint-plugin-jsx-a11y (see `security-and-linting.md`).

**Do:**

```tsx
<button type="button" onClick={openMenu}>Menu</button>
<label>
  Email
  <input type="email" value={email} onChange={onEmailChange} />
</label>
```

**Don't:**

```tsx
<div onClick={openMenu}>Menu</div> {/* no role, no focus, no Enter/Space */}
<span className="label">Email</span><input type="email" />
```

**Exception:** When no semantic element fits, a custom widget must supply the full contract itself: `role`, `tabIndex`, keyboard handlers, and ARIA state.

### REACT-016 MUST: Sanitize any value that reaches dangerouslySetInnerHTML

**Why:** `dangerouslySetInnerHTML` bypasses React's escaping, so any attacker-influenced string that reaches it is a stored or reflected XSS. Sanitize at the point of injection with a maintained sanitizer, never with a hand-rolled regex; scanning and lint enforcement for this sink live in `security-and-linting.md`.

**Do:**

```tsx
import DOMPurify from "dompurify";

<article dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(commentHtml) }} />
```

**Don't:**

```tsx
// User-influenced HTML injected raw: stored XSS.
<article dangerouslySetInnerHTML={{ __html: commentHtml }} />
```

**Exception:** None. Even "trusted" CMS or Markdown output goes through the sanitizer — trust boundaries move, the sanitizer call does not.

### REACT-017 MAY: Code-split heavy feature surfaces with lazy and Suspense

**Why:** Rarely visited, dependency-heavy surfaces (editors, chart dashboards, admin panels) can dominate the initial bundle; `lazy` plus a `Suspense` fallback defers their cost until first use. Split at feature boundaries with a meaningful fallback — splitting every small component just multiplies network round-trips.

**Do:**

```tsx
const ChartPanel = lazy(() => import("./chart-panel"));

<Suspense fallback={<PanelSkeleton />}>
  <ChartPanel />
</Suspense>
```

**Don't:**

```tsx
// Splitting a tiny always-rendered component: adds a request and a
// loading flash, saves nothing.
const Badge = lazy(() => import("./badge"));
```

### REACT-018 SHOULD: Test components and hooks through their accessible, user-visible surface

**Why:** Tests that query what users perceive — roles, labels, visible text — survive refactors and fail only when behavior changes; tests that reach into state or DOM internals break on every rename and keep passing while the UI is broken for real users. React Testing Library's accessibility-first queries (`getByRole`, `getByLabelText`) double as a check that the surface is accessible at all (REACT-015); `user-event` simulates real interaction sequences where `fireEvent` dispatches a single synthetic event — `userEvent.setup()` before render is the recommended v14+ pattern; direct `userEvent.*` calls are a v13-to-v14 migration convenience; `renderHook` tests a hook without a scaffold component. The red-green loop and the choice of test level are governed by `testing-tdd.md`.

**Do:**

```tsx
import { render, screen, renderHook, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

test("submits the entered email", async () => {
  const onSubmit = vi.fn();
  const user = userEvent.setup(); // set up before render
  render(<SignupForm onSubmit={onSubmit} />);
  await user.type(screen.getByLabelText("Email"), "a@b.co");
  await user.click(screen.getByRole("button", { name: "Sign up" }));
  expect(onSubmit).toHaveBeenCalledWith({ email: "a@b.co" });
});

test("useToggle flips", () => {
  const { result } = renderHook(() => useToggle());
  act(() => result.current[1]());
  expect(result.current[0]).toBe(true);
});
```

**Don't:**

```tsx
// Implementation details: break on rename, pass while the UI is broken.
expect(wrapper.state("email")).toBe("a@b.co"); // reaching into state
fireEvent.change(input, { target: { value: "a@b.co" } }); // bypasses real typing
expect(container).toMatchSnapshot(); // snapshot as a lazy assertion
```
