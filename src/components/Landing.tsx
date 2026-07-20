import { domains } from '../data'

// Accent color per domain — the card's top border AND its title use this, so
// each card reads as one color. Social uses teal (not blue) so it doesn't blend
// into the site's blue accent.
const DOMAIN_ACCENT: Record<string, string> = {
  url: '#ff7eb6', // pink — the simple, mobile-friendly showcase
  ticketing: '#e0a52a', // gold
  social: '#22c3d6', // teal
  ecommerce: '#3fb950', // green
  betting: '#b07cff', // purple
}

interface Props {
  /** Enter the app; optionally jump straight into a specific domain. */
  onEnter: (domainId?: string) => void
  /** Open the cross-domain patterns view. */
  onPatterns: () => void
  /** Open the components-101 reference library. */
  onComponents: () => void
}

export function Landing({ onEnter, onPatterns, onComponents }: Props) {
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
            Open a proven design, swap any piece, and watch what breaks — with the trade-offs
            interviewers actually ask about. Hand-written and fact-checked, not AI-guessed.
          </p>
          <div className="landing__cta">
            <button className="landing__btn landing__btn--components" onClick={onComponents}>
              Components
            </button>
            <button className="landing__btn landing__btn--arch" onClick={() => onEnter()}>
              Architectures
            </button>
            <button className="landing__btn landing__btn--patterns" onClick={onPatterns}>
              Patterns
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
          {domains.map((d) => {
            const accent = DOMAIN_ACCENT[d.id] ?? 'var(--accent)'
            return (
              <button
                key={d.id}
                className={`landing-card ${d.badge ? 'landing-card--spot' : ''}`}
                style={{ borderTopColor: accent }}
                onClick={() => onEnter(d.id)}
              >
                {d.badge && (
                  <div
                    className="landing-card__badge"
                    style={{ color: accent, borderColor: accent }}
                  >
                    <span className="landing-card__star">★</span> {d.badge}
                  </div>
                )}
                <div className="landing-card__name" style={{ color: accent }}>
                  {d.name}
                </div>
                <div className="landing-card__tag">{d.tagline}</div>
                <div className="landing-card__go" style={{ color: accent }}>
                  Explore →
                </div>
              </button>
            )
          })}
        </div>

        <div className="landing__features">
          <span>◆ Quiz mode</span>
          <span>◆ Requirements &amp; estimation</span>
          <span>◆ Cross-domain + AI patterns</span>
        </div>
      </div>
    </div>
  )
}
