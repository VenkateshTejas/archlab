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
  tagline: 'Show millions of people their own feed — and make it load fast.',
  referenceNote:
    'Based on Instagram / Twitter timelines. People read the feed about 100 times for every 1 post they make, so the whole design is built to make reading fast.',
  requirements: {
    functional: [
      'Post photos and videos',
      'Follow and unfollow other users',
      'See a personal feed, newest posts first',
      'See any user\'s profile and posts',
    ],
    nonFunctional: [
      'Feed loads in under 200ms — reading the feed is the most common action',
      'It is fine if data takes a moment to catch up (a like count can lag a second)',
      'Better to always be up than to always be perfectly in sync',
      'Handle 100M+ users, including celebrities with huge followings',
    ],
  },
  scale: [
    { metric: 'Reads vs. writes', value: '~100 : 1', note: 'this shapes every decision' },
    { metric: 'Daily active users', value: '100M+' },
    { metric: 'Celebrity followers', value: 'up to ~100M', note: 'the "hot key" problem — one post reaches a huge crowd' },
    { metric: 'Target feed load time', value: '<200ms' },
  ],
  principle: {
    title: 'Make the thing you do most the fast thing',
    body:
      'People read the feed about 100 times for every 1 post. So you do the extra work when someone posts (this is called fan-out-on-write: copy the post into each follower\'s feed ahead of time), which makes the common action — opening the app — instant. The trick is spotting the case that breaks this plan: copying a celebrity\'s post to 100M followers would be far too much work, so you treat celebrities differently and pull their posts in when a feed is read instead (a mix, or "hybrid"). Build the system around what people do most, then handle the exceptions on purpose.',
  },
  nodes: [
    {
      id: 'client',
      label: 'Client',
      category: 'client',
      role: 'The web and mobile apps people use. Opens the app expecting an instant, personal feed, and uploads new photos and videos.',
      position: { x: 0, y: 320 },
    },
    {
      id: 'dns',
      label: 'DNS',
      category: 'edge',
      role: 'Turns the domain name into a server address, and can point you at the closest region for the lowest delay. It is just a lookup — traffic does not flow through it; the client then connects straight to the load balancer or CDN.',
      position: { x: 220, y: 160 },
    },
    {
      id: 'cdn',
      label: 'CDN',
      category: 'edge',
      role: 'A network of servers spread around the world (a CDN) that delivers photos and videos from a location near each user — this is most of the data sent. If a nearby server does not have the file yet, it fetches it from object storage (the original copy).',
      position: { x: 220, y: 480 },
      decision: {
        question: 'How do we deliver the photos and videos themselves?',
        options: [
          {
            id: 'cdn-s3',
            label: 'CDN + S3',
            isDefault: true,
            summary: 'Keep the files in object storage, and deliver them through the CDN\'s worldwide servers.',
            whatBreaks:
              'Nothing — this takes almost all the heavy data off your app servers. The app only ever returns a small bit of text with links to the files.',
            tradeoffs:
              'Files load fast everywhere and scale easily. You pay for storage and for data sent out, and you have to remember to clear old copies from the CDN when a file is edited or deleted.',
            why:
              'Photos and videos are large, do not change, and are viewed a lot — exactly what a CDN is for. Keeping this data off your app servers is the single biggest win for handling scale here.',
            affects: ['appSvc', 'objectStore'],
          },
          {
            id: 'serve-from-app',
            label: 'Serve from app servers',
            summary: 'The app reads the files itself and sends them straight to users.',
            whatBreaks:
              'The app servers run out of network capacity — a few viral videos use up all their bandwidth and CPU, leaving nothing for the real API work. And it is slow for users far away.',
            tradeoffs:
              'Simplest possible setup, one less system to run. But it stops working once you grow past a small user base, and it wastes pricey servers on just shipping files.',
            why:
              'Only OK for a tiny app. Shown here to make the value of a CDN obvious.',
            affects: ['appSvc'],
          },
        ],
      },
    },
    {
      id: 'lb',
      label: 'Load Balancer',
      category: 'edge',
      role: 'Spreads incoming requests evenly across the servers and checks that each one is healthy — the front door to the backend servers.',
      position: { x: 440, y: 320 },
    },
    {
      id: 'gateway',
      label: 'API Gateway',
      category: 'edge',
      role: 'The entry point for API calls. It handles encryption, checks who the user is, limits how often anyone can call, and sends each request to the right service (feed, upload, or search).',
      position: { x: 660, y: 180 },
    },
    {
      id: 'auth',
      label: 'Auth Service',
      category: 'compute',
      role: 'Confirms who is making each request, so the system knows whose feed to build and who to credit for posts, likes, and follows.',
      position: { x: 660, y: 460 },
    },
    {
      id: 'appSvc',
      label: 'Feed Service',
      category: 'compute',
      role: 'Builds and returns a user\'s feed when they open the app. It reads feeds that were prepared ahead of time from the cache, and falls back to the database if they are not there. This is where the choice of how to build the feed lives.',
      position: { x: 900, y: 200 },
      decision: {
        question: 'How do we build a user\'s feed? (The key decision.)',
        options: [
          {
            id: 'fanout-write',
            label: 'Fan-out on write',
            isDefault: true,
            summary: 'When someone posts, copy that post into every follower\'s ready-made feed right away.',
            whatBreaks:
              'Reading is very fast (you just read your ready-made list) — but a celebrity with 100M followers means up to 100M copies to write for a single post (in practice only to followers who are active, but still a huge number). This "hot key" is what makes pure fan-out-on-write blow up.',
            tradeoffs:
              'Does the work when someone posts so reading is cheap — perfect when reads far outnumber writes. But for accounts with tons of followers, the number of copies per post gets out of hand (write amplification).',
            why:
              'For the 99% of users with normal follower counts, preparing the feed ahead of time makes opening the app instant. It is the right default — you just need a special path for celebrities.',
            affects: ['cache', 'queue', 'db'],
          },
          {
            id: 'fanout-read',
            label: 'Fan-out on read',
            summary: 'When someone opens the app, gather recent posts from everyone they follow and combine them.',
            whatBreaks:
              'Opening the app now means one lookup for each account you follow, then sorting them all together — slow and costly, and this is your most common action. It gets especially slow for people who follow many accounts.',
            tradeoffs:
              'Posting is cheap (you just save the post once) with no copies to make. But it moves the cost onto reading, which you do far more often.',
            why:
              'Great specifically for celebrity posts — you do NOT copy those out ahead of time. The real answer is a mix (hybrid): fan-out-on-write for normal users, and fan-out-on-read for any celebrities they follow.',
            affects: ['cache', 'db'],
          },
          {
            id: 'hybrid',
            label: 'Hybrid',
            summary: 'Copy posts ahead of time for normal accounts; pull celebrity posts in at read time; combine the two.',
            whatBreaks:
              'Nothing about how it works — this is what big systems actually do. The cost is complexity: you keep two paths and set a follower-count cutoff based on the *poster* (a celebrity\'s posts skip the copy-ahead step and are instead pulled in when a feed is read, then combined into each viewer\'s feed).',
            tradeoffs:
              'Best of both: fast reads for most people, and no flood of copies for celebrities. You pay for it with more complex code and a follower cutoff you have to tune.',
            why:
              'The real-world answer. Knowing *why* neither pure approach works on its own — and that the celebrity hot key is what forces the mix — is exactly what interviewers are looking for.',
            affects: ['cache', 'queue', 'db'],
          },
        ],
      },
    },
    {
      id: 'uploadSvc',
      label: 'Post / Upload Service',
      category: 'compute',
      role: 'Handles new posts: saves the photo or video in object storage, saves the post details, and queues up the job to copy the post into followers\' feeds. This is the posting path, kept separate from the reading path.',
      position: { x: 900, y: 440 },
    },
    {
      id: 'search',
      label: 'Search Service',
      category: 'compute',
      role: 'Searches for users and hashtags using a search index (a lookup table from words to the posts that contain them). It is kept separate from the main database so that heavy searches do not slow down posting or feeds.',
      position: { x: 900, y: 620 },
    },
    {
      id: 'cache',
      label: 'Feed Cache (Redis)',
      category: 'cache',
      role: 'A cache: fast, temporary storage that keeps ready-made feeds and popular items in memory for very fast reads (under a millisecond on the server; a few milliseconds once you add network time). This is the layer that makes copying posts ahead of time worth it.',
      position: { x: 1140, y: 80 },
      decision: {
        question: 'What powers the fast read path?',
        options: [
          {
            id: 'redis',
            label: 'Redis',
            isDefault: true,
            summary: 'Keeps feeds in memory using built-in list and ranked-list types that fit feeds well.',
            whatBreaks:
              'Nothing — Redis\'s ranked lists (sorted sets) are ideal for feeds ordered by time. If something is not in the cache, you fetch it from the database and put it back in the cache.',
            tradeoffs:
              'Reads under a millisecond on the server (a few milliseconds with network time), built-in data types (a plain list you can add to the front and trim for a simple newest-first feed, or a ranked list when you want to order by a score or drop duplicates), and optional saving to disk. Costs memory and adds another system to run.',
            why:
              'Feeds are lists you trim and rank — Redis\'s built-in types fit that exactly, which Memcached cannot do.',
            affects: ['db'],
          },
          {
            id: 'memcached',
            label: 'Memcached',
            summary: 'A simple cache that stores a value under a key, and uses multiple threads.',
            whatBreaks:
              'You lose the built-in list and ranked-list types, so you have to store the whole feed as one lump and rewrite all of it on every change — wasteful when you just want to add one post.',
            tradeoffs:
              'Very simple and very fast for plain key-to-value lookups. But no rich data types and no saving to disk, so it fits feeds worse.',
            why:
              'Fine as a plain object cache (for example, cache a finished post by its id). But for the feed list itself, Redis\'s data types win.',
            affects: ['db'],
          },
          {
            id: 'no-cache',
            label: 'No cache',
            summary: 'Read every feed straight from the database each time.',
            whatBreaks:
              'With so many reads, the database gets hit directly and cannot keep up, so feeds get slow. And copying posts ahead of time is pointless if there is no cache to hold those ready-made feeds.',
            tradeoffs:
              'One fewer system to run. But it throws away the whole reason the design is built the way it is.',
            why:
              'Never do this at this scale. Included to show the cache is essential, not optional.',
            affects: ['db'],
          },
        ],
      },
    },
    {
      id: 'db',
      label: 'Posts DB (Cassandra)',
      category: 'datastore',
      role: 'The permanent store for posts, follows, and who-follows-whom (the social graph) — the trusted source of truth behind the cache.',
      position: { x: 1140, y: 300 },
      decision: {
        question: 'What stores the posts and the who-follows-whom data?',
        options: [
          {
            id: 'cassandra',
            label: 'Cassandra (wide-column)',
            isDefault: true,
            summary: 'A wide-column database: group each user\'s data together, keep adding new posts, and choose how strict the consistency is.',
            whatBreaks:
              'Mostly nothing — you can add more machines to handle more writes, and grouping data by user_id keeps a user\'s posts together in one group (a partition). The catch: a celebrity\'s posts all pile into one group that grows without limit and gets hammered (a "hot partition"), which is exactly what Cassandra handles poorly. So heavy posters need a key that splits the group up, like (user_id, month). You also give up joins and one-off ad-hoc queries.',
            tradeoffs:
              'Handles a huge number of writes, and you scale by simply adding more machines. But no joins, data is eventually consistent by default (it takes a moment to catch up), and you have to design your tables around your queries up front.',
            why:
              'Social feeds mostly add new posts, split neatly by user, and can tolerate data taking a moment to catch up (a like count can lag a second). That is exactly what Cassandra is good at.',
            affects: ['cache'],
          },
          {
            id: 'postgres',
            label: 'PostgreSQL',
            summary: 'A relational database: tables you can join together, with data that is always in sync.',
            whatBreaks:
              'One main database can only handle so many writes, and at social scale it maxes out. You are then forced to split the data across many machines (sharding) and add read-only copies — and at that point you lose the easy joins you picked it for.',
            tradeoffs:
              'Powerful queries, transactions, and always-in-sync data out of the box. But growing write capacity means splitting it across machines by hand, which is painful.',
            why:
              'Perfect early on and for the parts that need relationships (accounts, payments). Instagram famously grew on sharded PostgreSQL; many systems start here and later move the high-volume feed data out to a wide-column database.',
            affects: ['cache'],
          },
          {
            id: 'mysql-shard',
            label: 'Sharded MySQL',
            summary: 'Split the data by user id across many MySQL machines yourself.',
            whatBreaks:
              'Queries that span machines, and re-splitting the data as you grow, become a real headache. The who-follows-whom data (which links users to each other) is awkward to query when those users sit on different machines.',
            tradeoffs:
              'Proven at huge scale (early Facebook ran heavily split MySQL with a memcached cache in front). But the splitting logic, rebalancing, and cross-machine queries are all your job.',
            why:
              'A well-tested path when you have deep MySQL know-how. The reason newer designs reach for Cassandra is to get that scale-by-adding-machines without building the splitting yourself.',
            affects: ['cache'],
          },
        ],
      },
    },
    {
      id: 'queue',
      label: 'Fan-out Workers',
      category: 'queue',
      role: 'Background workers that copy each new post into followers\' ready-made feeds — this is the extra work (all those copies) that fan-out-on-write takes on.',
      position: { x: 1140, y: 520 },
    },
    {
      id: 'objectStore',
      label: 'Object Storage (S3)',
      category: 'datastore',
      role: 'The permanent home for the actual photos and videos. It holds the original copies that the CDN pulls from; the app only ever saves files here and hands back links to them.',
      position: { x: 1360, y: 460 },
    },
    {
      id: 'monitoring',
      label: 'Observability',
      category: 'compute',
      role: 'Collects measurements, logs, and request traces across all the services — how you spot a backlog of feed-copy work or a drop in how often the cache is hitting, before the feed starts feeling slow.',
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
