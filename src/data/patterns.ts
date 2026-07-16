import type { Pattern } from '../types'

// The payoff of the whole tool: the same handful of patterns recur across every
// domain. Learn the pattern once, recognize it everywhere. Each instance links
// back to the exact node where it appears.
export const patterns: Pattern[] = [
  {
    id: 'unbypassable-constraint',
    name: 'Correctness at the source of truth',
    essence: 'Enforce the real rule in one place that nothing can go around.',
    problem:
      'Checks in your app code, and locks spread across servers, can hit race conditions or simply fail. You need one rule that always holds, even when the code above it has a bug.',
    mechanism:
      'Put the rule where it cannot be skipped — a database constraint, a single atomic write with a built-in condition, or an append-only log. That makes the bad outcome impossible, not just unlikely. Everything above it is only there for speed and a nicer experience.',
    instances: [
      {
        domainId: 'ticketing',
        nodeId: 'db',
        where: 'Primary DB',
        how: 'A partial unique index rejects a second "booked" row for the same slot, so the seat can only be taken once.',
      },
      {
        domainId: 'ecommerce',
        nodeId: 'inventory',
        where: 'Inventory DB',
        how: 'One atomic decrement that only runs if stock stays >= 0, so you can never sell more than you have.',
      },
      {
        domainId: 'ecommerce',
        nodeId: 'payment',
        where: 'Payment Service',
        how: 'An idempotency key (a unique id for the charge) is the guard that can\'t be skipped, so the customer is never charged twice.',
      },
      {
        domainId: 'betting',
        nodeId: 'ledger',
        where: 'Settlement Ledger',
        how: 'Money is only ever added as new rows (double-entry, never edited or deleted), so every balance can be recomputed from the record and can\'t be quietly changed.',
      },
    ],
  },
  {
    id: 'idempotency',
    name: 'Idempotency — safe retries',
    essence: 'Make an action safe to repeat, so running it again doesn\'t apply it twice.',
    problem:
      'Networks time out, and clients and message queues retry automatically. Without protection, that retry can charge, book, or credit the same thing twice.',
    mechanism:
      'Give the action a unique key (or use a natural unique constraint that already exists). If the same key shows up again, recognize it and return the original result instead of doing the work a second time. This is what makes async queues safe.',
    instances: [
      {
        domainId: 'ecommerce',
        nodeId: 'payment',
        where: 'Payment Service',
        how: 'The client sends an idempotency key with the charge; if it retries, the same result comes back instead of a second charge.',
      },
      {
        domainId: 'ticketing',
        nodeId: 'bookingSvc',
        where: 'Booking Service',
        how: 'The worker that confirms bookings is idempotent, so if the queue delivers the same message twice the booking is still only confirmed once.',
      },
      {
        domainId: 'betting',
        nodeId: 'ledger',
        where: 'Settlement Ledger',
        how: 'Each ledger entry carries an idempotency key, so replaying the same settlement does nothing the second time.',
      },
    ],
  },
  {
    id: 'reservation-ttl',
    name: 'Reservation / hold with TTL',
    essence: 'Claim a limited item for a short time, and release it automatically if it isn\'t confirmed in time.',
    problem:
      'Two people want the same limited item, and one needs a few minutes to finish several steps (like paying) — but you can\'t lock everyone else out forever while they do.',
    mechanism:
      'Write a short-lived claim with a TTL (a time-to-live, an expiry timer) so it clears itself. If they confirm, make the claim permanent. If time runs out, the item frees up on its own with no cleanup job needed.',
    instances: [
      {
        domainId: 'ticketing',
        nodeId: 'holdStore',
        where: 'Hold Store (Redis)',
        how: 'SET hold:slot NX EX 480 — one atomic command that claims the slot for 8 minutes while the buyer pays, then expires on its own.',
      },
      {
        domainId: 'ecommerce',
        nodeId: 'inventory',
        where: 'Inventory DB',
        how: 'Reserve first, then confirm: move stock into a reserved bucket with a TTL; if the reservation isn\'t confirmed in time, the stock goes back.',
      },
    ],
  },
  {
    id: 'cache-hot-path',
    name: 'Cache the hot path',
    essence: 'Serve the data people ask for most from fast memory, and keep the slow database out of the way.',
    problem:
      'Your busiest requests — huge numbers of reads, or live data — would overload the main database and make responses too slow.',
    mechanism:
      'Put a fast in-memory layer (usually Redis) in front. Pre-build or store the most-read data there. If it isn\'t in the cache (a miss), read from the source of truth and put a copy in the cache for next time.',
    instances: [
      {
        domainId: 'social',
        nodeId: 'cache',
        where: 'Feed Cache (Redis)',
        how: 'Feeds are built ahead of time and kept in sorted sets, so opening the app is one fast read.',
      },
      {
        domainId: 'betting',
        nodeId: 'cache',
        where: 'Odds Cache (Redis)',
        how: 'Live odds are kept in memory and pushed out (pub/sub) to thousands of connected WebSocket clients at once.',
      },
      {
        domainId: 'ecommerce',
        nodeId: 'cart',
        where: 'Cart Store (Redis)',
        how: 'The cart changes constantly, so it lives in memory with a TTL and is shared across the user\'s devices.',
      },
    ],
  },
  {
    id: 'async-decoupling',
    name: 'Async decoupling via queue / log',
    essence: 'Move slow or bursty work out of the request so it can run and retry on its own.',
    problem:
      'Some work (payment, emails, fan-out, settlement) is slow, comes in bursts, or fails often. Doing it inside the request ties your speed and uptime to it.',
    mechanism:
      'Hand the work to a durable queue or append-only log, and let background workers do it later, with retries and a dead-letter path for messages that keep failing. Use it with idempotent workers (see above), because the queue may deliver the same message more than once.',
    instances: [
      {
        domainId: 'ticketing',
        nodeId: 'queue',
        where: 'Confirmation Queue',
        how: 'The hold already guarantees the slot, so the confirmation runs in the background and the request stays fast.',
      },
      {
        domainId: 'social',
        nodeId: 'queue',
        where: 'Fan-out Workers',
        how: 'Background workers copy a new post into each follower\'s feed, so that work doesn\'t slow down the post request.',
      },
      {
        domainId: 'ecommerce',
        nodeId: 'queue',
        where: 'Order Workers',
        how: 'After checkout, the steps (payment, fulfillment, email) run in the background as a saga, each able to retry or undo (compensate) if something fails.',
      },
      {
        domainId: 'betting',
        nodeId: 'eventLog',
        where: 'Event Log (Kafka)',
        how: 'Every bet is added to the end of an ordered log, and settlement reads from that log later, downstream.',
      },
    ],
  },
]
