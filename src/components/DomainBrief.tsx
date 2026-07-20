import type { Domain } from '../types'
import { Collapsible } from './Collapsible'

// The default right-panel view: scopes the problem the way a real interview
// opens — requirements (step 1), estimation (step 2), and the transferable
// principle (step 5). The wordy lists collapse so the panel reads at a glance;
// the payoff (the big lesson) stays open. The canvas itself is steps 3–4.
export function DomainBrief({ domain }: { domain: Domain }) {
  const reqCount = domain.requirements.functional.length + domain.requirements.nonFunctional.length

  return (
    <aside className="inspector brief">
      <div className="brief__lead">
        <div className="brief__step">What are we building?</div>
        <h2 className="brief__title">{domain.name}</h2>
        <p className="brief__tagline">{domain.tagline}</p>
        <p className="brief__ref">{domain.referenceNote}</p>
      </div>

      <Collapsible title="Requirements" count={reqCount}>
        <div className="brief__sub">Must do</div>
        <ul className="brief__list">
          {domain.requirements.functional.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
        <div className="brief__sub brief__sub--nf">How well</div>
        <ul className="brief__list brief__list--nf">
          {domain.requirements.nonFunctional.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      </Collapsible>

      <Collapsible title="Numbers to design for" count={domain.scale.length}>
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
      </Collapsible>

      <div className="brief__principle">
        <div className="brief__step brief__step--accent">The big lesson to carry over</div>
        <div className="principle__title">{domain.principle.title}</div>
        <p className="principle__body">{domain.principle.body}</p>
      </div>

      <p className="brief__cta">
        Tap any <span className="tag">⇆ swap</span> node on the canvas to change a decision and see
        what breaks.
      </p>
    </aside>
  )
}
