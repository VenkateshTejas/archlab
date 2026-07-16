# ArchLab — Learn System Design by Swapping Components

**▶ Live demo: https://aarchlab.netlify.app**

Interactive reference architectures for high-stakes systems. Click any component
to see the real design decision behind it, then **swap the technology and watch
what breaks downstream**. Curated, accurate, counterfactual — not an LLM guessing.

> The wedge: existing tools are either descriptive ("here's what a cache is") or
> blank-canvas ("build your own and simulate"). ArchLab does **counterfactual
> exploration on a real, opinionated design** — "here's the decision Instagram
> actually made; now swap it and see the cascade and the why."

## Domains (v1)

| Domain | The hard problem |
| --- | --- |
| Ticket & Slot Booking | Prevent double-booking under a thundering herd |
| Social Media Feed | Serve a personalized feed to millions (read-optimized) |
| E-commerce Checkout | Never oversell inventory; never double-charge on retry |
| Live Betting Exchange | Push live odds, accept bets under spikes, settle correctly |

## How it works

The engine is **domain-agnostic**. A domain is just a data file in `src/data/`
that conforms to the `Domain` type in `src/types.ts`:

- **nodes** — components with a category, role, and (optionally) a `decision`
- **edges** — how requests/data flow between them
- each **decision** has 2–4 `options`, each with authored
  `whatBreaks` / `tradeoffs` / `why` prose and an `affects` list

Selecting an option updates the node's tech chip and **highlights the downstream
nodes that choice affects** (the consequence cascade). All content is hand-authored
— zero runtime LLM calls, zero backend, zero cost.

### It teaches the whole interview framework

The tool is structured around the 5-step system-design interview (Alex Xu):

1. **Scope** — functional + non-functional requirements (`requirements` in each domain)
2. **Estimate** — back-of-the-envelope numbers (`scale`)
3. **High-level design** — the canvas
4. **Deep dive** — click a node, swap a decision, see the cascade
5. **Wrap up** — the transferable `principle` each domain teaches

Steps 1, 2, 5 live in the **Domain Brief** (default right panel). Steps 3–4 are the
canvas + inspector. **Quiz mode** hides the consequences and asks you to *predict
before revealing* — active recall, the highest-leverage way to actually learn this.

### The Patterns view (the payoff)

A dedicated tab surfaces the meta-lesson: system design is a small set of patterns
reskinned across domains. Each pattern (un-bypassable correctness constraint,
idempotency, reservation+TTL, cache-the-hot-path, async decoupling) lists every
place it recurs — and each instance **links straight to that node in its domain**,
so you see the abstraction and the concrete side by side. Content lives in
`src/data/patterns.ts`.

### Accuracy — because it's a learning source

The content is the product, so it's held to a high bar. Every architecture went
through **two rounds of independent adversarial technical review** (one expert
pass per domain, then a second pass verifying each fix landed and caught no
regressions). That process found and fixed real issues — e.g. invalid Postgres
partial-index syntax, a fund-oversell hole in the betting flow (stale balance
read → now a synchronous stake hold), and DNS drawn as an in-path hop (now a
distinct dotted control-plane edge). The claims that survived — the
partial-unique-index guarantee, the Redlock critique, fan-out / celebrity
hot-key, idempotency (concurrent-retry + retention window), LMAX journal-before-ack,
double-entry ledgers — are the load-bearing lessons.

### Add a new domain
1. Create `src/data/myDomain.ts` exporting a `Domain`.
2. Add it to the array in `src/data/index.ts`.
3. Done — no engine changes.

## Run locally

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # production build into dist/
```

## Deploy for $0

It's a static SPA (`base: './'` so it works on any subpath). This repo is
deployed on **Netlify** via [`netlify.toml`](./netlify.toml) — every push to
`main` auto-redeploys (build `npm run build`, publish `dist`, Node 20). Any
static host works too (Vercel, GitHub Pages, Cloudflare Pages).

## Stack

React + TypeScript + [@xyflow/react](https://reactflow.dev) (React Flow), built with Vite.
