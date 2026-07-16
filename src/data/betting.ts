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
  tagline: 'Send odds to users as they change, take a flood of bets at once, and get the money exactly right.',
  referenceNote:
    'Based on a live in-play betting exchange, where users bet against each other (peer-to-peer, like Betfair) and the odds come from users\' own buy/sell orders (the order book). When a goal is scored, everyone bets at once, so the system gets a sudden flood of writes and the money math has to be perfect. (A regular sportsbook works differently: a separate pricing engine sets the odds and you bet against the house, not other users.)',
  requirements: {
    functional: [
      'Send live, always-changing odds to many users at once',
      'Let a user place a bet at the price shown right now',
      'When the event ends, pay out bets and update balances',
      'Keep a full record of every bet and payout',
    ],
    nonFunctional: [
      'Get odds to users almost instantly — the server pushes them, users do not keep asking',
      'Handle a burst of bets that all land at the same moment (a goal) without making them wait in line for a lock',
      'The money must always add up and be fully checkable',
      'Money has to be exactly right; odds just have to be fresh',
    ],
  },
  scale: [
    { metric: 'Odds changes', value: 'several / sec per market' },
    { metric: 'Bet flood at a big moment', value: 'thousands/sec', note: 'all on one market' },
    { metric: 'Users connected at once', value: '100k+', note: 'each holds an open WebSocket connection' },
    { metric: 'Money accuracy', value: 'balances to the cent, always' },
  ],
  principle: {
    title: 'Get rid of the traffic jam by handling bets one at a time; never overwrite money, only add to it',
    body:
      'When a flood of bets hits at once, both ways of using locks (optimistic and pessimistic) fall apart — so instead of managing the traffic jam, you avoid it: send every bet for one market through a single worker that lives in memory and handles them one after another, and record each bet in an add-only event log that is the official record. For money, never change a balance in place — instead add matched pairs of entries (double-entry) so every cent can be recalculated and checked. In short: when many things fight for the same spot, line them up; for money, always add a new record, never destroy the old one.',
  },
  nodes: [
    {
      id: 'client',
      label: 'Client',
      category: 'client',
      role: 'Web and mobile apps. Listens for a live stream of odds and places bets — often everyone at the same instant a goal goes in.',
      position: { x: 0, y: 340 },
    },
    {
      id: 'dns',
      label: 'DNS',
      category: 'edge',
      role: 'Turns the website name into an address to connect to, and can send users to a nearby region (using records that pick the lowest-latency option). It is just a lookup, not a stop the traffic passes through — after it, the client connects straight to the load balancer.',
      position: { x: 220, y: 180 },
    },
    {
      id: 'lb',
      label: 'Load Balancer',
      category: 'edge',
      role: 'Spreads incoming bet requests evenly across the gateway servers and checks that each one is healthy.',
      position: { x: 440, y: 340 },
    },
    {
      id: 'oddsGateway',
      label: 'Odds Delivery',
      category: 'edge',
      role: 'Keeps open connections to thousands of users and pushes the always-changing odds to them. It listens to the odds cache and forwards each update out to everyone.',
      position: { x: 680, y: 120 },
      decision: {
        question: 'How do we get live odds to users?',
        options: [
          {
            id: 'websocket',
            label: 'WebSocket push',
            isDefault: true,
            summary: 'The connection stays open, and the server pushes new odds the moment they change.',
            whatBreaks:
              'Speed is not a problem — users see new odds right away. But now you are holding many open connections at once, so the gateway has to keep track of every connection and add more servers as you grow, with a fan-out layer (that copies each update to all of them) behind it.',
            tradeoffs:
              'Fastest option, and no wasted requests. The cost is having to track every open connection and run a fan-out layer (for example Redis pub/sub) to send each update to everyone.',
            why:
              'Odds change several times a second during a live event, and pushing is the only way to keep users up to date. If the odds a user sees are out of date, you take bets at the wrong price — which loses money.',
            affects: ['matchingEngine', 'cache'],
          },
          {
            id: 'polling',
            label: 'HTTP polling',
            summary: 'Users ask again for the odds every second or two.',
            whatBreaks:
              'A user\'s odds are always as old as the gap between checks — they might bet on odds that already changed. And with thousands of users asking every second, you create a flood of requests on yourself.',
            tradeoffs:
              'No open connections to track, so it is easy to scale behind a normal load balancer and cache. But the odds are less fresh, and you waste huge numbers of requests just to hear "nothing changed".',
            why:
              'Fine for odds that change slowly (before the match starts). During live play, the delay between checks is a real problem.',
            affects: ['cache'],
          },
        ],
      },
    },
    {
      id: 'gateway',
      label: 'Bet API Gateway',
      category: 'edge',
      role: 'The front door for placing bets: handles the secure connection (TLS), checks who the user is, and caps how many requests they can send, all before a bet reaches the risk checks and the engine.',
      position: { x: 680, y: 400 },
    },
    {
      id: 'auth',
      label: 'Auth Service',
      category: 'compute',
      role: 'Confirms the user is logged in, and that their account is verified and allowed to bet (identity checks and location rules — KYC and jurisdiction gating).',
      position: { x: 680, y: 580 },
    },
    {
      id: 'riskSvc',
      label: 'Risk / Limits Service',
      category: 'compute',
      role: 'Runs checks before a bet reaches the engine: responsible-gambling limits, and — most importantly — it places a HOLD on the stake right away (setting that money aside), rather than just reading the balance (which might be out of date). Without that hold, many bets arriving at once could each see enough money and, together, spend more than the user has. The hold is done as one all-or-nothing step that subtracts from an always-accurate "money available" counter (later checked against the ledger). A quick read of the balance is only for speed — it is never what keeps the bets in order.',
      position: { x: 940, y: 440 },
    },
    {
      id: 'matchingEngine',
      label: 'Bet Matching Engine',
      category: 'compute',
      role: 'Takes in bets when a burst of them arrives at the same time — the busiest, most fought-over spot, which the whole design is built around. On an exchange, a bet is matched against other users\' opposing offers (bets for and against, called back and lay); whatever is left unmatched waits in the order book (the list of pending offers), and the best available offers there *are* the current odds.',
      position: { x: 940, y: 200 },
      decision: {
        question: 'How do we take bets correctly during a spike (a goal just happened)?',
        options: [
          {
            id: 'event-sourcing',
            label: 'In-memory engine + event log',
            isDefault: true,
            summary: 'One worker in memory matches the bets; every bet is also added to a durable event log (a saved list on disk).',
            whatBreaks:
              'Little, if built right — one worker per market (running on a single thread) handles bets in a fixed order, so no bets fight over a lock. The one trap: because you rebuild state by replaying that add-only log, each bet must be safely saved to the log *before* you tell the user it was accepted (the LMAX approach). If you confirm first and save later, a crash quietly loses bets you already accepted.',
            tradeoffs:
              'Very high throughput and easy to check (replay the log to rebuild the state). The cost is the extra complexity: this event-log style, taking periodic snapshots, and recovering the in-memory worker if it fails.',
            why:
              'This is how real exchanges and trading venues work — the LMAX Disruptor pattern (LMAX is a currency-trading venue). Sending one market through one worker, one bet at a time, means no fighting over locks in the matching step. The stake was already set aside earlier by the risk service, so the final payout can happen later and in the background, and the event log gives you a perfect record of the money.',
            affects: ['eventLog', 'cache'],
          },
          {
            id: 'db-txn',
            label: 'DB transaction per bet',
            summary: 'Each bet adds a row and updates the balance together in one all-or-nothing database transaction.',
            whatBreaks:
              'When a goal is scored, thousands of bets arrive at once; locks on the same market and on user balances force them through the database one at a time, and response times spike — right when speed matters most.',
            tradeoffs:
              'Simple, always consistent, and easy to reason about. But the database becomes the bottleneck during the very spikes that define this problem.',
            why:
              'Fine for low volume or betting before the match. The event-log engine exists precisely because a database transaction per bet cannot keep up with in-play bursts.',
            affects: ['ledger', 'cache'],
          },
          {
            id: 'optimistic-bet',
            label: 'Optimistic concurrency',
            summary: 'Read the balance and odds, only write if nothing changed in the meantime, and try again if it did.',
            whatBreaks:
              'During a burst, clashes are the rule, not the exception — so most bets have to try again, adding delay and load at the busiest moment.',
            tradeoffs:
              'No locks are held, which is great when clashes are rare. But live betting is defined by everyone acting at the same instant, the worst case for this retry approach.',
            why:
              'Reasonable when few bets clash. The fact that live betting causes constant clashes is exactly why handling bets one at a time wins here.',
            affects: ['ledger'],
          },
        ],
      },
    },
    {
      id: 'cache',
      label: 'Odds Cache (Redis)',
      category: 'cache',
      role: 'Keeps the current odds in memory and has a publish/subscribe channel that sends each update out to every odds-delivery server.',
      position: { x: 1200, y: 80 },
      decision: {
        question: 'What stores the live odds and sends them out to everyone?',
        options: [
          {
            id: 'redis-pubsub',
            label: 'Redis (KV + pub/sub)',
            isDefault: true,
            summary: 'Keep the current odds in memory and publish each change to the gateways that subscribed.',
            whatBreaks:
              'Nothing — reads take under a millisecond, and the built-in publish/subscribe sends each update to every WebSocket server. Odds are temporary live data, so if they are lost on a restart you just recompute them from the engine.',
            tradeoffs:
              'Fast, and you get the send-to-everyone feature for free. It adds an in-memory store; publish/subscribe is send-and-forget (each message is delivered at most once), so a gateway that briefly disconnects misses some updates — but since each update is just the latest full price, the next update carries the current price and the gap fixes itself (use Redis Streams or re-read the stored value if you need a guaranteed history of updates).',
            why:
              'Live odds are hot, short-lived, read-by-everyone data that has to be sent to many places — right in Redis\'s wheelhouse. Combining fast reads with publish/subscribe broadcast is the standard pattern.',
            affects: ['oddsGateway'],
          },
          {
            id: 'db-odds',
            label: 'Read odds from DB',
            summary: 'Serve the current odds straight from the main database.',
            whatBreaks:
              'Thousands of users reading odds several times a second pound the database, and it has no built-in way to push updates out — so you are back to users asking over and over. Both speed and load get worse.',
            tradeoffs:
              'One fewer system to run, and a single source of truth. But a database is the wrong tool for reads that are this hot, this fresh, and need to go out to everyone.',
            why:
              'Only workable at very small scale. Shown to make the case for the cache plus publish/subscribe clearer.',
            affects: ['oddsGateway'],
          },
        ],
      },
    },
    {
      id: 'eventLog',
      label: 'Event Log (Kafka)',
      category: 'queue',
      role: 'A durable, in-order, add-only log of every bet — the official record you replay to rebuild the engine\'s state and to drive payouts.',
      position: { x: 1200, y: 300 },
    },
    {
      id: 'settlementSvc',
      label: 'Settlement Service',
      category: 'compute',
      role: 'When the official result arrives (from the results feed), it matches that outcome against the open bets in the event log, works out who won, and records the money in and out in the ledger — in a way that is safe to repeat, so replaying it never pays anyone twice. You cannot tell who won from the bet log alone; you need the official result.',
      position: { x: 1200, y: 500 },
    },
    {
      id: 'resultsFeed',
      label: 'Results Feed',
      category: 'external',
      role: 'An outside data feed that provides the official outcome of the event (final score or market result). You cannot pay out without it: the bet log says who bet what, and the results feed says what actually happened.',
      position: { x: 960, y: 640 },
    },
    {
      id: 'ledger',
      label: 'Settlement Ledger',
      category: 'datastore',
      role: 'Records stake holds, settlements, payouts, and balances — it must always add up to the cent and stay fully checkable.',
      position: { x: 1440, y: 360 },
      decision: {
        question: 'How do we track the money so it is always correct?',
        options: [
          {
            id: 'double-entry',
            label: 'Double-entry, append-only',
            isDefault: true,
            summary: 'Every money movement is written as two matching entries; balances are added up from those entries, never overwritten.',
            whatBreaks:
              'Nothing — you can never "lose" money, because every amount taken out has a matching amount put in somewhere, and the log can never be changed. A balance is just the sum of the entries, which you can recompute and check at any time.',
            tradeoffs:
              'Checkable, tamper-evident, and easy to reconcile — the standard way accounting is done. It costs more storage and an extra step to add up the balance (often sped up with saved snapshots) instead of reading a single number.',
            why:
              'Money needs a full paper trail and a guarantee that it always adds up. This add-only, two-matching-entries style fits perfectly with the bet event log, and giving each entry a unique key means a repeated attempt is not counted twice.',
            affects: ['settlementSvc', 'riskSvc'],
          },
          {
            id: 'mutable-balance',
            label: 'Mutable balance column',
            summary: 'Keep one balance number per user and change it in place.',
            whatBreaks:
              'No history — a bug or a lost update quietly corrupts a balance, with no way to check or rebuild what happened. Updates arriving at once can overwrite each other unless you lock carefully.',
            tradeoffs:
              'Reading a balance is one fast lookup and takes almost no storage. But you give up the ability to check the numbers and the safety net of a ledger you can recompute and prove adds up.',
            why:
              'Tempting because it is simple, and fine for counters that are not money. For real funds, the missing paper trail makes it the wrong choice — both regulators and reconciliation need the history.',
            affects: ['settlementSvc', 'riskSvc'],
          },
        ],
      },
    },
    {
      id: 'monitoring',
      label: 'Observability',
      category: 'compute',
      role: 'Metrics, logs, and traces — engine response times, how many bets go through, and alerts if the ledger stops adding up. In money systems, the thing you fear most is the books quietly not balancing.',
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
