import { useState, type ReactNode } from 'react'

// A minimal accordion section used to tame dense panels — show a header, reveal
// the body on tap. Progressive disclosure so a screen isn't a wall of text at a
// glance, but every detail is one tap away.
export function Collapsible({
  title,
  children,
  defaultOpen = false,
  count,
  tone,
}: {
  title: string
  children: ReactNode
  defaultOpen?: boolean
  /** Optional little pill on the right (e.g. how many items are inside). */
  count?: number | string
  /** Colors the title + left rail (reuses category accents). */
  tone?: 'break' | 'trade' | 'why'
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className={`cx ${open ? 'cx--open' : ''} ${tone ? `cx--${tone}` : ''}`}>
      <button className="cx__head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="cx__title">{title}</span>
        {count != null && <span className="cx__count">{count}</span>}
        <span className="cx__chev" aria-hidden="true">
          ⌄
        </span>
      </button>
      {open && <div className="cx__body">{children}</div>}
    </div>
  )
}
