import { patterns } from '../data/patterns'
import { domains } from '../data'

const DOMAIN_NAME: Record<string, string> = Object.fromEntries(
  domains.map((d) => [d.id, d.name]),
)

// The meta-lesson, made explicit: each pattern, then every place it recurs.
// Clicking an instance jumps to that exact node in its domain.
export function PatternsView({
  onJump,
}: {
  onJump: (domainId: string, nodeId: string) => void
}) {
  return (
    <div className="patterns">
      <div className="patterns__intro">
        <h1>System design is a small set of patterns, reskinned.</h1>
        <p>
          You don't memorize 50 systems — you learn ~10 patterns and recognize them wearing
          different costumes. Here are the ones that recur across all four domains. Click any
          instance to see it in context.
        </p>
      </div>

      <div className="patterns__grid">
        {patterns.map((p) => (
          <section key={p.id} className="pattern">
            <h2 className="pattern__name">{p.name}</h2>
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
              <span className="pattern__label">
                Where it appears · {p.instances.length} domains
              </span>
              <div className="instances">
                {p.instances.map((inst) => (
                  <button
                    key={`${inst.domainId}-${inst.nodeId}`}
                    className="instance"
                    onClick={() => onJump(inst.domainId, inst.nodeId)}
                  >
                    <div className="instance__head">
                      <span className="instance__domain">{DOMAIN_NAME[inst.domainId]}</span>
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
