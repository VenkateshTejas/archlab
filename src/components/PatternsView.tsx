import { patterns } from '../data/patterns'
import { domains } from '../data'

// Short label + accent per domain (accent matches the landing cards) so the
// same pattern shows visibly spanning several colored domains.
const DOMAIN_META: Record<string, { short: string; col: string; accent: string }> = {
  ticketing: { short: 'Ticketing', col: 'Ticketing', accent: '#e0a52a' },
  social: { short: 'Social', col: 'Social', accent: '#22c3d6' },
  ecommerce: { short: 'E-commerce', col: 'E-comm', accent: '#3fb950' },
  betting: { short: 'Betting', col: 'Betting', accent: '#b07cff' },
}

// The meta-lesson, made visual: a coverage map (which pattern appears in which
// system), then each pattern in depth. Clicking jumps to that exact node.
export function PatternsView({
  onJump,
}: {
  onJump: (domainId: string, nodeId: string) => void
}) {
  return (
    <div className="patterns">
      <div className="patterns__intro">
        <h1>The same few patterns, reused everywhere.</h1>
        <p>
          You don't memorize 50 systems — you learn a handful of patterns and spot them wearing
          different costumes. This map shows how just {patterns.length} ideas cover all four systems.
          Tap any dot to jump to it in context.
        </p>
      </div>

      {/* coverage matrix: patterns × domains */}
      <div className="pmatrix">
        <div className="pmatrix__row pmatrix__row--head">
          <div className="pmatrix__pcell">Pattern</div>
          {domains.map((d) => (
            <div key={d.id} className="pmatrix__dhead" style={{ color: DOMAIN_META[d.id]?.accent }}>
              {DOMAIN_META[d.id]?.col ?? d.name}
            </div>
          ))}
        </div>
        {patterns.map((p) => {
          const byDomain = new Map(p.instances.map((i) => [i.domainId, i]))
          return (
            <div key={p.id} className="pmatrix__row">
              <div className="pmatrix__pcell">{p.name}</div>
              {domains.map((d) => {
                const inst = byDomain.get(d.id)
                if (!inst) return <div key={d.id} className="pmatrix__cell pmatrix__cell--empty" />
                return (
                  <button
                    key={d.id}
                    className="pmatrix__cell"
                    onClick={() => onJump(inst.domainId, inst.nodeId)}
                    title={`${p.name} → ${DOMAIN_META[d.id]?.short}: ${inst.where}`}
                  >
                    <span
                      className="pmatrix__dot"
                      style={{ background: DOMAIN_META[d.id]?.accent }}
                    />
                  </button>
                )
              })}
            </div>
          )
        })}
      </div>

      <div className="patterns__grid">
        {patterns.map((p) => (
          <section key={p.id} className="pattern">
            <div className="pattern__head">
              <h2 className="pattern__name">{p.name}</h2>
              <span className="pattern__count">{p.instances.length} systems</span>
            </div>
            <p className="pattern__essence">{p.essence}</p>

            <div className="pattern__field">
              <span className="pattern__label">Problem</span>
              <p>{p.problem}</p>
            </div>
            <div className="pattern__field">
              <span className="pattern__label">Mechanism</span>
              <p>{p.mechanism}</p>
            </div>

            <div className="pattern__field">
              <span className="pattern__label">Where it shows up</span>
              <div className="instances">
                {p.instances.map((inst) => (
                  <button
                    key={`${inst.domainId}-${inst.nodeId}`}
                    className="instance"
                    onClick={() => onJump(inst.domainId, inst.nodeId)}
                  >
                    <div className="instance__head">
                      <span
                        className="instance__domain"
                        style={{ color: DOMAIN_META[inst.domainId]?.accent }}
                      >
                        {DOMAIN_META[inst.domainId]?.short ?? inst.domainId}
                      </span>
                      <span className="instance__where">{inst.where}</span>
                      <span className="instance__go">→</span>
                    </div>
                    <div className="instance__how">{inst.how}</div>
                  </button>
                ))}
              </div>
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
