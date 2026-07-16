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
  tagline: 'Stop the same seat from being sold twice when a huge crowd of buyers all click at once.',
  referenceNote:
    'Based on systems like Ticketmaster, where many people fight over the same seats at the same time. The hard part is being correct when many buyers act at once (concurrency), not handling lots of traffic (throughput).',
  requirements: {
    functional: [
      'Browse events and see which seats are still open',
      'Put a temporary hold on a seat while you pay for it',
      'Confirm the booking, or free the seat again if the hold runs out of time',
      'Each seat is sold to exactly one buyer',
    ],
    nonFunctional: [
      'Bookings must always be correct: if being correct and staying available ever conflict, pick correct (strong consistency over availability)',
      'Place a hold in under 100ms even when busy',
      'Survive flash-sale spikes (~1000× normal traffic)',
      'Be fair about who gets in when many buyers want the same seat',
    ],
  },
  scale: [
    { metric: 'Buyers at once on one hot event', value: '~200k' },
    { metric: 'How long a hold lasts', value: '8 min TTL', note: 'holds auto-expire, freeing abandoned carts (TTL = time-to-live, an auto-expiry timer)' },
    { metric: 'What the traffic looks like', value: 'mostly browsing (reads), but the writes are the hard part' },
    { metric: 'Double-bookings allowed', value: '0', note: 'non-negotiable' },
  ],
  principle: {
    title: 'Correctness belongs at the source of truth',
    body:
      'Every layer above the database — waiting room, Redis claim, in-app checks — is there for speed and a smooth experience. Only one layer is load-bearing for correctness: a rule the database itself physically enforces (the partial unique index). Having many layers of protection is good, but you must always be able to point to the one layer that makes the bad outcome impossible, not just unlikely.',
  },
  nodes: [
    {
      id: 'client',
      label: 'Client',
      category: 'client',
      role: 'Web and mobile apps. Shows the event page and sends booking requests — including thousands of buyers all mashing "book" on the same hot seat at the same moment.',
      position: { x: 0, y: 320 },
    },
    {
      id: 'dns',
      label: 'DNS',
      category: 'edge',
      role: 'Turns your domain name into an IP address. It often sends each user to the nearest region (geo-routing) and points static-file addresses at the CDN. It is just a lookup, not a stop the traffic passes through: after the lookup, the client connects directly.',
      position: { x: 220, y: 160 },
    },
    {
      id: 'cdn',
      label: 'CDN',
      category: 'edge',
      role: 'Keeps copies of static files (event images, JS/CSS, ticket PDFs) at locations near the user, so most of the data never has to reach your own servers. (Caching means keeping a nearby copy so you do not fetch it from the source every time.)',
      position: { x: 220, y: 480 },
    },
    {
      id: 'lb',
      label: 'Load Balancer',
      category: 'edge',
      role: 'The entry point to your servers. Spreads incoming requests across your gateway/app machines, checks that each one is healthy, and stops sending traffic to any that have died.',
      position: { x: 440, y: 320 },
    },
    {
      id: 'gateway',
      label: 'API Gateway',
      category: 'edge',
      role: 'One front door to the backend. It handles HTTPS encryption (terminates TLS), checks who each request is from (via the auth service), limits how fast anyone can send requests (rate limits), and forwards each request to the right service.',
      position: { x: 660, y: 180 },
    },
    {
      id: 'auth',
      label: 'Auth Service',
      category: 'compute',
      role: 'Hands out and checks login tokens (JWT/session) so every request is tied to a known user. A token is a signed proof of who you are. You need this to know whose hold/booking it is and to enforce per-user limits.',
      position: { x: 660, y: 460 },
    },
    {
      id: 'waitingRoom',
      label: 'Virtual Waiting Room',
      category: 'edge',
      role: 'A gatekeeper in front of the booking service for hot events. It decides who gets in and when, so the backend gets a steady trickle of requests instead of a sudden flood.',
      position: { x: 900, y: 100 },
      decision: {
        question: 'How do we handle a sudden flood of people hitting one event?',
        options: [
          {
            id: 'waiting-room',
            label: 'Virtual Waiting Room',
            isDefault: true,
            summary: 'Line users up at the edge and let them in a few at a time.',
            whatBreaks:
              'Nothing behind it breaks — that is the whole point. The booking service gets a capped, steady request rate instead of a flood.',
            tradeoffs:
              'Adds more moving parts (a line to wait in plus tokens that grant entry) and something users see ("you are #4,213 in line"). People wait, but the system stays responsive and fair.',
            why:
              'For real flash sales (a Taylor Swift on-sale), it is the only thing that keeps the database from melting. It turns an unlimited flood into a flat, survivable load.',
            affects: ['bookingSvc', 'db'],
          },
          {
            id: 'rate-limit',
            label: 'Rate Limiter only',
            summary: 'Cap how many requests each IP/user can send; reject the extras with a 429 "too many requests" error.',
            whatBreaks:
              'Real buyers get rejected during the flood and have to keep retrying with no idea when they will get in. No fairness — whoever retries fastest wins, not whoever came first.',
            tradeoffs:
              'Much cheaper and simpler than a waiting room. It protects the backend but hands users a bad, chaotic experience.',
            why:
              'Fine for moderately busy seats where spikes are 5-10x, not 1000x. A good default until you get flash-sale-level traffic.',
            affects: ['bookingSvc'],
          },
          {
            id: 'none',
            label: 'Nothing',
            summary: 'Let every request go straight to the booking service.',
            whatBreaks:
              'In a real flood the booking service and database get overwhelmed: response times explode, connections run out, and real bookings time out. The system fails at the exact moment it matters most.',
            tradeoffs:
              'No extra parts to build. Totally fine until many buyers fight over the same seat — then it is a disaster.',
            why:
              'Only OK for low-traffic booking (a small gym, a clinic) where many people rarely go for the same slot at once.',
            affects: ['bookingSvc', 'db'],
          },
        ],
      },
    },
    {
      id: 'search',
      label: 'Catalog / Search Service',
      category: 'compute',
      role: 'Handles browsing events and seeing which seats are open — the read-heavy path. Kept separate from the booking path (where the important writes happen) so heavy browsing never slows down a sale.',
      position: { x: 900, y: 460 },
    },
    {
      id: 'bookingSvc',
      label: 'Booking Service',
      category: 'compute',
      role: 'The core write path: it checks the request, places a hold, takes payment, then either confirms the booking right away in the same request (sync) or hands the confirmation off to a background worker (async). This is where the decisions about handling many buyers at once live.',
      position: { x: 1140, y: 240 },
      decision: {
        question: 'How do we confirm a booking after the payment goes through?',
        options: [
          {
            id: 'async',
            label: 'Async confirm (queue)',
            isDefault: true,
            summary: 'Hold the seat, take payment, then put the confirmation on a to-do list (a queue) that a background worker finishes later.',
            whatBreaks:
              'Nothing breaks, but you have to show the user a "pending" state and make the worker idempotent — meaning if the same message gets delivered twice, running it again does no extra harm and will not confirm the booking twice.',
            tradeoffs:
              'Separates the slow finishing work (writing the confirmed row, making the ticket, sending emails) from the request the user is waiting on. In return you add a queue plus a worker, and you have to reason about eventual consistency — the confirmation is true soon, just not instantly.',
            why:
              'The hold (with its TTL expiry timer) already guarantees the seat is yours; the slow finishing work (writing the confirmed row, generating the ticket PDF, emails) only needs to happen *eventually*. Doing it on a background worker keeps the booking request fast.',
            affects: ['queue', 'db', 'payment'],
          },
          {
            id: 'sync',
            label: 'Synchronous confirm',
            summary: 'Take payment and write the confirmed booking all in one request.',
            whatBreaks:
              'A slow payment provider keeps a database connection and transaction open the entire time. When busy, you run out of available connections and the lock is held longer, so you can handle fewer buyers at once.',
            tradeoffs:
              'Dead simple — no queue, no worker, no eventual-consistency headaches. But your speed is now tied to the slowest outside call.',
            why:
              'Great for low volume, where simplicity wins and slow payments are not your bottleneck.',
            affects: ['db', 'payment'],
          },
        ],
      },
    },
    {
      id: 'notification',
      label: 'Notification Service',
      category: 'compute',
      role: 'Sends booking confirmations and reminders by email/SMS/push. It works off the queue so a slow email provider never holds up or breaks a booking.',
      position: { x: 1140, y: 480 },
    },
    {
      id: 'holdStore',
      label: 'Hold Store (Redis)',
      category: 'cache',
      role: 'Keeps a temporary claim on a seat with an auto-expiry timer (TTL) while the user pays — the fast "you have 8 minutes" layer that feels smooth without locking up the database.',
      position: { x: 1380, y: 60 },
      decision: {
        question: 'Where do we keep the temporary hold (the "you have 8 minutes" claim)?',
        options: [
          {
            id: 'redis-ttl',
            label: 'Redis with TTL',
            isDefault: true,
            summary: 'SET hold:slot NX EX 480 — a single all-or-nothing claim that expires on its own after 480 seconds.',
            whatBreaks:
              'A subtle one: if a slow buyer\'s hold timer (TTL) runs out mid-checkout, another buyer can claim the seat — and it is the database unique index, not Redis, that settles who actually gets it (the first buyer just sees "your hold expired"). Also, Redis is now on the critical path: if it goes down you stop taking bookings (fail closed) — a safe default, though with the unique index in place you could instead fall back to holds stored in the database alone and still never double-book.',
            tradeoffs:
              'Claims happen in under a millisecond and expire on their own (no cleanup job needed to remove stale holds). The cost: another store (an in-memory one) to run, and its data is temporary by design.',
            why:
              'The auto-expiry timer (TTL) is the killer feature — abandoned carts free their seat automatically. SET NX means "claim it only if nobody else has" in a single round trip that can not be split in half.',
            affects: ['db'],
          },
          {
            id: 'db-rows',
            label: 'DB hold rows',
            summary: 'Add a hold row with an expires_at time; a scheduled job clears out expired holds.',
            whatBreaks:
              'You now need a background job to release expired holds, and every hold check is a database read/write — more load on the very store you were trying to protect.',
            tradeoffs:
              'One fewer system to run, and holds are durable (they survive restarts) and easy to query. But you bring back database contention (many buyers fighting over the same rows) and have to build expiry yourself.',
            why:
              'Reasonable when volume is low and you want one single source of truth. The partial unique index can even enforce hold uniqueness directly.',
            affects: ['db'],
          },
          {
            id: 'in-memory',
            label: 'In-process memory',
            summary: 'Keep holds in a lookup table inside the booking service\'s own memory.',
            whatBreaks:
              'Holds disappear on restart and are invisible to other copies of the service — so two servers will happily hold the same seat. Fatal the moment you run more than one copy.',
            tradeoffs:
              'No extra systems and the fastest possible access. But it only works with a single copy running, which no real system has.',
            why:
              'Only workable for a prototype or a single-machine demo. Listed so you can see exactly why it fails to scale.',
            affects: ['db'],
          },
        ],
      },
    },
    {
      id: 'db',
      label: 'Primary DB (PostgreSQL)',
      category: 'datastore',
      role: 'The single source of truth for bookings — and the last line of defense against double-booking. Every confirmed sale lives here; browsing reads are handled by a copy (a replica) instead.',
      position: { x: 1380, y: 240 },
      decision: {
        question:
          'What actually guarantees a seat is never sold twice? (The single most important decision.)',
        options: [
          {
            id: 'unique-index',
            label: 'Partial unique index',
            isDefault: true,
            summary:
              'CREATE UNIQUE INDEX ON bookings (slot_id) WHERE status = \'booked\' — the database itself physically refuses the 2nd booking. (A unique index is a rule that forbids duplicate values; "partial" means the rule only applies to rows that match the WHERE condition.)',
            whatBreaks:
              'Nothing — this is the guarantee. Given a bookings(slot_id, status) table, the index allows at most one booked row per seat: even if every layer above it (waiting room, Redis claim, app logic) races or fails, the second confirm — whether it is an INSERT or an UPDATE that flips status to booked — loses when it tries to commit. Note it must be a partial index: a plain UNIQUE(slot_id, status) would let multiple cancelled rows through and reopen the hole.',
            tradeoffs:
              'Needs a database that supports partial (filtered) unique indexes — Postgres does out of the box. The writer that loses gets a rule-violation error, which you have to turn into a clean "seat taken" message.',
            why:
              'This is the load-bearing wall. Redis claims and holds are about *speed and smoothness*; the unique index is about *correctness*. If you can explain that difference, you have proven the skill. Every other locking approach is just an optimization sitting on top of this.',
            affects: ['bookingSvc'],
          },
          {
            id: 'pessimistic',
            label: 'Pessimistic lock (SELECT FOR UPDATE)',
            summary: 'Lock the seat\'s row so no one else can touch it, check it is free, write, and commit.',
            whatBreaks:
              'On a hot seat, buyers can no longer be served at the same time — every buyer has to wait in line behind that one row lock. Hold the lock while a slow payment runs and you have created your own bottleneck (plus a risk of deadlock if a booking locks several seats in a different order each time).',
            tradeoffs:
              'Easy to understand and correct. But it forces buyers to take turns and ties up database connections; the hotter the seat, the worse it scales.',
            why:
              'Works when few people fight over the same seat, or when the locked step is tiny and fast. Keep the locked section short — never hold the lock while waiting on an outside call.',
            affects: ['bookingSvc', 'holdStore'],
          },
          {
            id: 'optimistic',
            label: 'Optimistic lock (version column)',
            summary: 'Read the row\'s version number, then write only WHERE version = N; if it changed, someone beat you, so retry.',
            whatBreaks:
              'When many buyers hit the same seat, almost all of them lose the check-and-write and have to retry — a retry storm that wastes effort and adds delay for exactly the hot seats you care about.',
            tradeoffs:
              'Holds no locks, so it is great when clashes are rare. It gets much worse when clashes are common — which is exactly the booking case.',
            why:
              'Ideal for updates that rarely clash. For one hot seat it is the wrong tool — but using it alongside the unique index as a safety net is a fine belt-and-suspenders approach.',
            affects: ['bookingSvc'],
          },
          {
            id: 'redis-lock',
            label: 'Redis distributed lock',
            summary: 'Grab a Redis lock (Redlock) before touching the seat.',
            whatBreaks:
              'You move correctness *out* of the durable database and into a best-effort lock. A pause (from garbage collection or the OS pausing your process, or more rarely clock skew) between grabbing the lock and using it can let the lock\'s lease expire while you still think you hold it — two holders proceed, and now nothing in the database stops the double-write.',
            tradeoffs:
              'Fast and works from any language. But distributed locks are famously tricky; treating them as a correctness guarantee (instead of just an optimization) is a classic foot-gun.',
            why:
              'Useful as a *fast path* to cut down contention before the database — but only safe if the unique index still backs it up. Never your only line of defense.',
            affects: ['holdStore', 'bookingSvc'],
          },
        ],
      },
    },
    {
      id: 'replica',
      label: 'Read Replica',
      category: 'datastore',
      role: 'A copy of the main database that lags slightly behind and serves browse/search reads, so heavy read traffic never competes with the booking writes on the main database. A little out of date by design.',
      position: { x: 1380, y: 420 },
    },
    {
      id: 'queue',
      label: 'Confirmation Queue + Workers',
      category: 'queue',
      role: 'A durable to-do list (a queue that does not lose messages) plus the pool of workers that read from it. The queue just holds the items; the workers do the actual work — confirming the booking, making the ticket, and emailing — retrying on failure and setting aside messages that keep failing (a dead-letter path). (The queue itself is passive; a worker, not the queue, calls the other services.)',
      position: { x: 1380, y: 600 },
    },
    {
      id: 'payment',
      label: 'Payment Provider',
      category: 'external',
      role: 'A third-party that charges the card (Stripe-class). Called during the request with an idempotency key — a unique tag that makes sure a retried charge is treated as the same charge, so buyers are never charged twice. It is the slow finishing work (confirming the row, ticket PDF, email) that moves to the queue — not the charge itself.',
      position: { x: 1620, y: 380 },
    },
    {
      id: 'objectStore',
      label: 'Object Storage (S3)',
      category: 'datastore',
      role: 'Durable storage for large files: event images and generated ticket PDFs / QR codes. Sits behind the CDN so downloads are served from a location near the user.',
      position: { x: 1620, y: 560 },
    },
    {
      id: 'monitoring',
      label: 'Observability',
      category: 'compute',
      role: 'Metrics, logs, traces, and alerts across every service — how you spot a spike building or a machine failing before users do. Critical for a flash-sale event you cannot rehearse.',
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
