import type { Domain } from '../types'

// Reference design: Amazon-class cart + checkout. The defining tensions are
// inventory consistency at checkout and payment idempotency on retries.
//
// Complete architecture: most nodes are context (DNS, CDN, LB, gateway, auth,
// orders DB, fulfillment, object store, observability); a few carry the swaps.
export const ecommerce: Domain = {
  id: 'ecommerce',
  name: 'E-commerce Checkout',
  tagline: 'Never sell more stock than you have; never charge a card twice on a retry.',
  referenceNote:
    'Based on Amazon-scale online stores. Browsing is mostly reads and easy to cache; checkout is the busy path where getting it right really matters.',
  requirements: {
    functional: [
      'Browse and search the product catalog',
      'Add items to a cart that follows the user from one device to another',
      'Check out: set the stock aside, take payment, and create the order',
      'Never sell more stock than you have; never charge a card twice',
    ],
    nonFunctional: [
      'Browsing can be cached and should almost always be available; checkout has to be exactly right',
      'Payments are idempotent — meaning it is safe to send the same request again after a timeout',
      'It is fine for the catalog to update a little late; stock counts and money must always be exact',
      'Handle sudden traffic spikes on a few popular items during a flash sale',
    ],
  },
  scale: [
    { metric: 'Browsing vs. checkout', value: '~20 : 1', note: 'far more browsing than buying' },
    { metric: 'Catalog size', value: '10M+ SKUs' },
    { metric: 'Payment retry guarantee', value: 'exactly-once effect' },
    { metric: 'Oversells allowed', value: '0' },
  ],
  principle: {
    title: 'Design for the retry, not just the case where everything goes right',
    body:
      'Networks time out and apps try again, so the real question is never "did it work?" but "is it safe to do this twice?". An idempotency key (a unique tag the client attaches to a request so the server can recognize a repeat) turns a second charge into a harmless no-op, just as a booking\'s unique index turns a duplicate booking into a rejection. Notice the pattern that keeps coming up across systems: you get correctness by making the dangerous action physically impossible to repeat, at a layer nothing can sneak around.',
  },
  nodes: [
    {
      id: 'client',
      label: 'Client',
      category: 'client',
      role: 'The web and mobile store. This is where the shopper browses the catalog, fills a cart, and checks out.',
      position: { x: 0, y: 340 },
    },
    {
      id: 'dns',
      label: 'DNS',
      category: 'edge',
      role: 'Turns the store\'s domain name into an address to connect to, and can point users to a nearby region for lower latency. It is just a lookup, not a stop the traffic passes through — after looking it up, the client connects straight to the load balancer or CDN.',
      position: { x: 220, y: 180 },
    },
    {
      id: 'cdn',
      label: 'CDN',
      category: 'edge',
      role: 'Keeps copies of product images and other unchanging files on servers close to users. Most of browsing can be cached this way, so it takes the bulk of read traffic off the main system.',
      position: { x: 220, y: 500 },
    },
    {
      id: 'lb',
      label: 'Load Balancer',
      category: 'edge',
      role: 'Spreads incoming API traffic across the gateway/app servers and keeps checking that each one is healthy.',
      position: { x: 440, y: 340 },
    },
    {
      id: 'gateway',
      label: 'API Gateway',
      category: 'edge',
      role: 'The single front door for API requests: handles encryption (TLS), makes sure the request is logged in (leaving the actual token check to the auth service), limits how often a client can call, and routes the request to the catalog, cart, and order services.',
      position: { x: 660, y: 200 },
    },
    {
      id: 'auth',
      label: 'Auth Service',
      category: 'compute',
      role: 'Checks login tokens and sessions so each cart and order is tied to a real user and checkout is only done by someone signed in.',
      position: { x: 660, y: 480 },
    },
    {
      id: 'catalog',
      label: 'Catalog Search',
      category: 'datastore',
      role: 'Handles browsing, searching, and filtering products. It is a copy of the product data built for fast reads, kept up to date from the main catalog by a background process.',
      position: { x: 900, y: 80 },
      decision: {
        question: 'What handles product search and browsing?',
        options: [
          {
            id: 'elasticsearch',
            label: 'Search engine (Elasticsearch)',
            isDefault: true,
            summary: 'Uses an inverted index (a word-to-products lookup built for fast text search) to power full-text search, filters, and result ranking.',
            whatBreaks:
              'Nothing for browsing — but this is a secondary copy of the data, not the official source. You have to keep it in sync with the main database, so it updates a little late (a price you just changed may take a moment to show up).',
            tradeoffs:
              'Fast text search, forgives typos, and offers filtering by attributes that a plain SQL LIKE search cannot do well. The cost is one more system to run plus a process to keep it in sync.',
            why:
              'Searching a catalog is exactly what an inverted index is built for. Prices and stock stay official in the main database; search is just a fast, read-friendly copy.',
            affects: ['orderSvc'],
          },
          {
            id: 'sql-like',
            label: 'SQL LIKE queries',
            summary: 'Search the main relational database directly with LIKE/ILIKE queries.',
            whatBreaks:
              'A search that puts a wildcard at the front, like LIKE \'%term%\', cannot use the database\'s B-tree index, so it has to scan every row — slow and hard on the database as the catalog grows. (A prefix search like \'term%\' can use the index; searching for text anywhere in the middle cannot.) There is also no ranking by relevance, no typo tolerance, and no filtering by attributes.',
            tradeoffs:
              'No extra systems to run, and it is always up to date. But it does not scale, and the search experience is poor.',
            why:
              'Fine for a small catalog (a few thousand items) where people rarely search. As soon as search matters, you outgrow it.',
            affects: ['orderSvc'],
          },
        ],
      },
    },
    {
      id: 'cart',
      label: 'Cart Store (Redis)',
      category: 'cache',
      role: 'Holds each user\'s in-progress shopping cart. This data changes often, does not last long, and gets read at checkout.',
      position: { x: 900, y: 320 },
      decision: {
        question: 'Where should the shopping cart be stored?',
        options: [
          {
            id: 'redis-cart',
            label: 'Redis (on the server)',
            isDefault: true,
            summary: 'Store the cart in Redis under the user, with a TTL (a time-to-live, so it auto-deletes after a set period).',
            whatBreaks:
              'Nothing — the cart survives across devices and page reloads, and carts nobody comes back to auto-expire via their TTL. If Redis is used purely as a cache (with nothing saved to disk), clearing it loses in-progress carts.',
            tradeoffs:
              'Fast, shared across the user\'s devices, and cleans up after itself. It adds one more store to run; turn on saving-to-disk if losing carts is unacceptable.',
            why:
              'Carts are short-lived, change often, and belong to one user — a perfect fit for an in-memory store with a TTL. Keeping it on the server means the cart follows the user from device to device.',
            affects: ['orderSvc'],
          },
          {
            id: 'db-cart',
            label: 'Database rows',
            summary: 'Save each cart item as a row in the main relational database.',
            whatBreaks:
              'Every "add to cart" click becomes a database write; carts change constantly, so you pile up a lot of write load plus leftover rows for abandoned carts that you have to clean up.',
            tradeoffs:
              'Saved permanently and easy to query (handy for analyzing abandoned carts). But it dumps constant, low-value writes onto your most valuable database.',
            why:
              'Reasonable if you want carts saved permanently plus analytics and your traffic is modest. Many shops mix both: Redis for the live cart, with a periodic copy saved to the database.',
            affects: ['orderSvc'],
          },
          {
            id: 'client-cart',
            label: 'Client-side (localStorage)',
            summary: 'Keep the cart entirely in the user\'s browser.',
            whatBreaks:
              'The cart does not follow the user to another device and is lost if they clear their browser storage. You cannot send "you left something in your cart" emails or carry the cart across devices.',
            tradeoffs:
              'No cart data on the server and it scales endlessly (it is the browser\'s job). But you give up carrying the cart across devices and any server-side view of it.',
            why:
              'Fine for guest checkout or keeping infrastructure minimal. Often combined with a server-side cart that kicks in once the user logs in.',
            affects: ['orderSvc'],
          },
        ],
      },
    },
    {
      id: 'orderSvc',
      label: 'Order Service',
      category: 'compute',
      role: 'The brain of checkout: it reads the cart, sets aside the stock, writes the order, then hands payment and shipping off to the queue and workers. This is where the tough correctness decisions are made.',
      position: { x: 900, y: 540 },
      decision: {
        question: 'How should we process the order after checkout?',
        options: [
          {
            id: 'async-order',
            label: 'In the background (a saga run through a queue)',
            isDefault: true,
            summary: 'Set aside the stock, then run payment and shipping as a saga: a sequence of steps where, if one fails, earlier steps are undone.',
            whatBreaks:
              'Nothing breaks, but the order updates in stages rather than all at once: it goes from "placed" to "confirmed". Each step must be idempotent (safe to repeat) and must have an undo action in case a later step fails.',
            tradeoffs:
              'Holds up well when downstream services are slow or failing, and scales nicely. The cost is writing the saga and its undo steps, plus a "your order is pending" experience for the user.',
            why:
              'Checkout involves many services (stock, payment, shipping, email). A saga lets each step retry or undo on its own, instead of cramming everything into one giant, fragile all-or-nothing transaction.',
            affects: ['queue', 'inventory', 'payment'],
          },
          {
            id: 'sync-order',
            label: 'Synchronous transaction',
            summary: 'Set aside the stock, charge the card, and write the order all in one request.',
            whatBreaks:
              'A slow payment call keeps the stock locked and the database transaction open the whole time; under load this forces checkouts to happen one after another and risks timeouts. If something fails partway through, you need a careful rollback.',
            tradeoffs:
              'Simple and always exact — there is no saga to reason about. But your checkout speed is now tied to how fast the payment provider responds, and fewer checkouts can run at once.',
            why:
              'Perfectly fine at low volume, where simplicity beats resilience and a slower payment step is acceptable.',
            affects: ['inventory', 'payment'],
          },
        ],
      },
    },
    {
      id: 'inventory',
      label: 'Inventory DB',
      category: 'datastore',
      role: 'The official stock counts — they must never drop below zero. This is the hot spot everyone competes for during a flash sale.',
      position: { x: 1160, y: 100 },
      decision: {
        question: 'How do we stop two shoppers from buying the last item?',
        options: [
          {
            id: 'reserve',
            label: 'Reserve first, confirm later',
            isDefault: true,
            summary: 'Move the stock into a "reserved" bucket in one all-or-nothing step, with a TTL so the hold expires if the sale never completes. (An inventory reservation is a temporary hold on stock while the shopper pays.)',
            whatBreaks:
              'The one-step conditional decrement (UPDATE ... SET stock = stock - n WHERE stock >= n — "only subtract if there is at least this much left") makes the decrement itself safe: the database physically refuses to go below zero, so no single transaction can oversell. Even so, end to end you still have to reconcile expired reservations against payments that arrive late, and total stock spread across multiple warehouses/shards is not protected by one row\'s CHECK. Reservations that are never confirmed expire and return their stock.',
            tradeoffs:
              'Clean and scales well; it is the same "hold" pattern used in ticket booking. You do have to run the expiry process and handle the in-between "reserved but not yet paid for" state.',
            why:
              'Same idea as ticket booking: a conditional all-or-nothing write at the official source is what actually prevents overselling. Reservations give the shopper time to pay without keeping database rows locked.',
            affects: ['orderSvc'],
          },
          {
            id: 'pessimistic-inv',
            label: 'Pessimistic row lock',
            summary: 'Lock the stock row (SELECT FOR UPDATE) during checkout so only one shopper can touch it at a time.',
            whatBreaks:
              'For a popular item (a flash deal), every shopper has to wait in line behind one locked row; throughput collapses, and holding the lock while payment runs risks timeouts and deadlocks.',
            tradeoffs:
              'Simple and correct for slow-moving items. But it forces shoppers into a single-file line on exactly the popular items where you most need many buyers at once.',
            why:
              'Acceptable when items rarely have two buyers at the same moment. Keep the locked section tiny — never hold the lock while payment is running.',
            affects: ['orderSvc'],
          },
          {
            id: 'optimistic-inv',
            label: 'Optimistic (version/CAS)',
            summary: 'Update the stock only if its version number has not changed since you read it; retry if someone else got there first.',
            whatBreaks:
              'On a popular item, many checkouts collide and retry — a flood of retries that adds delay right when demand spikes.',
            tradeoffs:
              'No locks; excellent when clashes are rare (which is most stock, most of the time). It gets worse when many buyers fight over a single item.',
            why:
              'A great default for normal stock. Note that the thing actually keeping you safe is the conditional decrement (WHERE stock >= n) — the version number matters when your app has to read a value, do some math, then write it back, not for the decrement itself.',
            affects: ['orderSvc'],
          },
        ],
      },
    },
    {
      id: 'payment',
      label: 'Payment Service',
      category: 'external',
      role: 'Charges the card through an outside payment processor (Stripe-style) — and it must be safe to retry without charging twice.',
      position: { x: 1160, y: 340 },
      decision: {
        question: 'How do we make a payment safe to retry?',
        options: [
          {
            id: 'idempotency-key',
            label: 'Idempotency keys',
            isDefault: true,
            summary: 'The client attaches a unique key to the request (an idempotency key); the server uses it to spot and ignore repeats.',
            whatBreaks:
              'Nothing — if a network timeout makes the client send the request again, it will not charge twice, because the server recognizes the key and returns the original result. The subtle part: the server must lock the key or mark it unique so that a retry arriving *while the first request is still in progress* is blocked or rejected, instead of both seeing "no result yet" and each charging the card.',
            tradeoffs:
              'The correct, industry-standard approach (Stripe works exactly this way, returning a 409 error when a duplicate is still in flight). The guarantee has a time limit: Stripe keeps keys for about 24 hours, after which the same key counts as a brand-new request — so a retry after that window will charge again.',
            why:
              'Retries are unavoidable (timeouts, spotty mobile networks). An idempotency key turns "did that charge actually go through?" from a guess into a guarantee. This is the e-commerce version of the booking system\'s unique index.',
            affects: ['orderSvc'],
          },
          {
            id: 'no-idempotency',
            label: 'No dedup',
            summary: 'Treat every payment request as brand new.',
            whatBreaks:
              'A timeout followed by a retry charges the customer twice. You end up sorting out disputes and refunds by hand — a correctness failure that directly costs money and trust.',
            tradeoffs:
              'Less to build. But it is simply wrong under real-world network conditions.',
            why:
              'Never acceptable when money is moving. Included to make the cost of skipping idempotency concrete.',
            affects: ['orderSvc'],
          },
        ],
      },
    },
    {
      id: 'ordersDb',
      label: 'Orders DB',
      category: 'datastore',
      role: 'The official relational database for orders and their status (placed to paid to shipped). It must be exactly consistent, because money and shipping depend on it.',
      position: { x: 1160, y: 560 },
    },
    {
      id: 'queue',
      label: 'Order Queue + Workers',
      category: 'queue',
      role: 'A durable queue (it does not lose messages) plus the pool of workers that read from it. The queue holds the "order placed" event; the workers run the after-checkout saga — charge payment, then arrange shipping, then send email — as steps done in order, with retries and undo actions when something fails. (The queue just holds messages; the workers are what call the other services.)',
      position: { x: 1400, y: 440 },
    },
    {
      id: 'fulfillment',
      label: 'Fulfillment Service',
      category: 'compute',
      role: 'Once payment clears, it assigns the order to a warehouse and kicks off pick, pack, and ship. (The stock was already set aside at checkout; this step assigns and ships it, it does not reserve it a second time.)',
      position: { x: 1400, y: 600 },
    },
    {
      id: 'objectStore',
      label: 'Object Storage (S3)',
      category: 'datastore',
      role: 'Durable storage for large files: product images (which the CDN pulls from) and generated documents like invoices and receipts written after payment.',
      position: { x: 1400, y: 260 },
    },
    {
      id: 'monitoring',
      label: 'Observability',
      category: 'compute',
      role: 'Metrics, logs, and traces — how you catch a spike in failed payments or a saga stuck on "pending" before customers start complaining.',
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
