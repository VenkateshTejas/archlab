import { Handle, Position } from '@xyflow/react'
import type { NodeCategory } from '../types'

export interface ComponentNodeData {
  baseLabel: string
  category: NodeCategory
  /** Active option label (the current tech/strategy), if this node has a decision. */
  activeLabel?: string
  hasDecision: boolean
  isHighlighted: boolean
  isImpacted?: boolean
  isChanged?: boolean
  isCategoryMatch?: boolean
  isDimmed?: boolean
  [key: string]: unknown
}

const CATEGORY_LABEL: Record<NodeCategory, string> = {
  client: 'Client',
  edge: 'Edge',
  compute: 'Service',
  cache: 'Cache',
  datastore: 'Datastore',
  queue: 'Async',
  external: 'External',
}

// Custom React Flow node. Title = component name; chip = the currently-selected
// swap option (so a swap is visible at a glance); "swap" badge if clickable.
export function ComponentNode({
  data,
  selected,
}: {
  data: ComponentNodeData
  selected: boolean
}) {
  const title = data.hasDecision
    ? data.baseLabel.replace(/\s*\(.*\)$/, '') // strip default-tech parenthetical
    : data.baseLabel

  const classes = [
    'node',
    `node--${data.category}`,
    selected ? 'node--selected' : '',
    data.isImpacted ? 'node--impacted' : data.isHighlighted ? 'node--highlighted' : '',
    data.isCategoryMatch ? 'node--cat-match' : '',
    data.isDimmed ? 'node--dimmed' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={classes}>
      <Handle type="target" position={Position.Left} />
      {data.isImpacted && <div className="node__flag node__flag--impact">⚠ impacted</div>}
      {data.isChanged && !data.isImpacted && (
        <div className="node__flag node__flag--changed">● changed</div>
      )}
      <div className="node__category">{CATEGORY_LABEL[data.category]}</div>
      <div className="node__title">{title}</div>
      {data.hasDecision && <div className="node__chip">{data.activeLabel}</div>}
      {data.hasDecision && <div className="node__swap">⇆ swap</div>}
      <Handle type="source" position={Position.Right} />
    </div>
  )
}
