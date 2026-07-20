import type { Pattern } from '../types'
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

const AI_ACCENT = '#7cc4ff'

// The meta-lesson, made visual: the same handful of patterns run every system —
// classic AND top-of-the-line AI. A coverage map first, then each pattern in
// depth (classic instances you can click into, plus its AI form).
export function PatternsView({
  onJump,
}: {
  onJump: (domainId: string, nodeId: string) => void
}) {
  const timeless = patterns.filter((p) => !p.aiNative)
  const native = patterns.filter((p) => p.aiNative)
  // Only show domains that actually carry a pattern instance as matrix columns,
  // so a simple standalone domain (e.g. the URL shortener) doesn't add an empty column.
  const matrixDomains = domains.filter((d) =>
    patterns.some((p) => p.instances.some((i) => i.domainId === d.id)),
  )

  return (
    <div className="patterns">
      <div className="patterns__intro">
        <h1>The same few patterns run every system — including AI.</h1>
        <p>
          You don't memorize 50 systems — you learn a handful of patterns and spot them wearing
          different costumes. Each one below shows up in these four classic systems (tap any dot to
          jump to it in context) <em>and</em> in top-of-the-line AI systems — RAG, LLM serving,
          agents, recommenders. Learn it once here; recognize it in an LLM platform.
        </p>
      </div>

      {/* coverage matrix: timeless patterns × domains (+ an AI column) */}
      <div className="pmatrix">
        <div className="pmatrix__row pmatrix__row--head">
          <div className="pmatrix__pcell">Pattern</div>
          {matrixDomains.map((d) => (
            <div key={d.id} className="pmatrix__dhead" style={{ color: DOMAIN_META[d.id]?.accent }}>
              {DOMAIN_META[d.id]?.col ?? d.name}
            </div>
          ))}
          <div className="pmatrix__dhead" style={{ color: AI_ACCENT }}>
            AI
          </div>
        </div>
        {timeless.map((p) => {
          const byDomain = new Map(p.instances.map((i) => [i.domainId, i]))
          return (
            <div key={p.id} className="pmatrix__row">
              <div className="pmatrix__pcell">{p.name}</div>
              {matrixDomains.map((d) => {
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
              <button
                type="button"
                className="pmatrix__cell pmatrix__cell--ai"
                title={`${p.name} in AI systems`}
                onClick={() =>
                  document
                    .getElementById(`pattern-${p.id}`)
                    ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                }
              >
                {p.ai ? <span className="pmatrix__ai">✦</span> : null}
              </button>
            </div>
          )
        })}
      </div>

      <div className="patterns__grid">
        {timeless.map((p) => (
          <PatternCard key={p.id} p={p} onJump={onJump} />
        ))}
      </div>

      {native.length > 0 && (
        <>
          <div className="patterns__divider">
            <h2>What AI adds</h2>
            <p>
              Three patterns with no classic analog — the ideas that make a probabilistic model into
              a dependable system. This is where AI system design stops looking like everything else.
            </p>
          </div>
          <div className="patterns__grid">
            {native.map((p) => (
              <PatternCard key={p.id} p={p} onJump={onJump} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function PatternCard({
  p,
  onJump,
}: {
  p: Pattern
  onJump: (domainId: string, nodeId: string) => void
}) {
  return (
    <section id={`pattern-${p.id}`} className={`pattern ${p.aiNative ? 'pattern--ai' : ''}`}>
      <div className="pattern__head">
        <h2 className="pattern__name">{p.name}</h2>
        {p.aiNative ? (
          <span className="pattern__count pattern__count--ai">AI-native</span>
        ) : (
          <span className="pattern__count">{p.instances.length} systems</span>
        )}
      </div>
      {p.aka && <div className="pattern__aka">{p.aka}</div>}
      <p className="pattern__essence">{p.essence}</p>

      <div className="pattern__field">
        <span className="pattern__label">Problem</span>
        <p>{p.problem}</p>
      </div>
      <div className="pattern__field">
        <span className="pattern__label">Mechanism</span>
        <p>{p.mechanism}</p>
      </div>

      {p.instances.length > 0 && (
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
      )}

      {p.ai && (
        <div className="pattern__field pattern__field--ai">
          <span className="pattern__label pattern__label--ai">
            {p.aiNative ? 'In practice' : 'In AI systems'}
          </span>
          {p.ai.bridge && <p className="pattern__bridge">{p.ai.bridge}</p>}
          <div className="instances">
            {p.ai.instances.map((inst, i) => (
              <div key={i} className="instance instance--ai">
                <div className="instance__head">
                  <span className="instance__domain" style={{ color: AI_ACCENT }}>
                    {inst.system}
                  </span>
                </div>
                <div className="instance__how">{inst.how}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
