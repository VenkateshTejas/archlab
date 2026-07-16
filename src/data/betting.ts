import type { Domain } from '../types'

// Reference design: live in-play betting exchange. Defining tensions: pushing
// fast-moving odds to many clients, accepting bets correctly under a write
// spike at the moment of a goal, and a settlement ledger that must always balance.
//
// Complete architecture: most nodes are context (DNS, LB, bet API gateway, auth,
// risk checks, settlement, observability); a few carry the swap decisions.
export const betting: Domain = {
  id: 'betting',
  name: 'Live Betting Exchange',
  tagline: 'Push odds in real time; accept bets under spikes; settle money correctly.',
  referenceNote:
    'Modeled on a live in-play betting exchange (peer-to-peer, Betfair-style — odds emerge from the order book). A goal triggers a write spike and correctness of money is non-negotiable. (A traditional sportsbook differs: a separate pricing/trading engine sets odds and you bet against the house, not other users.)',
  requirements: {
    functional: [
      'Stream live, constantly-changing odds to many clients',
      'Place a bet at the current price',
      'Settle bets and update balances when the event resolves',
      'Keep a full audit trail of every bet and payout',
    ],
    nonFunctional: [
      'Ultra-low-latency odds — push, do not poll',
      'Accept a burst of bets at one instant (a goal) without serializing on locks',
      'Money must always balance and be fully auditable',
      'Strong consistency for funds; freshness for odds',
    ],
  },
  scale: [
    { metric: 'Odds updates', value: 'several / sec per market' },
    { metric: 'Bet burst at a key moment', value: 'thousands/sec', note: 'on a single market' },
    { metric: 'Concurrent connections', value: '100k+', note: 'long-lived WebSockets' },
    { metric: 'Ledger accuracy', value: 'balances to the cent, always' },
  ],
  principle: {
    title: 'Remove the lock by removing concurrency; never mutate money in place',
    body:
      'Under a burst, optimistic and pessimistic locks both lose — so you eliminate contention instead of managing it: funnel one market through a single in-memory writer that processes bets in order, backed by an append-only event log as the source of truth. For money, never overwrite a balance — append double-entry rows so every cent is derivable and auditable. Hot contention → serialize; money → append, never destroy.',
  },
  nodes: [
    {
      id: 'client',
      label: 'Client',
      category: 'client',
      role: 'Web & mobile apps. Subscribes to a live odds stream and places bets — often everyone at once the instant a goal goes in.',
      position: { x: 0, y: 340 },
    },
    {
      id: 'dns',
      label: 'DNS',
      category: 'edge',
      role: 'Resolves the domain to a regional endpoint (it can geo-steer via latency-based records). It is a lookup, not a traffic hop — the client then connects directly to the load balancer.',
      position: { x: 220, y: 180 },
    },
    {
      id: 'lb',
      label: 'Load Balancer',
      category: 'edge',
      role: 'Spreads bet-placement API traffic across gateway instances and health-checks them.',
      position: { x: 440, y: 340 },
    },
    {
      id: 'oddsGateway',
      label: 'Odds Delivery',
      category: 'edge',
      role: 'Holds long-lived connections and pushes constantly-changing odds to thousands of clients, subscribing to the odds cache and fanning updates out.',
      position: { x: 680, y: 120 },
      decision: {
        question: 'How do we get live odds to clients?',
        options: [
          {
            id: 'websocket',
            label: 'WebSocket push',
            isDefault: true,
            summary: 'Persistent connections; server pushes odds the instant they change.',
            whatBreaks:
              'Nothing for latency — clients see new odds immediately. But you now hold many long-lived connections, so the gateway must manage connection state and scale horizontally with a pub/sub fan-out behind it.',
            tradeoffs:
              'Lowest latency and no wasted requests. Costs you stateful connection management and a fan-out layer (e.g. Redis pub/sub) to broadcast updates.',
            why:
              'Odds move multiple times per second on a live event; pushing is the only way to keep clients accurate. Stale odds mean you accept bets at the wrong price — a direct financial risk.',
            affects: ['matchingEngine', 'cache'],
          },
          {
            id: 'polling',
            label: 'HTTP polling',
            summary: 'Clients re-request odds every second or two.',
            whatBreaks:
              'Clients are always a poll-interval stale — they may bet on odds that already moved. At scale, thousands of clients polling every second is a self-inflicted request flood.',
            tradeoffs:
              'Stateless and trivial to scale behind a normal load balancer + cache. But it trades freshness and wastes huge request volume on "nothing changed".',
            why:
              'Acceptable for slowly-changing data (pre-match odds). For live in-play, the staleness window is a real liability.',
            affects: ['cache'],
          },
        ],
      },
    },
    {
      id: 'gateway',
      label: 'Bet API Gateway',
      category: 'edge',
      role: 'Front door for bet placement: TLS, authentication, and rate limiting before a bet reaches risk checks and the engine.',
      position: { x: 680, y: 400 },
    },
    {
      id: 'auth',
      label: 'Auth Service',
      category: 'compute',
      role: 'Validates the bettor\'s session and that the account is verified and permitted to bet (KYC / jurisdiction gating).',
      position: { x: 680, y: 580 },
    },
    {
      id: 'riskSvc',
      label: 'Risk / Limits Service',
      category: 'compute',
      role: 'Pre-trade checks before a bet reaches the engine: responsible-gambling limits, and — critically — it places a synchronous HOLD on the stake (a reservation), not just a stale read. Without that hold, many concurrent bets could each pass a balance check and collectively overspend. The hold is an atomic conditional decrement on a strongly-consistent available-balance counter (reconciled to the ledger); a snapshot is only the fast read, never the serialization point.',
      position: { x: 940, y: 440 },
    },
    {
      id: 'matchingEngine',
      label: 'Bet Matching Engine',
      category: 'compute',
      role: 'Accepts bets under a burst of simultaneous requests — the contention hot spot the whole design is built around. On an exchange a bet matches against opposing users\' back/lay offers, with any unmatched remainder resting in the order book (and the top of book *is* the current odds).',
      position: { x: 940, y: 200 },
      decision: {
        question: 'How do we accept bets correctly during a spike (a goal just happened)?',
        options: [
          {
            id: 'event-sourcing',
            label: 'In-memory engine + event log',
            isDefault: true,
            summary: 'Single-writer in-memory matcher; append every bet to a durable event log.',
            whatBreaks:
              'Little if designed right — a single-threaded matcher per market processes bets in deterministic order with no lock contention. The one trap: because the append-only log is your replay source-of-truth, the input must be durably journaled *before* you acknowledge the bet (LMAX-style). Ack first and append later and a crash silently loses accepted bets.',
            tradeoffs:
              'Extremely high throughput and clean auditability (replay the log to rebuild state). Costs you the complexity of event sourcing, snapshots, and failover of the in-memory state.',
            why:
              'This is how exchanges and trading venues actually work — the LMAX Disruptor pattern (LMAX is an FX venue). Serializing one market through one writer removes lock contention in the matching path; the stake is already held upstream by the risk service, so final settlement can be pushed downstream and async, and the event log gives you a perfect audit trail for money.',
            affects: ['eventLog', 'cache'],
          },
          {
            id: 'db-txn',
            label: 'DB transaction per bet',
            summary: 'Each bet is a row insert + balance update in one ACID transaction.',
            whatBreaks:
              'At the moment of a goal, thousands of bets hit at once; row locks on the same market and on user balances serialize through the DB and latency spikes — exactly when speed matters most.',
            tradeoffs:
              'Simple, strongly consistent, easy to reason about. But the DB becomes the contention point under the spikes that define this domain.',
            why:
              'Fine for low-volume or pre-match betting. The event-sourced engine exists precisely because per-bet DB transactions do not hold up under in-play bursts.',
            affects: ['ledger', 'cache'],
          },
          {
            id: 'optimistic-bet',
            label: 'Optimistic concurrency',
            summary: 'Read balance/odds, write conditionally, retry on conflict.',
            whatBreaks:
              'During a burst, conflicts are the norm, not the exception — so most bets retry, adding latency and load right at the peak moment.',
            tradeoffs:
              'No locks held; good when collisions are rare. But in-play betting is defined by everyone acting at the same instant, which is the worst case for optimistic retries.',
            why:
              'Reasonable for low-contention markets. The contention profile of live betting is exactly why a serialized engine wins here.',
            affects: ['ledger'],
          },
        ],
      },
    },
    {
      id: 'cache',
      label: 'Odds Cache (Redis)',
      category: 'cache',
      role: 'Holds current odds in memory plus a pub/sub channel that fans updates out to every odds-delivery node.',
      position: { x: 1200, y: 80 },
      decision: {
        question: 'What holds the live odds and fans them out?',
        options: [
          {
            id: 'redis-pubsub',
            label: 'Redis (KV + pub/sub)',
            isDefault: true,
            summary: 'Current odds in memory; publish changes to subscribed gateways.',
            whatBreaks:
              'Nothing — sub-ms reads for current odds and a built-in pub/sub to broadcast updates to every WebSocket node. Odds are ephemeral live state, so losing them on restart just means recomputing from the engine.',
            tradeoffs:
              'Fast and gives you fan-out for free. Adds an in-memory store; pub/sub is fire-and-forget (at-most-once), so a disconnected gateway misses ticks — but because odds are last-value-wins snapshots, the next tick carries the current price and the gap self-heals (use Redis Streams or re-read the KV if you need a guaranteed backlog).',
            why:
              'Live odds are hot, ephemeral, read-by-everyone state with a fan-out need — squarely Redis territory. Pairing KV reads with pub/sub broadcast is the standard pattern.',
            affects: ['oddsGateway'],
          },
          {
            id: 'db-odds',
            label: 'Read odds from DB',
            summary: 'Serve current odds straight from the primary database.',
            whatBreaks:
              'Thousands of clients reading multi-times-per-second odds hammer the DB, and you have no native fan-out to push updates — you are back to polling. Latency and load both suffer.',
            tradeoffs:
              'One fewer system and a single source of truth. But the DB is the wrong tool for ultra-hot, ultra-fresh, broadcast-shaped reads.',
            why:
              'Only viable at tiny scale. Shown to make the cache + pub/sub rationale concrete.',
            affects: ['oddsGateway'],
          },
        ],
      },
    },
    {
      id: 'eventLog',
      label: 'Event Log (Kafka)',
      category: 'queue',
      role: 'Durable, ordered, append-only log of every bet — the source of truth you replay to rebuild engine state and drive settlement.',
      position: { x: 1200, y: 300 },
    },
    {
      id: 'settlementSvc',
      label: 'Settlement Service',
      category: 'compute',
      role: 'When the official result arrives (from the results feed), it joins that outcome against the open bets in the event log, computes who won, and posts the debits/credits to the ledger — idempotently, so a replay never double-pays. You cannot determine winners from the bet log alone; you need the authoritative result.',
      position: { x: 1200, y: 500 },
    },
    {
      id: 'resultsFeed',
      label: 'Results Feed',
      category: 'external',
      role: 'Third-party data feed providing the authoritative event outcome (final score / market result). Settlement is impossible without it: the bet log says who bet what, the results feed says what actually happened.',
      position: { x: 960, y: 640 },
    },
    {
      id: 'ledger',
      label: 'Settlement Ledger',
      category: 'datastore',
      role: 'Records stake holds, settlements, payouts, and balances — must always balance to the cent and stay fully auditable.',
      position: { x: 1440, y: 360 },
      decision: {
        question: 'How do we model the money so it is always correct?',
        options: [
          {
            id: 'double-entry',
            label: 'Double-entry, append-only',
            isDefault: true,
            summary: 'Every movement is two balanced entries; balances are derived, never overwritten.',
            whatBreaks:
              'Nothing — you can never "lose" money because every debit has a matching credit and the log is immutable. A balance is a sum of entries you can recompute and audit at any time.',
            tradeoffs:
              'Auditable, tamper-evident, and reconcilable — the accounting standard. Costs more storage and a derive-balance step (often snapshotted) instead of reading one number.',
            why:
              'Money demands an audit trail and a guarantee it always balances. Append-only double-entry pairs perfectly with the bet event log, and idempotency keys on each entry make retries safe.',
            affects: ['settlementSvc', 'riskSvc'],
          },
          {
            id: 'mutable-balance',
            label: 'Mutable balance column',
            summary: 'Store one balance number per user and update it in place.',
            whatBreaks:
              'No history — a bug or a lost update silently corrupts a balance with no way to audit or reconstruct what happened. Concurrent updates risk lost writes unless carefully locked.',
            tradeoffs:
              'Reading a balance is a single fast lookup and storage is tiny. But you sacrifice auditability and the safety net of a derivable, balanced ledger.',
            why:
              'Tempting for simplicity and fine for non-money counters. For real funds, the lack of an audit trail makes it the wrong call — regulators and reconciliation both demand history.',
            affects: ['settlementSvc', 'riskSvc'],
          },
        ],
      },
    },
    {
      id: 'monitoring',
      label: 'Observability',
      category: 'compute',
      role: 'Metrics, logs, and traces — engine latency, bet throughput, and ledger reconciliation alerts. In money systems, a silent imbalance is the nightmare you watch for.',
      position: { x: 1440, y: 120 },
    },
  ],
  edges: [
    { id: 'e1', source: 'client', target: 'dns', label: 'resolve', control: true },
    { id: 'e3', source: 'dns', target: 'lb', label: 'resolves to', control: true },
    { id: 'e2', source: 'client', target: 'oddsGateway', label: 'subscribe (WS)' },
    { id: 'e2b', source: 'client', target: 'lb', label: 'place bet (HTTPS)' },
    { id: 'e4', source: 'lb', target: 'gateway', label: 'route' },
    { id: 'e5', source: 'gateway', target: 'auth', label: 'verify token' },
    { id: 'e6', source: 'gateway', target: 'riskSvc', label: 'validate bet' },
    { id: 'e7', source: 'riskSvc', target: 'ledger', label: 'hold stake' },
    { id: 'e8', source: 'riskSvc', target: 'matchingEngine', label: 'accept bet' },
    { id: 'e9', source: 'oddsGateway', target: 'cache', label: 'read / sub odds' },
    { id: 'e10', source: 'matchingEngine', target: 'eventLog', label: 'journal (before ack)' },
    { id: 'e11', source: 'matchingEngine', target: 'cache', label: 'update odds' },
    { id: 'e12', source: 'eventLog', target: 'settlementSvc', label: 'consume', async: true },
    { id: 'e15', source: 'resultsFeed', target: 'settlementSvc', label: 'official result', async: true },
    { id: 'e13', source: 'settlementSvc', target: 'ledger', label: 'post entries', async: true },
    { id: 'e14', source: 'matchingEngine', target: 'monitoring', label: 'metrics', async: true },
  ],
}
