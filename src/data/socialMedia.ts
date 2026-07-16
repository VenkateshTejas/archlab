import type { Domain } from '../types'

// Reference design: Instagram-class photo feed. The defining tension is feed
// generation strategy (fan-out-on-write vs read) and how the celebrity
// "hot key" problem forces a hybrid.
//
// Complete architecture: most nodes are context (DNS, CDN, LB, gateway, auth,
// upload/search services, object store, observability); a few carry the swaps.
export const socialMedia: Domain = {
  id: 'social',
  name: 'Social Media Feed',
  tagline: 'Serve a personalized feed to millions — fast reads beat everything.',
  referenceNote:
    'Modeled on Instagram / Twitter timelines. Reads outnumber writes ~100:1, so the whole design optimizes the read path.',
  requirements: {
    functional: [
      'Post photos / videos',
      'Follow and unfollow other users',
      'View a personalized, time-ordered feed',
      'View any user\'s profile and posts',
    ],
    nonFunctional: [
      'Feed loads in <200ms — reads are the hot path',
      'Eventual consistency is acceptable (a like count can lag a second)',
      'High availability favored over strict consistency',
      'Scale to 100M+ users, including celebrity fan-out',
    ],
  },
  scale: [
    { metric: 'Read : write ratio', value: '~100 : 1', note: 'this shapes everything' },
    { metric: 'Daily active users', value: '100M+' },
    { metric: 'Celebrity followers', value: 'up to ~100M', note: 'the "hot key" problem' },
    { metric: 'Feed read latency target', value: '<200ms' },
  ],
  principle: {
    title: 'Optimize the path you take most',
    body:
      'Reads outnumber writes ~100:1, so you pay the cost at write time (fan-out-on-write) to make the common path — opening the app — instant. The art is spotting the outlier that breaks your model: a celebrity\'s 100M-follower fan-out would explode, so you special-case it with a read-time pull (hybrid). Shape the system around the dominant access pattern, then handle the exception explicitly.',
  },
  nodes: [
    {
      id: 'client',
      label: 'Client',
      category: 'client',
      role: 'Web & mobile apps. Opens the app and expects an instant, personalized feed; also uploads new photos/videos.',
      position: { x: 0, y: 320 },
    },
    {
      id: 'dns',
      label: 'DNS',
      category: 'edge',
      role: 'Resolves the domain to a regional endpoint (it can geo-steer via latency-based records). It is a lookup, not a traffic hop — the client then connects directly to the load balancer or CDN.',
      position: { x: 220, y: 160 },
    },
    {
      id: 'cdn',
      label: 'CDN',
      category: 'edge',
      role: 'Serves photos/videos from edge locations close to the user — the bulk of all bytes. Pulls from object storage (the origin) on a miss.',
      position: { x: 220, y: 480 },
      decision: {
        question: 'How do we serve media (the photos themselves)?',
        options: [
          {
            id: 'cdn-s3',
            label: 'CDN + S3',
            isDefault: true,
            summary: 'Store blobs in object storage; serve via a CDN edge cache.',
            whatBreaks:
              'Nothing — this offloads the vast majority of bytes from your app entirely. The app only ever returns small JSON with media URLs.',
            tradeoffs:
              'Edge caching means low latency globally and trivial scaling for media. You pay for storage + egress and must handle cache invalidation on edits/deletes.',
            why:
              'Media is large, static, and read-heavy — the textbook CDN case. Keeping bytes off your app servers is the single biggest scalability win here.',
            affects: ['appSvc', 'objectStore'],
          },
          {
            id: 'serve-from-app',
            label: 'Serve from app servers',
            summary: 'App reads blobs from disk/DB and streams them to clients.',
            whatBreaks:
              'Your app servers become bandwidth-bound — a few viral videos saturate their network and CPU, starving the actual API. Latency is terrible for distant users.',
            tradeoffs:
              'Simplest possible setup, one less system. But it does not scale past a small user base and wastes expensive compute on byte-pushing.',
            why:
              'Only acceptable at toy scale. Shown to make the CDN payoff obvious.',
            affects: ['appSvc'],
          },
        ],
      },
    },
    {
      id: 'lb',
      label: 'Load Balancer',
      category: 'edge',
      role: 'Spreads API traffic across gateway/app instances and health-checks them — the entry point to the backend fleet.',
      position: { x: 440, y: 320 },
    },
    {
      id: 'gateway',
      label: 'API Gateway',
      category: 'edge',
      role: 'Front door for API calls: TLS, authentication, rate limiting, and routing to the feed, upload, or search services.',
      position: { x: 660, y: 180 },
    },
    {
      id: 'auth',
      label: 'Auth Service',
      category: 'compute',
      role: 'Validates tokens so every request is tied to a user — needed to build *their* feed and to attribute posts, likes, and follows.',
      position: { x: 660, y: 460 },
    },
    {
      id: 'appSvc',
      label: 'Feed Service',
      category: 'compute',
      role: 'Assembles and returns a user\'s timeline on read — reading precomputed feeds from cache and falling back to the store. This is where the feed-generation strategy lives.',
      position: { x: 900, y: 200 },
      decision: {
        question: 'How do we build a user\'s feed? (The defining decision.)',
        options: [
          {
            id: 'fanout-write',
            label: 'Fan-out on write',
            isDefault: true,
            summary: 'On post, push the post id into every follower\'s feed cache.',
            whatBreaks:
              'Reads are trivially fast (just read your precomputed list) — but a celebrity with 100M followers triggers up to 100M feed-cache writes per post (in practice only to active followers, but still enormous). That "hot key" makes pure fan-out-on-write explode.',
            tradeoffs:
              'Moves work to write time so reads are cheap — perfect for a read-heavy system. But write amplification is brutal for high-follower accounts.',
            why:
              'For the 99% of users with normal follower counts, precomputing the feed makes opening the app instant. It is the right default — you just need a hybrid escape hatch for celebrities.',
            affects: ['cache', 'queue', 'db'],
          },
          {
            id: 'fanout-read',
            label: 'Fan-out on read',
            summary: 'On feed open, pull recent posts from everyone you follow and merge.',
            whatBreaks:
              'Opening the app now does N queries (one per followee) and a merge-sort — slow and expensive on the read path, which is your hottest path. Latency spikes for users following many accounts.',
            tradeoffs:
              'Writes are cheap (just store the post once); no write amplification. But it shifts cost to the read path, which you do far more often.',
            why:
              'Great specifically for celebrity posts — you do NOT pre-push those. The real answer is hybrid: fan-out-on-write for normal users, fan-out-on-read for the accounts they follow that are celebrities.',
            affects: ['cache', 'db'],
          },
          {
            id: 'hybrid',
            label: 'Hybrid',
            summary: 'Write-fan-out for normal accounts; read-pull for celebrities; merge.',
            whatBreaks:
              'Nothing functionally — this is what large systems actually do. The cost is complexity: you maintain two code paths and a follower-count threshold on the *author* (a celebrity\'s posts skip write-fan-out and are pulled at read time, then merged into each viewer\'s feed).',
            tradeoffs:
              'Best of both: fast reads for most, no write explosion for celebrities. You pay in implementation complexity and a tunable follower threshold.',
            why:
              'The production answer. Knowing *why* neither pure strategy works — and that the celebrity hot key forces the hybrid — is exactly the insight interviewers probe for.',
            affects: ['cache', 'queue', 'db'],
          },
        ],
      },
    },
    {
      id: 'uploadSvc',
      label: 'Post / Upload Service',
      category: 'compute',
      role: 'Handles new posts: stores the media blob in object storage, persists the post record, and enqueues the fan-out job. The write path, kept separate from the read path.',
      position: { x: 900, y: 440 },
    },
    {
      id: 'search',
      label: 'Search Service',
      category: 'compute',
      role: 'User / hashtag search via an inverted index, kept off the primary store so heavy search queries do not slow down posting or feeds.',
      position: { x: 900, y: 620 },
    },
    {
      id: 'cache',
      label: 'Feed Cache (Redis)',
      category: 'cache',
      role: 'Stores precomputed feeds and hot objects for very fast reads (sub-ms server-side; single-digit-ms over the network) — the layer that makes fan-out-on-write pay off.',
      position: { x: 1140, y: 80 },
      decision: {
        question: 'What backs the hot read path?',
        options: [
          {
            id: 'redis',
            label: 'Redis',
            isDefault: true,
            summary: 'In-memory lists/sorted-sets for feeds; rich data structures.',
            whatBreaks:
              'Nothing — Redis sorted sets are ideal for time-ordered feeds. On a cache miss you fall back to the DB and repopulate.',
            tradeoffs:
              'Sub-ms server-side reads (single-digit-ms over the network), native data structures (a list with LPUSH/LTRIM for a simple chronological feed window, or a sorted set when you need score-based ranking or dedup), optional persistence. Costs RAM and adds a system to operate.',
            why:
              'Feeds are lists with trimming and ranking — Redis data structures map onto that perfectly, which Memcached cannot do.',
            affects: ['db'],
          },
          {
            id: 'memcached',
            label: 'Memcached',
            summary: 'Simple key/value blob cache, multithreaded.',
            whatBreaks:
              'You lose native list/sorted-set ops, so you must serialize the whole feed blob and rewrite it on every change — wasteful for incremental feed updates.',
            tradeoffs:
              'Dead-simple and very fast for plain key→blob. But no rich structures and no persistence, so it is a worse fit for feed semantics.',
            why:
              'Fine as a pure object cache (cache a rendered post by id). For the feed list itself, Redis structures win.',
            affects: ['db'],
          },
          {
            id: 'no-cache',
            label: 'No cache',
            summary: 'Read feeds straight from the database every time.',
            whatBreaks:
              'Your read-heavy workload hammers the DB directly; it cannot keep up and read latency balloons. The entire fan-out-on-write strategy loses its point without a cache to hold the precomputed feeds.',
            tradeoffs:
              'One fewer system. But it throws away the whole reason the architecture is shaped the way it is.',
            why:
              'Never, at this scale. Included to show the cache is structural, not optional.',
            affects: ['db'],
          },
        ],
      },
    },
    {
      id: 'db',
      label: 'Posts DB (Cassandra)',
      category: 'datastore',
      role: 'Durable store of posts, follows, and the social graph — the source of truth behind the cache.',
      position: { x: 1140, y: 300 },
      decision: {
        question: 'What stores the posts and the social graph?',
        options: [
          {
            id: 'cassandra',
            label: 'Cassandra (wide-column)',
            isDefault: true,
            summary: 'Partition by user; append posts; tunable consistency.',
            whatBreaks:
              'Mostly nothing — writes scale horizontally and partitioning by user_id keeps a user\'s posts together. The catch: a celebrity\'s posts all land in one partition, creating a hot/unbounded partition (exactly what Cassandra handles poorly), so high-volume authors need a bucketed key like (user_id, month). You also give up joins and ad-hoc queries.',
            tradeoffs:
              'Massive write throughput and linear horizontal scaling. But no joins, eventual consistency by default, and you must design tables around your queries up front.',
            why:
              'Social feeds are append-heavy, partition cleanly by user, and tolerate eventual consistency (a like count can lag a second). That is Cassandra\'s sweet spot.',
            affects: ['cache'],
          },
          {
            id: 'postgres',
            label: 'PostgreSQL',
            summary: 'Relational; joins for graph queries; strong consistency.',
            whatBreaks:
              'A single primary becomes the write bottleneck at social scale; you are forced into sharding and read replicas, at which point you lose the easy joins you adopted it for.',
            tradeoffs:
              'Rich queries, transactions, and strong consistency out of the box. But horizontal write scaling is painful and manual.',
            why:
              'Perfect early on and for the relational parts (accounts, payments). Instagram famously scaled on sharded PostgreSQL; many systems start here and split the high-volume feed data out to a wide-column store later.',
            affects: ['cache'],
          },
          {
            id: 'mysql-shard',
            label: 'Sharded MySQL',
            summary: 'Manually shard by user id across many MySQL instances.',
            whatBreaks:
              'Cross-shard queries and resharding become operational pain; the social graph (which spans users) is awkward to query when users live on different shards.',
            tradeoffs:
              'Proven at huge scale (early Facebook ran heavily sharded MySQL behind a memcached tier). But sharding logic, rebalancing, and cross-shard joins are all on you.',
            why:
              'A battle-tested path when you have deep MySQL expertise. The reason newer designs reach for Cassandra is to get that horizontal scaling without hand-rolling sharding.',
            affects: ['cache'],
          },
        ],
      },
    },
    {
      id: 'queue',
      label: 'Fan-out Workers',
      category: 'queue',
      role: 'Async workers that push each new post into followers\' feed caches — the write-amplification step that fan-out-on-write trades into.',
      position: { x: 1140, y: 520 },
    },
    {
      id: 'objectStore',
      label: 'Object Storage (S3)',
      category: 'datastore',
      role: 'Durable blob store for the actual photos/videos. It is the CDN\'s origin; the app only ever stores and returns URLs to it.',
      position: { x: 1360, y: 460 },
    },
    {
      id: 'monitoring',
      label: 'Observability',
      category: 'compute',
      role: 'Metrics, logs, and traces across services — how you catch a fan-out backlog or a cache hit-rate drop before the feed gets slow.',
      position: { x: 1360, y: 120 },
    },
  ],
  edges: [
    { id: 'e1', source: 'client', target: 'dns', label: 'resolve', control: true },
    { id: 'e3', source: 'dns', target: 'lb', label: 'resolves to', control: true },
    { id: 'e2', source: 'client', target: 'cdn', label: 'load media' },
    { id: 'e2b', source: 'client', target: 'lb', label: 'API requests' },
    { id: 'e15', source: 'cdn', target: 'objectStore', label: 'origin fetch' },
    { id: 'e4', source: 'lb', target: 'gateway', label: 'route' },
    { id: 'e5', source: 'gateway', target: 'auth', label: 'verify token' },
    { id: 'e6', source: 'gateway', target: 'appSvc', label: 'get feed' },
    { id: 'e7', source: 'gateway', target: 'uploadSvc', label: 'new post' },
    { id: 'e8', source: 'gateway', target: 'search', label: 'search' },
    { id: 'e9', source: 'appSvc', target: 'cache', label: 'read feed' },
    { id: 'e10', source: 'appSvc', target: 'db', label: 'miss → fetch' },
    { id: 'e11', source: 'uploadSvc', target: 'objectStore', label: 'store media' },
    { id: 'e12', source: 'uploadSvc', target: 'db', label: 'persist post' },
    { id: 'e13', source: 'uploadSvc', target: 'queue', label: 'fan-out', async: true },
    { id: 'e14', source: 'queue', target: 'cache', label: 'push to feeds', async: true },
    { id: 'e16', source: 'search', target: 'db', label: 'index ingest', async: true },
    { id: 'e17', source: 'appSvc', target: 'monitoring', label: 'metrics', async: true },
  ],
}
