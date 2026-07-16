import type { Domain, NodeCategory } from '../types'

interface CategoryMeta {
  label: string
  what: string
  why: string
}

// What each category means and why a component is grouped into it.
export const CATEGORY_META: Record<NodeCategory, CategoryMeta> = {
  client: {
    label: 'Client',
    what: 'The user\'s device — the web or mobile app that renders the UI and originates every request.',
    why: 'It sits outside your infrastructure, so you can never trust it for correctness or count on its state. Everything it sends must be validated server-side.',
  },
  edge: {
    label: 'Edge',
    what: 'Components at the network boundary, before your application logic: DNS, CDN, load balancers, API gateways, and admission control (e.g. a waiting room).',
    why: 'They route, cache, authenticate, and protect — shaping and absorbing traffic at the edge so your services receive clean, bounded load instead of raw internet chaos.',
  },
  compute: {
    label: 'Service',
    what: 'Stateless application logic that processes a request: feed service, booking service, order service, auth, risk checks.',
    why: 'These do the actual work and scale horizontally — you add more identical instances under load. They hold no durable state themselves, which is exactly what makes them easy to scale.',
  },
  cache: {
    label: 'Cache',
    what: 'A fast in-memory store (usually Redis) sitting on the hot path in front of the durable store.',
    why: 'It serves the most-read or most-contended data in sub-milliseconds, absorbing load that would otherwise crush the database. Its data is derivable, so losing it is a performance hit, not a correctness one.',
  },
  datastore: {
    label: 'Datastore',
    what: 'The durable source of truth: relational DBs, wide-column stores, search indexes, read replicas, and object storage.',
    why: 'Data here must survive restarts and be authoritative. The correctness-critical constraints (unique indexes, conditional writes, append-only ledgers) live at this layer because it physically cannot be bypassed.',
  },
  queue: {
    label: 'Async',
    what: 'Message queues and append-only event logs (e.g. Kafka) plus the workers that consume them.',
    why: 'They decouple slow, spiky, or failure-prone work from the request path so it can retry independently. The trade is eventual consistency — and consumers must be idempotent, because queues redeliver.',
  },
  external: {
    label: 'External',
    what: 'Third-party services you depend on but do not own — payment processors, push/SMS providers.',
    why: 'They are outside your control: slow, occasionally flaky, and metered. So you call them idempotently (safe to retry) and usually behind a queue, never holding a lock or transaction open across the call.',
  },
}

export function CategoryInfo({
  category,
  domain,
  onClose,
}: {
  category: NodeCategory
  domain: Domain
  onClose: () => void
}) {
  const meta = CATEGORY_META[category]
  const members = domain.nodes.filter((n) => n.category === category)

  return (
    <aside className="inspector">
      <button className="inspector__close" onClick={onClose} aria-label="Close">
        ×
      </button>
      <div className="inspector__role">
        <div className="cat-info__swatch-row">
          <span className={`legend__dot legend__dot--${category}`} />
          <div className="inspector__nodename">{meta.label}</div>
        </div>
      </div>

      <div className="istep">
        <div className="istep__label">What this category is</div>
        <p className="istep__body">{meta.what}</p>
      </div>

      <div className="section section--why">
        <div className="section__title">Why components are grouped here</div>
        <p className="section__body">{meta.why}</p>
      </div>

      <div className="istep" style={{ marginTop: 16 }}>
        <div className="istep__label">
          In this architecture · {members.length}
        </div>
        <div className="cat-info__members">
          {members.map((m) => (
            <span key={m.id} className="cat-info__chip">
              {m.label.replace(/\s*\(.*\)$/, '')}
            </span>
          ))}
        </div>
      </div>
    </aside>
  )
}
