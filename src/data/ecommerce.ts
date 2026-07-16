import type { Domain } from '../types'

// Reference design: Amazon-class cart + checkout. The defining tensions are
// inventory consistency at checkout and payment idempotency on retries.
//
// Complete architecture: most nodes are context (DNS, CDN, LB, gateway, auth,
// orders DB, fulfillment, object store, observability); a few carry the swaps.
export const ecommerce: Domain = {
  id: 'ecommerce',
  name: 'E-commerce Checkout',
  tagline: 'Never oversell inventory; never double-charge a card on retry.',
  referenceNote:
    'Modeled on Amazon-class storefronts. Browsing is read-heavy and cacheable; checkout is the correctness-critical hot path.',
  requirements: {
    functional: [
      'Browse and search the catalog',
      'Add items to a cart that follows the user across devices',
      'Checkout: reserve stock, take payment, create the order',
      'Never oversell inventory; never double-charge a card',
    ],
    nonFunctional: [
      'Browse is cacheable and highly available; checkout is correctness-critical',
      'Payments are idempotent — safe to retry after a timeout',
      'Eventual consistency OK for catalog; strong for inventory and money',
      'Absorb flash-sale spikes on a few hot SKUs',
    ],
  },
  scale: [
    { metric: 'Browse : checkout ratio', value: '~20 : 1', note: 'browsing dominates' },
    { metric: 'Catalog size', value: '10M+ SKUs' },
    { metric: 'Payment retry guarantee', value: 'exactly-once effect' },
    { metric: 'Tolerated oversells', value: '0' },
  ],
  principle: {
    title: 'Design for the retry, not the happy path',
    body:
      'Networks time out and clients retry, so the real question is never "did it work?" but "is it safe to do twice?". An idempotency key turns a duplicate charge into a no-op, exactly as the booking unique index turns a duplicate booking into a rejection. Notice the recurring shape across domains: correctness comes from making the dangerous operation physically un-repeatable at a layer that cannot be bypassed.',
  },
  nodes: [
    {
      id: 'client',
      label: 'Client',
      category: 'client',
      role: 'Web & mobile storefront. The shopper browses the catalog, fills a cart, and checks out.',
      position: { x: 0, y: 340 },
    },
    {
      id: 'dns',
      label: 'DNS',
      category: 'edge',
      role: 'Resolves the storefront domain to a regional endpoint (it can geo-steer via latency-based records). It is a lookup, not a traffic hop — the client then connects directly to the load balancer or CDN.',
      position: { x: 220, y: 180 },
    },
    {
      id: 'cdn',
      label: 'CDN',
      category: 'edge',
      role: 'Caches product images and static assets at the edge — most of browsing is cacheable, so this offloads the bulk of read traffic.',
      position: { x: 220, y: 500 },
    },
    {
      id: 'lb',
      label: 'Load Balancer',
      category: 'edge',
      role: 'Distributes API traffic across gateway/app instances and health-checks them.',
      position: { x: 440, y: 340 },
    },
    {
      id: 'gateway',
      label: 'API Gateway',
      category: 'edge',
      role: 'Front door: TLS, authentication enforcement (delegating token validation to the auth service), rate limiting, and routing to catalog, cart, and order services.',
      position: { x: 660, y: 200 },
    },
    {
      id: 'auth',
      label: 'Auth Service',
      category: 'compute',
      role: 'Validates tokens / sessions so carts and orders are tied to a user and checkout is authenticated.',
      position: { x: 660, y: 480 },
    },
    {
      id: 'catalog',
      label: 'Catalog Search',
      category: 'datastore',
      role: 'Powers product browse, search, and filtering. A read-optimized index kept in sync from the product catalog via an indexing pipeline.',
      position: { x: 900, y: 80 },
      decision: {
        question: 'What powers product search and browse?',
        options: [
          {
            id: 'elasticsearch',
            label: 'Search engine (Elasticsearch)',
            isDefault: true,
            summary: 'Inverted index for full-text search, facets, and ranking.',
            whatBreaks:
              'Nothing for browse — but it is a secondary index, not your source of truth. You must sync it from the primary DB, so it is eventually consistent (a just-changed price may lag).',
            tradeoffs:
              'Fast full-text search, typo tolerance, and faceted filtering that SQL LIKE cannot match. Costs an extra system to run and a sync pipeline to keep current.',
            why:
              'Catalog search is exactly what inverted indexes are built for. Pricing/inventory stays authoritative in the primary DB; search is a fast read-optimized projection.',
            affects: ['orderSvc'],
          },
          {
            id: 'sql-like',
            label: 'SQL LIKE queries',
            summary: 'Query the relational DB directly with LIKE/ILIKE.',
            whatBreaks:
              'A leading-wildcard LIKE \'%term%\' cannot use a B-tree index, so search does full table scans — slow and DB-crushing as the catalog grows. (A prefix like \'term%\' can use an index; the general full-text case cannot.) No relevance ranking, no typo tolerance, no facets.',
            tradeoffs:
              'Zero extra infrastructure and always consistent. But it does not scale and gives a poor search experience.',
            why:
              'Fine for a small catalog (a few thousand SKUs) where search is rare. The moment search matters, you outgrow it.',
            affects: ['orderSvc'],
          },
        ],
      },
    },
    {
      id: 'cart',
      label: 'Cart Store (Redis)',
      category: 'cache',
      role: 'Holds the in-progress shopping cart per session/user — high-churn, short-lived state read at checkout.',
      position: { x: 900, y: 320 },
      decision: {
        question: 'Where does the shopping cart live?',
        options: [
          {
            id: 'redis-cart',
            label: 'Redis (server-side)',
            isDefault: true,
            summary: 'Cart keyed by user/session in Redis with a TTL.',
            whatBreaks:
              'Nothing — cart survives across devices and page reloads, and abandoned carts expire via TTL. If Redis is purely a cache (no persistence), a flush loses in-progress carts.',
            tradeoffs:
              'Fast, shared across the user\'s devices, and self-expiring. Adds a store to run; choose persistence if losing carts is unacceptable.',
            why:
              'Carts are short-lived, high-churn, per-user state — ideal for an in-memory store with TTL. Server-side means the cart follows the user across devices.',
            affects: ['orderSvc'],
          },
          {
            id: 'db-cart',
            label: 'Database rows',
            summary: 'Persist cart line items in the relational DB.',
            whatBreaks:
              'Every add-to-cart click is a DB write; carts are high-churn, so you generate a lot of write load and dead rows for abandoned carts you must clean up.',
            tradeoffs:
              'Durable and queryable (good for analytics on abandoned carts). But it puts churny, low-value writes on your most precious store.',
            why:
              'Reasonable if you want durable carts and analytics and your volume is modest. Many shops use a hybrid: Redis live, periodic DB snapshot.',
            affects: ['orderSvc'],
          },
          {
            id: 'client-cart',
            label: 'Client-side (localStorage)',
            summary: 'Keep the cart entirely in the browser.',
            whatBreaks:
              'Cart does not follow the user to another device and is lost if they clear storage. You cannot do server-side abandoned-cart emails or cross-device continuity.',
            tradeoffs:
              'Zero server state and infinite scale (it is the client\'s problem). But it sacrifices continuity and server-side insight.',
            why:
              'Fine for guest checkout or minimizing infrastructure. Often combined with server-side carts that activate on login.',
            affects: ['orderSvc'],
          },
        ],
      },
    },
    {
      id: 'orderSvc',
      label: 'Order Service',
      category: 'compute',
      role: 'The checkout brain: reads the cart, reserves inventory, writes the order, then hands off payment + fulfillment to the queue/workers. Where the consistency decisions live.',
      position: { x: 900, y: 540 },
      decision: {
        question: 'How do we process the order after checkout?',
        options: [
          {
            id: 'async-order',
            label: 'Async (saga via queue)',
            isDefault: true,
            summary: 'Reserve stock, enqueue payment + fulfillment as a saga.',
            whatBreaks:
              'Nothing breaks, but you adopt eventual consistency: the order is "placed" then "confirmed". Each step must be idempotent and have a compensating action if a later step fails.',
            tradeoffs:
              'Resilient to slow/failing downstreams and scales well. Costs you saga/compensation logic and a "pending order" UX.',
            why:
              'Checkout touches many services (inventory, payment, shipping, email). A saga lets each step retry/compensate independently instead of one giant fragile transaction.',
            affects: ['queue', 'inventory', 'payment'],
          },
          {
            id: 'sync-order',
            label: 'Synchronous transaction',
            summary: 'Reserve stock, charge, and write the order in one request.',
            whatBreaks:
              'A slow payment call holds inventory locks and a DB transaction open; under load this serializes checkout and risks selling timeouts. A failure mid-way needs careful rollback.',
            tradeoffs:
              'Simple and strongly consistent — no saga to reason about. But it couples checkout latency to the payment provider and limits concurrency.',
            why:
              'Perfectly fine at low volume where simplicity beats resilience and payment latency is acceptable.',
            affects: ['inventory', 'payment'],
          },
        ],
      },
    },
    {
      id: 'inventory',
      label: 'Inventory DB',
      category: 'datastore',
      role: 'Authoritative stock counts — must never go negative. The contended hot spot during a flash sale.',
      position: { x: 1160, y: 100 },
      decision: {
        question: 'How do we stop two shoppers buying the last item?',
        options: [
          {
            id: 'reserve',
            label: 'Reserve-then-confirm',
            isDefault: true,
            summary: 'Atomically decrement stock into a "reserved" bucket with a TTL.',
            whatBreaks:
              'The atomic conditional decrement (UPDATE ... SET stock = stock - n WHERE stock >= n) makes the decrement itself safe — the DB physically refuses to go below zero, so no single transaction oversells. End-to-end you still must reconcile reservation expiry against late-arriving payments, and aggregate stock across warehouses/shards is not covered by one row\'s CHECK. Unconfirmed reservations expire and return stock.',
            tradeoffs:
              'Clean and scalable; mirrors the booking "hold" pattern. You must run reservation expiry and handle the "reserved but not yet paid" state.',
            why:
              'Same insight as ticket booking: a conditional atomic write at the source of truth is what actually prevents overselling. Reservations give the shopper time to pay without locking rows.',
            affects: ['orderSvc'],
          },
          {
            id: 'pessimistic-inv',
            label: 'Pessimistic row lock',
            summary: 'SELECT FOR UPDATE the stock row during checkout.',
            whatBreaks:
              'For a hot item (a flash deal), every shopper serializes behind one row lock; throughput tanks and the lock held across payment risks timeouts and deadlocks.',
            tradeoffs:
              'Simple and correct for cold inventory. But it serializes contention on exactly the popular items where you most need concurrency.',
            why:
              'Acceptable when items rarely have simultaneous buyers. Keep the locked section tiny — never across the payment call.',
            affects: ['orderSvc'],
          },
          {
            id: 'optimistic-inv',
            label: 'Optimistic (version/CAS)',
            summary: 'Update stock WHERE version unchanged; retry on conflict.',
            whatBreaks:
              'On a hot item, many checkouts collide and retry — a retry storm that adds latency right when demand spikes.',
            tradeoffs:
              'No locks; excellent when conflicts are rare (most inventory most of the time). Degrades under heavy contention on a single SKU.',
            why:
              'A great default for normal stock. Note the actual safety primitive is the conditional decrement (WHERE stock >= n) — a version column matters when you must read, compute, then write back in app code, rather than for the decrement itself.',
            affects: ['orderSvc'],
          },
        ],
      },
    },
    {
      id: 'payment',
      label: 'Payment Service',
      category: 'external',
      role: 'Charges the card via a third-party processor (Stripe-class) — must be safe to retry without double-charging.',
      position: { x: 1160, y: 340 },
      decision: {
        question: 'How do we make payment safe to retry?',
        options: [
          {
            id: 'idempotency-key',
            label: 'Idempotency keys',
            isDefault: true,
            summary: 'Client sends a unique key; server dedupes retries on it.',
            whatBreaks:
              'Nothing — a network timeout that makes the client retry will not double-charge, because the server recognizes the key and returns the original result. The subtlety: the server must lock or uniquely-constrain the key so a *concurrent* retry (arriving before the first request finishes) blocks or is rejected, rather than both seeing "no result yet" and charging twice.',
            tradeoffs:
              'The correct, industry-standard approach (Stripe works exactly this way, returning 409 on an in-flight duplicate). The dedup guarantee is time-bounded: Stripe keeps keys ~24h, after which the same key is treated as a brand-new request — so a retry past the window will charge again.',
            why:
              'Retries are inevitable (timeouts, flaky mobile networks). An idempotency key turns "did that charge go through?" from a guess into a guarantee. This is the e-commerce analog of the booking unique index.',
            affects: ['orderSvc'],
          },
          {
            id: 'no-idempotency',
            label: 'No dedup',
            summary: 'Process every payment request as new.',
            whatBreaks:
              'A timeout-and-retry double-charges the customer. You end up reconciling disputes and refunds by hand — a correctness failure that directly costs money and trust.',
            tradeoffs:
              'Less to build. But it is simply incorrect under real network conditions.',
            why:
              'Never acceptable for money movement. Included to make the cost of skipping idempotency concrete.',
            affects: ['orderSvc'],
          },
        ],
      },
    },
    {
      id: 'ordersDb',
      label: 'Orders DB',
      category: 'datastore',
      role: 'Relational source of truth for orders and their state (placed → paid → shipped). Strong consistency for money and fulfillment.',
      position: { x: 1160, y: 560 },
    },
    {
      id: 'queue',
      label: 'Order Queue + Workers',
      category: 'queue',
      role: 'A durable queue plus the worker pool that consumes it. The queue buffers the "order placed" event; the workers drive the post-checkout saga — charge payment, then fulfillment, then email — as sequential steps with retries and compensating actions. (The queue is passive; the workers call the other services.)',
      position: { x: 1400, y: 440 },
    },
    {
      id: 'fulfillment',
      label: 'Fulfillment Service',
      category: 'compute',
      role: 'After payment clears, allocates the order to a warehouse and triggers pick-pack-ship. (Stock was already reserved at checkout; this is allocation/fulfillment, not a second reservation.)',
      position: { x: 1400, y: 600 },
    },
    {
      id: 'objectStore',
      label: 'Object Storage (S3)',
      category: 'datastore',
      role: 'Durable blob store for product images (CDN origin) and generated documents like invoices/receipts written post-payment.',
      position: { x: 1400, y: 260 },
    },
    {
      id: 'monitoring',
      label: 'Observability',
      category: 'compute',
      role: 'Metrics, logs, and traces — how you spot a payment-failure spike or a saga stuck in "pending" before customers complain.',
      position: { x: 1400, y: 100 },
    },
  ],
  edges: [
    { id: 'e1', source: 'client', target: 'dns', label: 'resolve', control: true },
    { id: 'e3', source: 'dns', target: 'lb', label: 'resolves to', control: true },
    { id: 'e2', source: 'client', target: 'cdn', label: 'product images' },
    { id: 'e2b', source: 'client', target: 'lb', label: 'API requests' },
    { id: 'e15b', source: 'cdn', target: 'objectStore', label: 'origin fetch' },
    { id: 'e4', source: 'lb', target: 'gateway', label: 'route' },
    { id: 'e5', source: 'gateway', target: 'auth', label: 'verify token' },
    { id: 'e6', source: 'gateway', target: 'catalog', label: 'browse / search' },
    { id: 'e7', source: 'gateway', target: 'cart', label: 'add to cart' },
    { id: 'e8', source: 'gateway', target: 'orderSvc', label: 'checkout' },
    { id: 'e9', source: 'orderSvc', target: 'cart', label: 'read cart' },
    { id: 'e10', source: 'orderSvc', target: 'inventory', label: 'reserve stock' },
    { id: 'e11', source: 'orderSvc', target: 'ordersDb', label: 'create order' },
    { id: 'e12', source: 'orderSvc', target: 'queue', label: 'place order', async: true },
    { id: 'e13', source: 'queue', target: 'payment', label: 'charge', async: true },
    { id: 'e14', source: 'queue', target: 'fulfillment', label: 'on paid → fulfill + ship', async: true },
    { id: 'e15', source: 'queue', target: 'objectStore', label: 'store invoice (post-pay)', async: true },
    { id: 'e16', source: 'orderSvc', target: 'monitoring', label: 'metrics', async: true },
  ],
}
