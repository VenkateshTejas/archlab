import type { Pattern } from '../types'

// The payoff of the whole tool: a small set of patterns runs every system you
// will ever design — including top-of-the-line AI systems. Learn the pattern
// once in a ticketing app, then recognise it wearing an LLM costume.
//
// Two groups:
//   • TIMELESS patterns — each has clickable instances in the four classic
//     domains PLUS an "In AI systems" bridge showing the same idea in RAG / LLM
//     serving / agents / recommenders.
//   • AI-NATIVE patterns — new ideas AI adds that have no classic analog, taught
//     fresh (retrieval grounding, guardrails/evals, context management).
//
// Every claim here is checked against primary sources (Azure Architecture
// Center, Martin Fowler, Chris Richardson, Postgres/Stripe/vLLM docs). Canonical
// industry names are surfaced in `aka` so the framing is defensible, not folksy.
export const patterns: Pattern[] = [
  {
    id: 'source-of-truth',
    name: 'Correctness at the source of truth',
    aka: 'Atomic conditional write · uniqueness constraint',
    essence: 'Enforce the real rule in one place that nothing can go around.',
    problem:
      'Checks in your app code, and locks spread across servers, can hit race conditions or simply fail. You need one rule that always holds, even when the code above it has a bug.',
    mechanism:
      'Put the rule where it cannot be skipped — a database constraint or a single atomic write with a built-in condition. That makes the bad outcome impossible, not just unlikely. Everything above it (caches, holds, app checks) is only there for speed and a nicer experience.',
    instances: [
      {
        domainId: 'ticketing',
        nodeId: 'db',
        where: 'Primary DB',
        how: 'A partial unique index (CREATE UNIQUE INDEX … WHERE status=\'booked\') rejects a second "booked" row for the same slot, so the seat can only be taken once.',
      },
      {
        domainId: 'ecommerce',
        nodeId: 'inventory',
        where: 'Inventory DB',
        how: 'One atomic decrement that only runs if stock stays >= 0 (UPDATE … SET stock = stock - n WHERE stock >= n), so you can never sell more than you have.',
      },
    ],
    ai: {
      bridge:
        'An LLM makes up plausible answers. You get correctness the same way you do in a database — pin the model to a source of truth it can\'t route around, then check the result.',
      instances: [
        {
          system: 'RAG',
          how: 'The model may only answer from retrieved documents and must cite them, so an invented fact has no source to point to. The retrieved text is the source of truth (see the RAG pattern below).',
        },
        {
          system: 'Guardrails / evals',
          how: 'A separate checking layer validates the output — schema, policy, or groundedness against the retrieved passage — and rejects what slips through. The rule enforced after generation, where the model can\'t skip it.',
        },
      ],
    },
  },
  {
    id: 'idempotency',
    name: 'Idempotency — safe retries',
    aka: 'Idempotency key · exactly-once effect',
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
        how: 'The client sends an idempotency key with the charge; if it retries, the saved original result comes back instead of a second charge. (Stripe works exactly this way — same key replays the first response, even an error.)',
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
    ai: {
      bridge:
        'LLM API calls and agent tool calls time out and get retried, exactly like payments. Same fix: a key that turns the repeat into a no-op.',
      instances: [
        {
          system: 'Agents',
          how: 'A tool with a side effect (charge, send, book) takes an explicit idempotency key, so an agent that retries the step — or loops — doesn\'t do it twice.',
        },
        {
          system: 'LLM serving',
          how: 'A request id lets a client safely retry a timed-out generation without being billed for, or applying, the same work twice.',
        },
      ],
    },
  },
  {
    id: 'reserve-then-confirm',
    name: 'Reserve, then confirm (hold with TTL)',
    aka: 'Reservation · lease · hold with auto-expiry',
    essence:
      'Claim a limited item for a short time, and release it automatically if it isn\'t confirmed in time.',
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
      {
        domainId: 'betting',
        nodeId: 'riskSvc',
        where: 'Risk / Limits Service',
        how: 'Before a bet reaches the engine, the risk service places a HOLD on the stake — setting that money aside atomically — so many bets at once can\'t each see the same balance and collectively overspend it.',
      },
    ],
    ai: {
      bridge:
        'A scarce resource gets claimed for the duration of the work, then released automatically — GPUs and their memory are managed the same way.',
      instances: [
        {
          system: 'LLM serving',
          how: 'A running generation holds a slot in the batch and its KV-cache blocks — its "seat" on the GPU — until it finishes or is evicted; then they\'re freed for the next request.',
        },
      ],
    },
  },
  {
    id: 'cache-aside',
    name: 'Cache-aside (read on miss)',
    aka: 'Cache-Aside · lazy loading · read-through',
    essence:
      'Keep a copy of what\'s read most near the reader; on a miss, fetch from the origin and cache it.',
    problem:
      'Your busiest requests — the same popular things read over and over — would overload the origin and be slow to travel back to the user every time.',
    mechanism:
      'Check a fast copy first. On a hit, return it. On a miss, read from the source of truth, store a copy for next time (with a TTL so it can\'t go stale forever), then return it. The cache holds only what\'s actually being read — it fills itself lazily.',
    instances: [
      {
        domainId: 'social',
        nodeId: 'cdn',
        where: 'CDN',
        how: 'Photos and videos are served from a server near the user; if that edge doesn\'t have the file yet, it fetches once from object storage and keeps the copy.',
      },
      {
        domainId: 'ecommerce',
        nodeId: 'cdn',
        where: 'CDN',
        how: 'Product images are cached at the edge; a miss pulls once from object storage. This is the pattern that takes most browsing traffic off your own servers.',
      },
      {
        domainId: 'ticketing',
        nodeId: 'cdn',
        where: 'CDN',
        how: 'Event images and ticket PDFs are cached near the user and fetched from object storage only on a miss.',
      },
    ],
    ai: {
      bridge:
        'Repeated requests shouldn\'t re-do expensive work. AI systems cache at two levels — by meaning, and by prompt prefix.',
      instances: [
        {
          system: 'RAG / gateway',
          how: 'Semantic cache: if a new question is close enough to one already answered (embedding similarity above a threshold, often ~0.9+), return the stored answer instead of calling the model again.',
        },
        {
          system: 'LLM serving',
          how: 'Prompt / KV caching: the model reuses the already-computed attention state for a shared prompt prefix, so a long system prompt isn\'t recomputed on every call.',
        },
      ],
    },
  },
  {
    id: 'derived-read-model',
    name: 'Separate reads from writes (derived read models)',
    aka: 'CQRS · Materialized View · read replica',
    essence:
      'Keep a read-optimized copy, shaped for how you query, rebuilt from the write-side source of truth.',
    problem:
      'The shape that\'s safe and correct to write to is rarely the shape that\'s fast to read from. Serving heavy reads off the write database — or joining and sorting on every request — is slow and fights with the writes.',
    mechanism:
      'Let one store own the truth (the write side). Derive a second, read-only copy from it — a replica, a search index, a precomputed list — kept in sync as writes happen. The read copy is disposable: you can always rebuild it from the source. This is CQRS; the read copy is a materialized view.',
    instances: [
      {
        domainId: 'social',
        nodeId: 'cache',
        where: 'Feed Cache (Redis)',
        how: 'Fan-out-on-write precomputes each user\'s feed into a sorted set — a materialized view of the timeline — so opening the app is one fast read instead of a big query.',
      },
      {
        domainId: 'ticketing',
        nodeId: 'replica',
        where: 'Read Replica',
        how: 'Browse and search reads run off a replica that lags slightly behind, so heavy reading never competes with the booking writes on the primary.',
      },
      {
        domainId: 'ecommerce',
        nodeId: 'catalog',
        where: 'Catalog Search',
        how: 'A search index (Elasticsearch) is a read-optimized copy of the product data, kept in sync from the main catalog — the source of truth stays in the database.',
      },
      {
        domainId: 'betting',
        nodeId: 'cache',
        where: 'Odds Cache (Redis)',
        how: 'The current odds are a materialized view derived from the matching engine, kept hot in memory and pushed out — never the system of record, always rebuildable.',
      },
    ],
    ai: {
      bridge:
        'The write side owns the truth; the read side is a rebuilt-for-fast-reads copy. A vector index is exactly that.',
      instances: [
        {
          system: 'RAG',
          how: 'The vector index of embeddings is a derived read model of your documents — you can delete and rebuild it from the source corpus at any time; it is never the system of record.',
        },
        {
          system: 'Recsys',
          how: 'A feature store\'s online (serving) store is a fast copy of features computed from the offline source, kept in sync by one shared pipeline so training and serving see the same values.',
        },
      ],
    },
  },
  {
    id: 'async-decoupling',
    name: 'Async decoupling via queue / log',
    aka: 'Queue-Based Load Leveling · Event Sourcing · Saga',
    essence: 'Move slow or bursty work out of the request so it can run and retry on its own.',
    problem:
      'Some work (payment, emails, fan-out, settlement) is slow, comes in bursts, or fails often. Doing it inside the request ties your speed and uptime to it.',
    mechanism:
      'Hand the work to a durable queue or append-only log, and let background workers do it later, with retries and a dead-letter path for messages that keep failing. Pair it with idempotent workers, since the queue may deliver a message more than once. When steps span services and can fail, chain them as a saga — each step has an undo (a compensating transaction) so a late failure rolls the earlier steps back.',
    instances: [
      {
        domainId: 'ticketing',
        nodeId: 'queue',
        where: 'Confirmation Queue',
        how: 'The hold already guarantees the slot, so confirmation (writing the row, making the PDF, emailing) runs in the background and the request stays fast.',
      },
      {
        domainId: 'social',
        nodeId: 'queue',
        where: 'Fan-out Workers',
        how: 'Background workers copy a new post into each follower\'s feed, so that heavy work doesn\'t slow down the post request.',
      },
      {
        domainId: 'ecommerce',
        nodeId: 'queue',
        where: 'Order Workers',
        how: 'After checkout the steps (payment, fulfillment, email) run as a saga — each able to retry, or undo (compensate) if a later step fails.',
      },
      {
        domainId: 'betting',
        nodeId: 'eventLog',
        where: 'Event Log (Kafka)',
        how: 'Every bet is appended to an ordered, immutable log (event sourcing); settlement reads from that log later, downstream.',
      },
    ],
    ai: {
      bridge:
        'Slow, bursty, or batchable work goes on a queue and runs on its own — the same reason inference and indexing are queued.',
      instances: [
        {
          system: 'LLM serving',
          how: 'Requests wait in a queue and the scheduler pulls from it to form rolling batches (continuous batching), so slow, variable-length generations don\'t block each other.',
        },
        {
          system: 'RAG',
          how: 'Building the index — chunk, embed, upsert — runs as a background pipeline off the request path, and re-runs when documents change.',
        },
      ],
    },
  },
  {
    id: 'serialize-contention',
    name: 'Serialize the contention (single writer)',
    aka: 'Single-writer · LMAX Disruptor · batching',
    essence:
      'When many callers fight over one scarce spot, stop locking — funnel them through one ordered path instead.',
    problem:
      'At a spike, both kinds of locking fall apart: pessimistic locks force everyone into a single-file line and block; optimistic locks make almost everyone retry (a retry storm). The contention itself is the problem.',
    mechanism:
      'Send everything that contends for one thing through a single worker that handles items one after another, in a fixed order, in memory — no locks to fight over. Persist each item to a durable log first so nothing is lost. This is the LMAX Disruptor idea, and it turns lock contention into fast, ordered throughput.',
    instances: [
      {
        domainId: 'betting',
        nodeId: 'matchingEngine',
        where: 'Bet Matching Engine',
        how: 'One in-memory worker per market matches bets one at a time (journaling each to the event log before acking), so a flood of bets at a goal never fight over a lock — the LMAX approach real exchanges use.',
      },
    ],
    ai: {
      bridge:
        'When many callers fight for one scarce resource, funnel them through one ordered path. On a GPU that ordered path is the batch.',
      instances: [
        {
          system: 'LLM serving',
          how: 'One scheduler owns the accelerator and feeds it an ordered stream of batched tokens (continuous batching) instead of many threads contending for the GPU — the modern single-writer.',
        },
      ],
    },
  },
  {
    id: 'admission-control',
    name: 'Admission control — meter the flood',
    aka: 'Rate limiting · Throttling · load shedding · back-pressure',
    essence:
      'You can\'t serve infinite load, so decide at the door who gets in and how fast — protect the core.',
    problem:
      'A sudden flood (a flash sale, a goal, a viral moment) can overwhelm the backend so it fails for everyone — exactly when it matters most.',
    mechanism:
      'Cap and shape the incoming rate before it reaches the expensive core. A rate limiter rejects or delays excess; a waiting room admits a steady trickle and holds the rest fairly; under real overload you shed load (fail fast with a 429) rather than degrade everyone. This is back-pressure: the system pushing back on its callers.',
    instances: [
      {
        domainId: 'ticketing',
        nodeId: 'waitingRoom',
        where: 'Virtual Waiting Room',
        how: 'For a flash sale, users are lined up at the edge and admitted a few at a time, so the booking service gets a steady, survivable rate instead of a flood.',
      },
      {
        domainId: 'betting',
        nodeId: 'gateway',
        where: 'Bet API Gateway',
        how: 'The gateway caps how many requests each user can send before a bet reaches the risk checks and engine — a rate limit protecting the hot path.',
      },
      {
        domainId: 'ecommerce',
        nodeId: 'gateway',
        where: 'API Gateway',
        how: 'Per-client rate limits at the front door keep one abusive or runaway caller from starving everyone else.',
      },
    ],
    ai: {
      bridge:
        'You can\'t serve infinite load, so you meter it at the door — for LLMs the meter is tokens, because tokens are GPU time.',
      instances: [
        {
          system: 'LLM serving',
          how: 'Token-bucket quotas cap tokens-per-minute (TPM) and requests-per-minute (RPM) per client; TPM is the main lever because tokens map directly to GPU compute and cost.',
        },
        {
          system: 'LLM serving',
          how: 'When accelerators saturate, extra requests are queued or shed (429) instead of degrading everyone — back-pressure applied to the caller.',
        },
      ],
    },
  },

  // ── AI-NATIVE PATTERNS ─────────────────────────────────────────────────────
  // No clean classic analog. These are what AI adds on top of the timeless set,
  // and they are what "top-of-the-line AI system design" actually turns on.
  {
    id: 'rag',
    name: 'Retrieval-augmented generation (RAG)',
    aka: 'Grounding · retrieval-augmented generation',
    aiNative: true,
    essence:
      'Don\'t make the model remember facts — fetch them at query time and make it answer from them.',
    problem:
      'An LLM only knows what it was trained on: it\'s stale, can\'t see your private data, and confidently makes things up (hallucinates). Prompting harder doesn\'t fix a missing fact.',
    mechanism:
      'Split documents into chunks, turn each into an embedding (a vector), and store them in a vector index. At query time, embed the question and pull the nearest chunks with approximate-nearest-neighbour search (HNSW / IVF) — often combining keyword search (BM25) and vector search, then re-ranking the top hits with a cross-encoder. Put those chunks in the prompt and require citations. This is the AI-native form of "correctness at the source of truth," built on a "derived read model" (the vector index).',
    instances: [],
    ai: {
      instances: [
        {
          system: 'Where you\'ve seen it',
          how: 'AI search and support assistants, "chat with your docs," and answer engines that cite their sources (Perplexity-style).',
        },
        {
          system: 'Reuses',
          how: 'Grounding = pattern #1 (source of truth); the vector index = pattern #5 (derived read model); indexing = pattern #6 (async pipeline). RAG is these three, composed.',
        },
      ],
    },
  },
  {
    id: 'guardrails-evals',
    name: 'Guardrails & evaluation',
    aka: 'Guardrails · evals · LLM-as-judge',
    aiNative: true,
    essence:
      'A probabilistic system needs a checking layer around it — filter the input, check the output, and score quality continuously.',
    problem:
      'The model is non-deterministic and can produce unsafe, off-policy, or wrong output. You can\'t unit-test your way to confidence the way you can with deterministic code — the same input can give a different answer.',
    mechanism:
      'Put guardrails on the way in (block prompt-injection, strip PII, refuse disallowed requests) and on the way out (schema/format checks, safety classifiers, a groundedness check against the retrieved source). Measure quality with evals: an offline test set scored before you ship, plus sampling live traffic in production. A common scorer is "LLM-as-judge" — another model grades the answer against a rubric, calibrated against human labels (boolean/pass-fail verdicts hold up better than 1–10 scores).',
    instances: [],
    ai: {
      instances: [
        {
          system: 'Where you\'ve seen it',
          how: 'Provider moderation endpoints, guardrail libraries (NeMo Guardrails, Guardrails AI), and eval/observability platforms (Ragas, Arize, LangSmith).',
        },
        {
          system: 'Why it\'s AI-native',
          how: 'Deterministic code is verified once by tests; a probabilistic system has to be guarded and evaluated continuously, in production, because its behaviour drifts.',
        },
      ],
    },
  },
  {
    id: 'context-management',
    name: 'Context & memory management',
    aka: 'Context window · working vs long-term memory',
    aiNative: true,
    essence:
      'The context window is small and expensive — decide what to put in it on every single call.',
    problem:
      'A model can only "see" a fixed number of tokens. Stuffing more in costs money, adds latency, and can bury the relevant part ("lost in the middle"). Long conversations and agent runs quickly exceed the window.',
    mechanism:
      'Curate the context each turn: keep recent turns verbatim, replace older history with a running summary, store durable facts in a long-term memory (often a vector store) and retrieve only what\'s relevant, and pass large artifacts by reference instead of inline. This "working memory vs long-term memory" split is how an agent stays coherent across a long, multi-step task.',
    instances: [],
    ai: {
      instances: [
        {
          system: 'Where you\'ve seen it',
          how: 'Agent memory in frameworks (LangGraph, MemGPT/Letta-style summarize-and-retrieve), and conversation summarization buffers.',
        },
        {
          system: 'Why it\'s AI-native',
          how: 'Classic systems have effectively unbounded, cheap storage to read from; an LLM has a hard, costly limit on what it can attend to at once — so what to include becomes a live design decision.',
        },
      ],
    },
  },
]
