import { useEffect, useState } from 'react'
import type { ArchNode } from '../types'

interface Props {
  node: ArchNode
  activeOptionId: string | undefined
  quizMode: boolean
  onSelectOption: (nodeId: string, optionId: string) => void
  onClose: () => void
}

// The decision deep-dive (interview steps 3–4). In quiz mode the consequence
// text is hidden until you commit a prediction — active recall.
export function InspectorPanel({
  node,
  activeOptionId,
  quizMode,
  onSelectOption,
  onClose,
}: Props) {
  const [revealed, setRevealed] = useState(false)

  // Reset the reveal whenever the node or the chosen option changes.
  useEffect(() => {
    setRevealed(false)
  }, [node.id, activeOptionId])

  const decision = node.decision
  const activeOption = decision?.options.find((o) => o.id === activeOptionId)
  const showConsequence = !quizMode || revealed

  return (
    <aside className="inspector">
      <button className="inspector__close" onClick={onClose} aria-label="Close">
        ×
      </button>
      <div className="inspector__role">
        <div className="inspector__nodename">{node.label.replace(/\s*\(.*\)$/, '')}</div>
      </div>

      <div className="istep">
        <div className="istep__label">① What this component does</div>
        <p className="istep__body">{node.role}</p>
      </div>

      {!decision && (
        <p className="inspector__hint">
          You can't change this one — its job is described above. The parts you <em>can</em> change
          are the boxes marked <span className="tag">⇆ swap</span>.
        </p>
      )}

      {decision && (
        <>
          <div className="istep">
            <div className="istep__label">② Pick an approach</div>
            <h3 className="inspector__question">{decision.question}</h3>
          </div>

          <div className="inspector__options">
            {decision.options.map((opt) => {
              const isActive = opt.id === activeOptionId
              return (
                <button
                  key={opt.id}
                  className={`opt ${isActive ? 'opt--active' : ''}`}
                  onClick={() => onSelectOption(node.id, opt.id)}
                >
                  <div className="opt__head">
                    <span className="opt__label">{opt.label}</span>
                    {opt.isDefault && <span className="opt__badge">recommended</span>}
                  </div>
                  <div className="opt__summary">{opt.summary}</div>
                </button>
              )
            })}
          </div>

          <div className="istep istep--tight">
            <div className="istep__label">③ What works &amp; what breaks</div>
          </div>

          {activeOption && quizMode && !revealed && (
            <div className="quiz-gate">
              <p className="quiz-gate__prompt">
                <strong>Predict first.</strong> With <em>{activeOption.label}</em> selected — what
                breaks downstream, what's the tradeoff, and why would anyone choose it? Decide, then
                check yourself.
              </p>
              <button className="quiz-gate__btn" onClick={() => setRevealed(true)}>
                Reveal answer
              </button>
            </div>
          )}

          {activeOption && showConsequence && (
            <div className="consequence">
              <Section title="What breaks / changes" tone="break" body={activeOption.whatBreaks} />
              <Section title="Tradeoffs" tone="trade" body={activeOption.tradeoffs} />
              <Section title="Why you'd choose this" tone="why" body={activeOption.why} />
              {activeOption.affects.length > 0 && (
                <p
                  className={`consequence__cascade ${
                    activeOption.isDefault ? '' : 'consequence__cascade--impact'
                  }`}
                >
                  {activeOption.isDefault
                    ? 'The highlighted boxes on the canvas are the parts this recommended option touches.'
                    : '⚠ The components pulsing red on the canvas are what this change impacts — that\'s the "what breaks" above, shown on the diagram.'}
                </p>
              )}
            </div>
          )}
        </>
      )}
    </aside>
  )
}

function Section({ title, body, tone }: { title: string; body: string; tone: string }) {
  return (
    <div className={`section section--${tone}`}>
      <div className="section__title">{title}</div>
      <p className="section__body">{body}</p>
    </div>
  )
}
