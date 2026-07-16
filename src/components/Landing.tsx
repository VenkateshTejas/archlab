import { domains } from '../data'

// Accent color per domain (matches the node category palette loosely).
const DOMAIN_ACCENT: Record<string, string> = {
  ticketing: 'var(--c-edge)',
  social: 'var(--c-compute)',
  ecommerce: 'var(--c-datastore)',
  betting: 'var(--c-queue)',
}

interface Props {
  /** Enter the app; optionally jump straight into a specific domain. */
  onEnter: (domainId?: string) => void
  /** Open the cross-domain patterns view. */
  onPatterns: () => void
}

export function Landing({ onEnter, onPatterns }: Props) {
  return (
    <div className="landing">
      <div className="landing__inner">
        <header className="landing__hero">
          <div className="landing__badge">Interactive · curated · fact-checked</div>
          <h1 className="landing__title">ArchLab</h1>
          <p className="landing__headline">
            Learn system design by taking real architectures <em>apart</em>.
          </p>
          <p className="landing__sub">
            Open a best-in-class design, click any component to see the real decision behind it,
            then <strong>swap the technology and watch what breaks downstream</strong> — with the
            tradeoffs an interviewer actually probes for. Curated and hand-authored, not an LLM
            guessing.
          </p>
          <div className="landing__cta">
            <button className="landing__btn landing__btn--primary" onClick={() => onEnter()}>
              Start exploring →
            </button>
            <button className="landing__btn" onClick={onPatterns}>
              ⊞ See the patterns
            </button>
          </div>
        </header>

        <div className="landing__how">
          <div className="how-step">
            <span className="how-step__n">1</span>
            <div>
              <div className="how-step__t">Pick an architecture</div>
              <div className="how-step__d">A real, opinionated reference design — not a blank canvas.</div>
            </div>
          </div>
          <div className="how-step">
            <span className="how-step__n">2</span>
            <div>
              <div className="how-step__t">Swap a decision</div>
              <div className="how-step__d">Click a component and change its tech or strategy.</div>
            </div>
          </div>
          <div className="how-step">
            <span className="how-step__n">3</span>
            <div>
              <div className="how-step__t">See what breaks</div>
              <div className="how-step__d">Read the authored consequence and watch the downstream cascade.</div>
            </div>
          </div>
        </div>

        <div className="landing__pick">Pick an architecture to start</div>
        <div className="landing__domains">
          {domains.map((d) => (
            <button
              key={d.id}
              className="landing-card"
              style={{ borderTopColor: DOMAIN_ACCENT[d.id] ?? 'var(--accent)' }}
              onClick={() => onEnter(d.id)}
            >
              <div className="landing-card__name">{d.name}</div>
              <div className="landing-card__tag">{d.tagline}</div>
              <div className="landing-card__go">Explore →</div>
            </button>
          ))}
        </div>

        <div className="landing__features">
          <span>◆ Quiz mode — predict before you reveal</span>
          <span>◆ Requirements &amp; back-of-envelope estimation</span>
          <span>◆ Cross-domain patterns that transfer</span>
          <span>◆ $0 static app — no backend, no LLM calls</span>
        </div>
      </div>
    </div>
  )
}
