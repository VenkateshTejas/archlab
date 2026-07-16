import type { Domain } from '../types'

// Reference design: high-contention seat/slot booking (Ticketmaster-class).
// Sourced from the SlotLock design doc — the central insight is that the
// DB partial unique index is what *actually* makes double-booking impossible;
// every other layer is speed + UX on top of that one guarantee.
//
// The diagram is a COMPLETE architecture: most nodes are context (DNS, CDN, LB,
// gateway, auth, replica, storage, observability) with a rich "what & why", and
// a handful carry the teachable swap decisions.
export const ticketing: Domain = {
  id: 'ticketing',
  name: 'Ticket & Slot Booking',
  tagline: 'Prevent double-booking under a thundering herd of concurrent buyers.',
  referenceNote:
    'Modeled on Ticketmaster / high-contention reservation systems. The hard problem is correctness under concurrency, not throughput.',
  requirements: {
    functional: [
      'Browse events and see which slots are available',
      'Place a temporary hold on a slot while paying',
      'Confirm a booking, or auto-release the hold on timeout',
      'Every slot is sold to exactly one buyer',
    ],
    nonFunctional: [
      'Strong consistency on bookings — choose consistency over availability when they conflict',
      'Place a hold in <100ms even under load',
      'Survive flash-sale spikes (~1000× normal traffic)',
      'Fair admission when many buyers contend for one slot',
    ],
  },
  scale: [
    { metric: 'Peak concurrent buyers, one hot event', value: '~200k' },
    { metric: 'Hold window', value: '8 min TTL', note: 'auto-expires abandoned carts' },
    { metric: 'Workload shape', value: 'browse-heavy reads, but writes are the hard part' },
    { metric: 'Tolerated double-bookings', value: '0', note: 'non-negotiable' },
  ],
  principle: {
    title: 'Correctness belongs at the source of truth',
    body:
      'Every layer above the database — waiting room, Redis claim, app-level checks — exists for speed and UX. Exactly one layer is load-bearing for correctness: a constraint the database itself physically enforces (the partial unique index). Defense in depth is good, but you must always be able to point to the single layer that makes the bad outcome impossible, not merely unlikely.',
  },
  nodes: [
    {
      id: 'client',
      label: 'Client',
      category: 'client',
      role: 'Web & mobile apps. Renders the event page and fires booking requests — including thousands of buyers hammering "book" on the same hot slot at the same instant.',
      position: { x: 0, y: 320 },
    },
    {
      id: 'dns',
      label: 'DNS',
      category: 'edge',
      role: 'Resolves your domain to an IP. Often does geo-routing — sending each user to the nearest region — and points static-asset hostnames at the CDN. It is a lookup, not a traffic hop: the client then connects directly.',
      position: { x: 220, y: 160 },
    },
    {
      id: 'cdn',
      label: 'CDN',
      category: 'edge',
      role: 'Caches static assets (event images, JS/CSS, ticket PDFs) at edge locations near the user, so the vast majority of bytes never touch your servers.',
      position: { x: 220, y: 480 },
    },
    {
      id: 'lb',
      label: 'Load Balancer',
      category: 'edge',
      role: 'The entry point to your fleet. Spreads incoming requests across gateway/app instances, health-checks them, and removes dead nodes from rotation.',
      position: { x: 440, y: 320 },
    },
    {
      id: 'gateway',
      label: 'API Gateway',
      category: 'edge',
      role: 'Single front door to the backend: terminates TLS, authenticates each request (via the auth service), enforces rate limits, and routes to the right service.',
      position: { x: 660, y: 180 },
    },
    {
      id: 'auth',
      label: 'Auth Service',
      category: 'compute',
      role: 'Issues and validates tokens (JWT/session) so every downstream request is tied to a known user — required to attribute a hold/booking and to enforce per-user limits.',
      position: { x: 660, y: 460 },
    },
    {
      id: 'waitingRoom',
      label: 'Virtual Waiting Room',
      category: 'edge',
      role: 'Admission control in front of the booking service for hot events — it decides who gets through and when, so the backend sees a steady trickle instead of a spike.',
      position: { x: 900, y: 100 },
      decision: {
        question: 'How do we absorb a flash crowd hitting one event?',
        options: [
          {
            id: 'waiting-room',
            label: 'Virtual Waiting Room',
            isDefault: true,
            summary: 'Queue users at the edge; admit a steady trickle.',
            whatBreaks:
              'Nothing downstream breaks — that is the point. The booking service sees a bounded request rate instead of a spike.',
            tradeoffs:
              'Adds infrastructure (a queue + token issuance) and a UX surface ("you are #4,213 in line"). Users wait, but the system stays responsive and fair.',
            why:
              'For genuine flash sales (Taylor Swift on-sale), it is the only thing that keeps the database from melting. It converts an unbounded spike into a flat, survivable load.',
            affects: ['bookingSvc', 'db'],
          },
          {
            id: 'rate-limit',
            label: 'Rate Limiter only',
            summary: 'Token-bucket per IP/user; reject overflow with 429.',
            whatBreaks:
              'Legitimate buyers get rejected during the spike and must retry blindly. No fairness — fast retriers win, not first-comers.',
            tradeoffs:
              'Far cheaper and simpler than a waiting room. Protects the backend but pushes a bad, chaotic experience onto users.',
            why:
              'Fine for moderately hot slots where spikes are 5–10x, not 1000x. A good default before you have flash-sale-grade traffic.',
            affects: ['bookingSvc'],
          },
          {
            id: 'none',
            label: 'Nothing',
            summary: 'Let every request hit the booking service directly.',
            whatBreaks:
              'Under a true flash crowd the booking service and DB saturate; latency explodes, connections exhaust, and legitimate bookings time out. The system fails exactly when it matters most.',
            tradeoffs:
              'Zero infrastructure. Totally fine until you have contention — then catastrophic.',
            why:
              'Acceptable only for low-traffic booking (a small gym, a clinic) where simultaneous contention on one slot is rare.',
            affects: ['bookingSvc', 'db'],
          },
        ],
      },
    },
    {
      id: 'search',
      label: 'Catalog / Search Service',
      category: 'compute',
      role: 'Powers browsing events and seat availability — the read-heavy path. Kept separate from the write-critical booking path so heavy browsing never slows down a sale.',
      position: { x: 900, y: 460 },
    },
    {
      id: 'bookingSvc',
      label: 'Booking Service',
      category: 'compute',
      role: 'The core write path: validates the request, places a hold, takes payment, and then either confirms the booking in-request (sync) or enqueues its confirmation to a worker (async). This is where the concurrency decisions live.',
      position: { x: 1140, y: 240 },
      decision: {
        question: 'How do we confirm a booking after payment?',
        options: [
          {
            id: 'async',
            label: 'Async confirm (queue)',
            isDefault: true,
            summary: 'Hold the slot, take payment, enqueue confirmation; finalize on a worker.',
            whatBreaks:
              'Nothing breaks, but you must handle "pending" UX and make the consumer idempotent so a redelivered message does not double-confirm.',
            tradeoffs:
              'Decouples the slow finalization work (confirmed-row write, ticket generation, emails) from the request. Adds a queue + worker and eventual-consistency reasoning.',
            why:
              'The hold (with TTL) already guarantees the slot is yours; the slow finalization work (writing the confirmed row, generating the ticket PDF, emails) just needs to *eventually* happen. Running it on a worker keeps the booking request fast.',
            affects: ['queue', 'db', 'payment'],
          },
          {
            id: 'sync',
            label: 'Synchronous confirm',
            summary: 'Take payment and write the confirmed booking in one request.',
            whatBreaks:
              'A slow payment provider holds a DB connection + transaction open the whole time. Under load, connection pools exhaust and the lock is held longer, shrinking your effective concurrency.',
            tradeoffs:
              'Dead simple — no queue, no worker, no eventual consistency. But it couples your throughput to the slowest external call.',
            why:
              'Great for low volume where simplicity wins and payment latency is not your bottleneck.',
            affects: ['db', 'payment'],
          },
        ],
      },
    },
    {
      id: 'notification',
      label: 'Notification Service',
      category: 'compute',
      role: 'Sends booking confirmations and reminders via email/SMS/push. Driven off the queue so a slow email provider never blocks or fails a booking.',
      position: { x: 1140, y: 480 },
    },
    {
      id: 'holdStore',
      label: 'Hold Store (Redis)',
      category: 'cache',
      role: 'Holds a temporary claim on a slot with a TTL while the user pays — the fast "you have 8 minutes" layer that gives a smooth UX without locking the database.',
      position: { x: 1380, y: 60 },
      decision: {
        question: 'Where do we keep the temporary hold (the "you have 8 minutes" claim)?',
        options: [
          {
            id: 'redis-ttl',
            label: 'Redis with TTL',
            isDefault: true,
            summary: 'SET hold:slot NX EX 480 — atomic claim that auto-expires.',
            whatBreaks:
              'A subtle one: if a slow buyer\'s hold TTL expires mid-checkout, another buyer can claim the slot — the DB unique index, not Redis, is what breaks that tie (the buyer just sees "your hold expired"). And Redis is now on the critical path: if it is down you fail closed — a safe default, though with the unique index in place you could instead fall back to DB-only holds and still never double-book.',
            tradeoffs:
              'Sub-millisecond atomic claims and automatic expiry (no cron to reap stale holds). Adds an in-memory store to operate; data is ephemeral by design.',
            why:
              'TTL-based expiry is the killer feature — abandoned carts free their slot automatically. SET NX gives you an atomic "claim if unclaimed" in one round trip.',
            affects: ['db'],
          },
          {
            id: 'db-rows',
            label: 'DB hold rows',
            summary: 'Insert a hold row with expires_at; a job sweeps expired holds.',
            whatBreaks:
              'You now need a background sweeper to release expired holds, and every hold check is a DB read/write — more load on the very store you are trying to protect.',
            tradeoffs:
              'One fewer system to run; holds are durable and queryable. But you reintroduce DB contention and must build expiry yourself.',
            why:
              'Reasonable when volume is low and you want one source of truth. The partial unique index can even enforce hold uniqueness directly.',
            affects: ['db'],
          },
          {
            id: 'in-memory',
            label: 'In-process memory',
            summary: 'Keep holds in a map inside the booking service.',
            whatBreaks:
              'Holds vanish on restart and are invisible to other instances — so two servers will happily hold the same slot. Fatal the moment you run more than one process.',
            tradeoffs:
              'Zero infrastructure and fastest possible access. But it only works single-instance, which no real system is.',
            why:
              'Only viable for a prototype or a single-node demo. Listed so you can see exactly why it fails to scale.',
            affects: ['db'],
          },
        ],
      },
    },
    {
      id: 'db',
      label: 'Primary DB (PostgreSQL)',
      category: 'datastore',
      role: 'The source of truth for bookings — and the last line of defense against double-booking. Every confirmed sale lives here; reads are offloaded to a replica.',
      position: { x: 1380, y: 240 },
      decision: {
        question:
          'What actually guarantees a slot is never sold twice? (The single most important decision.)',
        options: [
          {
            id: 'unique-index',
            label: 'Partial unique index',
            isDefault: true,
            summary:
              'CREATE UNIQUE INDEX ON bookings (slot_id) WHERE status = \'booked\' — the DB physically rejects the 2nd booking.',
            whatBreaks:
              'Nothing — this is the guarantee. Given a bookings(slot_id, status) table, the index allows at most one booked row per slot: even if every layer above (waiting room, Redis claim, app logic) races or fails, the second confirm (whether an INSERT or an UPDATE that flips status to booked) loses on commit. Note it must be a partial index — a plain UNIQUE(slot_id, status) would let multiple cancelled rows through and reopen the hole.',
            tradeoffs:
              'Requires a DB that supports partial/filtered unique indexes (Postgres does natively). The losing writer gets a constraint violation you must translate into a clean "slot taken" response.',
            why:
              'This is the load-bearing wall. Redis claims and holds are *speed and UX*; the unique index is *correctness*. If you can explain this distinction, you have proven the competency. Every other lock strategy is an optimization on top of this.',
            affects: ['bookingSvc'],
          },
          {
            id: 'pessimistic',
            label: 'Pessimistic lock (SELECT FOR UPDATE)',
            summary: 'Lock the slot row, check availability, write, commit.',
            whatBreaks:
              'Throughput on a hot slot collapses to serial — every buyer queues behind one row lock. Hold the lock across a slow payment and you have a self-inflicted bottleneck (plus deadlock risk if a booking locks several seats in inconsistent order).',
            tradeoffs:
              'Conceptually simple and correct. But it serializes contention and ties up DB connections; the hotter the slot, the worse it scales.',
            why:
              'Works when contention is low or the critical section is tiny and fast. Pair it with short transactions — never hold the lock across external calls.',
            affects: ['bookingSvc', 'holdStore'],
          },
          {
            id: 'optimistic',
            label: 'Optimistic lock (version column)',
            summary: 'Read version, write WHERE version = N; retry on mismatch.',
            whatBreaks:
              'Under high contention almost every writer loses the compare-and-set and must retry — a retry storm that wastes work and adds latency for the exact hot slots you care about.',
            tradeoffs:
              'No locks held, great when conflicts are rare. Degrades badly when conflicts are common (which is exactly the booking case).',
            why:
              'Ideal for low-contention updates. For a single hot slot it is the wrong tool — but pairing it with the unique index as a backstop is a fine belt-and-suspenders approach.',
            affects: ['bookingSvc'],
          },
          {
            id: 'redis-lock',
            label: 'Redis distributed lock',
            summary: 'Acquire a Redlock before touching the slot.',
            whatBreaks:
              'You move correctness *out* of the durable store into a best-effort lock. A GC or scheduling pause between acquiring the lock and acting on it (or, secondarily, clock skew) can let the lease expire while you still think you hold it — two holders proceed, and now nothing in the DB stops the double-write.',
            tradeoffs:
              'Fast and language-agnostic. But distributed locks are notoriously subtle; treating them as a correctness guarantee (rather than an optimization) is a classic foot-gun.',
            why:
              'Useful as a *fast path* to reduce contention before the DB — but only safe if the unique index still backstops it. Never your sole line of defense.',
            affects: ['holdStore', 'bookingSvc'],
          },
        ],
      },
    },
    {
      id: 'replica',
      label: 'Read Replica',
      category: 'datastore',
      role: 'An async copy of the primary that serves browse/search reads, so heavy read traffic never competes with the booking writes on the primary. Slightly stale by design.',
      position: { x: 1380, y: 420 },
    },
    {
      id: 'queue',
      label: 'Confirmation Queue + Workers',
      category: 'queue',
      role: 'A durable queue plus the worker pool that consumes it. The queue only buffers; the workers do the work — confirming the booking, generating the ticket, and emailing — with retries and a dead-letter path. (The queue itself is passive; a consumer, not the queue, calls other services.)',
      position: { x: 1380, y: 600 },
    },
    {
      id: 'payment',
      label: 'Payment Provider',
      category: 'external',
      role: 'Third-party charge (Stripe-class). Called in-request behind an idempotency key so retries never double-charge. It is the slow finalization work (confirming the row, ticket PDF, email) that moves to the queue — not the charge itself.',
      position: { x: 1620, y: 380 },
    },
    {
      id: 'objectStore',
      label: 'Object Storage (S3)',
      category: 'datastore',
      role: 'Durable blob store for event images and generated ticket PDFs / QR codes. Fronted by the CDN so downloads are served from the edge.',
      position: { x: 1620, y: 560 },
    },
    {
      id: 'monitoring',
      label: 'Observability',
      category: 'compute',
      role: 'Metrics, logs, traces, and alerting across every service — how you see a spike forming or a node failing before users do. Critical for a flash-sale event you cannot rehearse.',
      position: { x: 1620, y: 120 },
    },
  ],
  edges: [
    { id: 'e1', source: 'client', target: 'dns', label: 'resolve', control: true },
    { id: 'e3', source: 'dns', target: 'lb', label: 'resolves to', control: true },
    { id: 'e2', source: 'client', target: 'cdn', label: 'static assets' },
    { id: 'e2b', source: 'client', target: 'lb', label: 'API requests' },
    { id: 'e17b', source: 'cdn', target: 'objectStore', label: 'origin fetch' },
    { id: 'e4', source: 'lb', target: 'gateway', label: 'route' },
    { id: 'e5', source: 'gateway', target: 'auth', label: 'verify token' },
    { id: 'e6', source: 'gateway', target: 'waitingRoom', label: 'hot event' },
    { id: 'e7', source: 'gateway', target: 'search', label: 'browse' },
    { id: 'e8', source: 'waitingRoom', target: 'bookingSvc', label: 'admit' },
    { id: 'e9', source: 'search', target: 'replica', label: 'read availability' },
    { id: 'e10', source: 'bookingSvc', target: 'holdStore', label: 'claim slot' },
    { id: 'e11', source: 'bookingSvc', target: 'db', label: 'write held row' },
    { id: 'e13', source: 'bookingSvc', target: 'payment', label: 'charge (in-request)' },
    { id: 'e12', source: 'bookingSvc', target: 'queue', label: 'enqueue confirm', async: true },
    { id: 'e14', source: 'queue', target: 'db', label: 'confirm (status→booked)', async: true },
    { id: 'e15', source: 'queue', target: 'notification', label: 'notify buyer', async: true },
    { id: 'e17', source: 'queue', target: 'objectStore', label: 'store ticket PDF', async: true },
    { id: 'e16', source: 'db', target: 'replica', label: 'replicate', async: true },
    { id: 'e18', source: 'bookingSvc', target: 'monitoring', label: 'metrics', async: true },
    { id: 'e19', source: 'gateway', target: 'monitoring', label: 'metrics', async: true },
  ],
}
