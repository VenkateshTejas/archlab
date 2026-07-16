import type { Domain } from '../types'

// The default right-panel view: scopes the problem the way a real interview
// opens — requirements (step 1), estimation (step 2), and the transferable
// principle (step 5). The canvas itself is steps 3–4.
export function DomainBrief({ domain }: { domain: Domain }) {
  return (
    <aside className="inspector brief">
      <div className="brief__lead">
        <div className="brief__step">Step 1 · Scope the problem</div>
        <h2 className="brief__title">{domain.name}</h2>
        <p className="brief__tagline">{domain.tagline}</p>
      </div>

      <div className="brief__block">
        <h3 className="brief__h">Functional requirements</h3>
        <ul className="brief__list">
          {domain.requirements.functional.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      </div>

      <div className="brief__block">
        <h3 className="brief__h">Non-functional requirements</h3>
        <ul className="brief__list brief__list--nf">
          {domain.requirements.nonFunctional.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      </div>

      <div className="brief__block">
        <div className="brief__step">Step 2 · Back-of-the-envelope</div>
        <div className="scale">
          {domain.scale.map((s) => (
            <div key={s.metric} className="scale__row">
              <div className="scale__metric">{s.metric}</div>
              <div className="scale__value">
                {s.value}
                {s.note && <span className="scale__note"> — {s.note}</span>}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="brief__principle">
        <div className="brief__step brief__step--accent">Step 5 · The principle that transfers</div>
        <div className="principle__title">{domain.principle.title}</div>
        <p className="principle__body">{domain.principle.body}</p>
      </div>

      <p className="brief__cta">
        Now explore the design → click any <span className="tag">⇆ swap</span> node on the canvas to
        change a decision and see what breaks downstream.
      </p>
    </aside>
  )
}
