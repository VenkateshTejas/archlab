import { useState } from 'react'
import { componentDocs } from '../data/components'
import { CATEGORY_META } from './CategoryInfo'

// "Components 101" — a reference library. Left rail lists every building block;
// the right pane is that component's page (~100-word explainer + common types).
export function ComponentsView() {
  const [id, setId] = useState(componentDocs[0].id)
  const doc = componentDocs.find((c) => c.id === id) ?? componentDocs[0]

  return (
    <div className="components">
      <aside className="components__list">
        <div className="components__intro">
          <strong>Building blocks</strong>
          <span>Learn each piece before the full architectures.</span>
        </div>
        {componentDocs.map((c) => (
          <button
            key={c.id}
            className={`comp-item ${c.id === id ? 'comp-item--active' : ''}`}
            onClick={() => setId(c.id)}
          >
            <span className={`legend__dot legend__dot--${c.category}`} />
            {c.name}
          </button>
        ))}
      </aside>

      <section className="components__detail" key={doc.id}>
        <div className="comp-detail__cat">
          <span className={`legend__dot legend__dot--${doc.category}`} />
          {CATEGORY_META[doc.category].label}
        </div>
        <h1 className="comp-detail__name">{doc.name}</h1>
        <p className="comp-detail__one">{doc.oneLiner}</p>
        <p className="comp-detail__what">{doc.what}</p>

        <div className="comp-detail__typesh">Common types</div>
        <div className="comp-detail__types">
          {doc.types.map((t) => (
            <div key={t.name} className="comp-type">
              <div className="comp-type__name">{t.name}</div>
              <div className="comp-type__note">{t.note}</div>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
