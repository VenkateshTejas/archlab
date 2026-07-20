import type { Domain } from '../types'

// Reference design: TinyURL / bit.ly-class link shortener. Deliberately the
// SIMPLEST system in ArchLab — five nodes, laid out top-to-bottom so it stays
// big and legible on a phone. The whole design turns on two ideas: reads
// dominate (so cache them), and short codes must never collide (so generate
// them in a way that can't).
export const urlShortener: Domain = {
  id: 'url',
  name: 'URL Shortener',
  layout: 'TB',
  badge: 'Mobile friendly',
  tagline: 'Turn a long link into a short one — and send a flood of clicks back to the right page, fast.',
  referenceNote:
    'Based on TinyURL / bit.ly. The classic "simple" system-design question: the hard parts are staying fast under mostly-read traffic and making sure two links never get the same short code. (DNS and a CDN would sit in front in real life — left out here to keep the picture clear.)',
  requirements: {
    functional: [
      'Create a short link for any long URL',
      'Send a short link to its original URL (redirect)',
      'Each short code maps to exactly one URL — no collisions',
    ],
    nonFunctional: [
      'Redirects must be fast (<100ms) and almost always available',
      'Read-heavy: far more clicks (reads) than new links (writes)',
      'Short codes stay short (~7 characters) and unique',
      'Scale to billions of links',
    ],
  },
  scale: [
    { metric: 'Clicks vs. new links', value: '~100 : 1', note: 'reads dominate — this shapes the design' },
    { metric: 'New links per day', value: '~10M' },
    { metric: 'Short code length', value: '7 chars', note: 'base62 → 62⁷ ≈ 3.5 trillion codes' },
    { metric: 'Redirect latency', value: '<100ms' },
  ],
  principle: {
    title: 'Design around the read, and make writes collision-proof',
    body:
      'Two moves carry this whole system. First: clicks outnumber new links ~100 to 1, so you make the redirect the fast path — serve it from a cache and keep the database out of the way. Second: a short code must never be handed out twice, so you generate it in a way that cannot collide (a counter turned into base62) instead of guessing a random code and hoping. Both are the same lesson you saw elsewhere — cache the hot path, and enforce uniqueness at a layer nothing can bypass.',
  },
  nodes: [
    {
      id: 'client',
      label: 'Client',
      category: 'client',
      role: 'A browser, app, or anyone following a link. Two jobs: occasionally create a short link, and — far more often — click one and expect an instant redirect to the original page.',
      position: { x: 300, y: 0 },
    },
    {
      id: 'lb',
      label: 'Load Balancer',
      category: 'edge',
      role: 'The single front door. Spreads incoming requests across the shortener servers and stops sending traffic to any that have died. (In a real deployment DNS and a CDN sit in front of this — omitted here to keep the diagram simple.)',
      position: { x: 300, y: 140 },
    },
    {
      id: 'service',
      label: 'Shortener Service',
      category: 'compute',
      role: 'The brain. On a create, it makes a new short code and saves the code→URL mapping. On a click, it looks the code up (cache first, database on a miss) and returns a redirect. The key decision — how to generate a short code that never collides — lives here.',
      position: { x: 300, y: 280 },
      decision: {
        question: 'How do we generate a short code that is never handed out twice?',
        options: [
          {
            id: 'counter-base62',
            label: 'Counter + Base62',
            isDefault: true,
            summary:
              'Take an always-increasing number and write it in base62 (0-9, a-z, A-Z) — e.g. 125 → "cb". The number is already unique, so the code is too.',
            whatBreaks:
              'Nothing for correctness — each number maps to exactly one code, so codes can never collide and you never need a "is this taken?" check. The one catch: plain sequential codes are guessable (someone can walk /1, /2, /3 …). The fix is to hand each server a block of numbers at a time and/or scramble the number before encoding, so codes are neither in order nor enumerable.',
            tradeoffs:
              'The simplest thing that is collision-free by construction — no read-before-write, no retries. The cost is a single source for the counter (often a range allocator that hands each server 1,000 ids at a time so it is not a bottleneck), and you must scramble the ids if guessable links are a problem.',
            why:
              'Uniqueness comes for free because the number is already unique. This is the standard, boring, correct answer — everything else is working around a problem this one does not have.',
            affects: ['db'],
          },
          {
            id: 'random-check',
            label: 'Random + collision check',
            summary: 'Generate a random 7-character code, check the database, and retry if it is already taken.',
            whatBreaks:
              'As the table fills up, random codes start colliding, so you do a database lookup (and sometimes a retry) on every single create. Two creates can also pick the same code at the same instant — so you must put a unique constraint on the code, or the database will happily store both.',
            tradeoffs:
              'Codes are unguessable and it needs no shared counter. But you pay a read-before-write plus occasional retries, and you have to back it with a unique index so a race can never double-assign a code.',
            why:
              'Good when unguessable links matter and you write at a modest rate. Keep a unique constraint on the code so the database is the final guard against collisions.',
            affects: ['db'],
          },
          {
            id: 'hash',
            label: 'Hash the URL',
            summary: 'Hash the long URL (MD5/SHA) and take the first 7 base62 characters as the code.',
            whatBreaks:
              'Cutting a hash down to 7 characters means different URLs can produce the same code (a collision), so you are back to checking the database and disambiguating on a clash. The same URL always hashes to the same code — sometimes a feature (dedupe identical links), sometimes a surprise.',
            tradeoffs:
              'Deterministic and needs no counter. But truncation collisions force the same check-and-retry, so it is not actually simpler than the counter — just more moving parts.',
            why:
              'Handy when you want to reuse one code for the same URL. For fresh, guaranteed-unique codes, the counter + base62 approach is simpler and never collides.',
            affects: ['db'],
          },
        ],
      },
    },
    {
      id: 'cache',
      label: 'Cache (Redis)',
      category: 'cache',
      role: 'An in-memory copy of the hottest code→URL lookups. A viral link is served straight from here in well under a millisecond, so the database barely sees the click storm.',
      position: { x: 180, y: 430 },
      decision: {
        question: 'How do we keep redirects fast when a link goes viral?',
        options: [
          {
            id: 'cache-aside',
            label: 'Cache-aside (read on miss)',
            isDefault: true,
            summary:
              'Check the cache first. On a hit, redirect immediately. On a miss, read the database once and store the result so the next click is instant.',
            whatBreaks:
              'Nothing — the busiest links live in memory and the database only ever sees the first click for each. The one thing to handle: if a link is edited or deleted, the cached copy is briefly stale, which a short TTL or deleting the key on change fixes.',
            tradeoffs:
              'Redirects get very fast and the database is shielded from the read flood. The cost is one more system to run and a little staleness to manage.',
            why:
              'Clicks outnumber new links ~100 to 1 and links rarely change — a textbook fit for a read-through cache. This is the single biggest performance win in the whole design.',
            affects: ['db'],
          },
          {
            id: 'no-cache',
            label: 'No cache',
            summary: 'Read every redirect straight from the database.',
            whatBreaks:
              'Every click hits the database. One viral link sends a flood of identical reads at a single row, redirect latency climbs, and the thing users feel most gets slow at the worst moment.',
            tradeoffs:
              'One fewer system to run and never stale. But it throws away the easiest win in a read-heavy system and dumps all read load on the database.',
            why:
              'Fine at small scale, or with read replicas to spread the load. At real click volume, a cache stops being optional.',
            affects: ['db'],
          },
        ],
      },
    },
    {
      id: 'db',
      label: 'Database',
      category: 'datastore',
      role: 'The source of truth: the permanent code→URL mapping. Written once when a link is created, then read on every miss. A unique constraint on the code is the last line of defense against two links sharing one code.',
      position: { x: 420, y: 430 },
      decision: {
        question: 'What stores the short code → long URL mapping?',
        options: [
          {
            id: 'kv',
            label: 'Key-value store',
            isDefault: true,
            summary: 'A key→value store (DynamoDB / Cassandra-class): key = short code, value = the long URL.',
            whatBreaks:
              'Nothing — a shortener is a pure single-key lookup (code → URL) with no joins, which is exactly what a key-value store does fastest, and it scales by simply adding machines. You give up rich queries and joins, which this workload does not need anyway.',
            tradeoffs:
              'Huge read throughput and easy horizontal scaling. No joins or ad-hoc queries, so click analytics (top links, clicks over time) usually go to a separate system.',
            why:
              'The access pattern is one key lookup at massive scale — a key-value store\'s home turf. Keep a uniqueness guarantee on the code so a write can never double-assign it.',
            affects: [],
          },
          {
            id: 'sql',
            label: 'Relational (PostgreSQL)',
            summary: 'A table of (short_code as primary key, long_url, created_at).',
            whatBreaks:
              'Works perfectly until a single database can no longer keep up with the read and write volume; then you shard by short code and add read replicas — and lose the easy queries you chose SQL for.',
            tradeoffs:
              'Simple and transactional, and a unique index on the code makes collisions impossible out of the box. But one primary caps throughput, so scaling means sharding by hand.',
            why:
              'An honest default early on — the unique index guarantees no collisions, and joins let you do analytics in place. Many shorteners start here and move the hot mapping to a key-value store as they grow.',
            affects: [],
          },
        ],
      },
    },
  ],
  edges: [
    { id: 'e1', source: 'client', target: 'lb', label: 'shorten / click' },
    { id: 'e2', source: 'lb', target: 'service', label: 'route' },
    { id: 'e3', source: 'service', target: 'cache', label: '1. check cache' },
    { id: 'e4', source: 'service', target: 'db', label: '2. miss → read / write' },
  ],
}
