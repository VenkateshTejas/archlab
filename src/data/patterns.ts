import type { Pattern } from '../types'

// The payoff of the whole tool: the same handful of patterns recur across every
// domain. Learn the pattern once, recognize it everywhere. Each instance links
// back to the exact node where it appears.
export const patterns: Pattern[] = [
  {
    id: 'unbypassable-constraint',
    name: 'Correctness at the source of truth',
    essence: 'Push the real guarantee to a layer that physically cannot be bypassed.',
    problem:
      'App-level checks and distributed locks have races and can fail. You need an invariant that holds even when every layer above it has a bug.',
    mechanism:
      'Encode the invariant where it cannot be skipped — a database constraint, an atomic conditional write, or an append-only log — so the dangerous outcome is impossible, not merely unlikely. Everything above is speed and UX.',
    instances: [
      {
        domainId: 'ticketing',
        nodeId: 'db',
        where: 'Primary DB',
        how: 'Partial unique index physically rejects a second "booked" row for the same slot.',
      },
      {
        domainId: 'ecommerce',
        nodeId: 'inventory',
        where: 'Inventory DB',
        how: 'Atomic conditional decrement (CHECK stock >= 0) makes overselling impossible.',
      },
      {
        domainId: 'ecommerce',
        nodeId: 'payment',
        where: 'Payment Service',
        how: 'The idempotency key is the un-bypassable guard against a double charge.',
      },
      {
        domainId: 'betting',
        nodeId: 'ledger',
        where: 'Settlement Ledger',
        how: 'Append-only double-entry means balances are always derivable and can\'t be silently corrupted.',
      },
    ],
  },
  {
    id: 'idempotency',
    name: 'Idempotency — safe retries',
    essence: 'Make an operation safe to repeat, so a retry can\'t apply it twice.',
    problem:
      'Networks time out; clients and message queues retry. Without protection a retry double-charges, double-books, or double-credits.',
    mechanism:
      'Attach a unique key (or rely on a natural unique constraint) to the operation. On a repeat, recognize the key and return the original result instead of re-executing. This is what makes async queues safe.',
    instances: [
      {
        domainId: 'ecommerce',
        nodeId: 'payment',
        where: 'Payment Service',
        how: 'Client sends an idempotency key; a retried charge returns the original result.',
      },
      {
        domainId: 'ticketing',
        nodeId: 'bookingSvc',
        where: 'Booking Service',
        how: 'The async confirmation consumer is idempotent so a redelivered message can\'t double-confirm.',
      },
      {
        domainId: 'betting',
        nodeId: 'ledger',
        where: 'Settlement Ledger',
        how: 'Idempotency keys on ledger entries make a replayed settlement a no-op.',
      },
    ],
  },
  {
    id: 'reservation-ttl',
    name: 'Reservation / hold with TTL',
    essence: 'Claim a scarce resource temporarily; auto-release it if not confirmed in time.',
    problem:
      'Two users want the same scarce resource, and one needs time to finish a multi-step action (pay) without locking everyone else out indefinitely.',
    mechanism:
      'Write a short-lived claim, ideally with a TTL so it self-expires. Confirm → make it permanent; timeout → the resource frees itself with no cleanup job required.',
    instances: [
      {
        domainId: 'ticketing',
        nodeId: 'holdStore',
        where: 'Hold Store (Redis)',
        how: 'SET hold:slot NX EX 480 — an atomic 8-minute claim while the buyer pays.',
      },
      {
        domainId: 'ecommerce',
        nodeId: 'inventory',
        where: 'Inventory DB',
        how: 'Reserve-then-confirm: decrement stock into a reserved bucket with a TTL; unconfirmed reservations return stock.',
      },
    ],
  },
  {
    id: 'cache-hot-path',
    name: 'Cache the hot path',
    essence: 'Serve the most frequent, latency-sensitive data from memory; keep the slow store off the critical path.',
    problem:
      'Your hottest path — high-volume reads or live data — would overwhelm the primary datastore and blow your latency budget.',
    mechanism:
      'Put a fast in-memory layer (usually Redis) in front. Precompute or cache what\'s read most; fall back to the source of truth on a miss and repopulate.',
    instances: [
      {
        domainId: 'social',
        nodeId: 'cache',
        where: 'Feed Cache (Redis)',
        how: 'Precomputed feeds in sorted sets — opening the app is a single fast read.',
      },
      {
        domainId: 'betting',
        nodeId: 'cache',
        where: 'Odds Cache (Redis)',
        how: 'Live odds in memory + pub/sub fan-out to thousands of WebSocket clients.',
      },
      {
        domainId: 'ecommerce',
        nodeId: 'cart',
        where: 'Cart Store (Redis)',
        how: 'High-churn cart state in memory with a TTL, shared across the user\'s devices.',
      },
    ],
  },
  {
    id: 'async-decoupling',
    name: 'Async decoupling via queue / log',
    essence: 'Move slow or spiky work out of the request path so it can retry independently.',
    problem:
      'Some work (payment, emails, fan-out, settlement) is slow, bursty, or failure-prone. Doing it synchronously couples your latency and availability to it.',
    mechanism:
      'Hand the work to a durable queue or append-only log; workers process it asynchronously with retries and a dead-letter path. Pairs with idempotent consumers (see above), because the queue may redeliver.',
    instances: [
      {
        domainId: 'ticketing',
        nodeId: 'queue',
        where: 'Confirmation Queue',
        how: 'The hold guarantees the slot; confirmation runs async so the request stays fast.',
      },
      {
        domainId: 'social',
        nodeId: 'queue',
        where: 'Fan-out Workers',
        how: 'New posts are pushed into followers\' feeds by async workers, not in the post request.',
      },
      {
        domainId: 'ecommerce',
        nodeId: 'queue',
        where: 'Order Workers',
        how: 'The post-checkout saga (payment, fulfillment, email) runs as async steps that retry / compensate.',
      },
      {
        domainId: 'betting',
        nodeId: 'eventLog',
        where: 'Event Log (Kafka)',
        how: 'Every bet is appended to an ordered log; settlement consumes it downstream.',
      },
    ],
  },
]
