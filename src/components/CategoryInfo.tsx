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
    what: 'The user\'s device — the website or mobile app. It shows the screen and starts every request.',
    why: 'It runs on the user\'s phone or laptop, outside your control, so you can\'t trust it. Re-check everything it sends on the server, and never keep anything there you can\'t afford to lose.',
  },
  edge: {
    label: 'Edge',
    what: 'The layer that meets internet traffic before your real app logic runs: DNS, CDN, load balancers, API gateways, and a waiting room.',
    why: 'They point users to the right place, cache things, check who\'s allowed in, and smooth out traffic — so your app gets clean, steady load instead of the raw chaos of the internet.',
  },
  compute: {
    label: 'Service',
    what: 'The programs that do the actual work of a request — build a feed, place a booking, take an order, check a login. They keep no memory of their own between requests.',
    why: 'Because each copy remembers nothing on its own, any copy can handle any request. To handle more load you just run more identical copies. That is exactly what makes them easy to scale.',
  },
  cache: {
    label: 'Cache',
    what: 'A fast store that keeps data in memory (usually Redis), sitting in front of the slower database and holding the things people ask for most.',
    why: 'It answers hot requests in well under a millisecond and takes load off the database. Its data can always be rebuilt from the database, so losing it slows things down but doesn\'t lose anything for good.',
  },
  datastore: {
    label: 'Datastore',
    what: 'The permanent source of truth: SQL databases, big NoSQL stores, search indexes, read-only copies (replicas), and file/blob storage.',
    why: 'This data has to survive restarts and be the final word. The rules that guarantee correctness (like a unique index or an append-only ledger) live here, because this is the one layer nothing can sneak around.',
  },
  queue: {
    label: 'Async',
    what: 'Message queues and append-only event logs (like Kafka), plus the worker programs that read from them and do the work.',
    why: 'They take slow or bursty work off the main request so it can happen in the background and retry if it fails. The catch: the work finishes a bit later (not instantly), and a message can arrive more than once — so the worker must be safe to run twice on the same message (idempotent).',
  },
  external: {
    label: 'External',
    what: 'Services you rely on but don\'t run yourself — like a payment processor or an SMS / push provider.',
    why: 'They\'re out of your control: slow, sometimes flaky, and they charge per call. So you call them in a way that\'s safe to retry (idempotent), usually from a background queue, and never hold a database lock open while waiting for them.',
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
