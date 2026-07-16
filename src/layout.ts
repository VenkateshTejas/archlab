import dagre from '@dagrejs/dagre'
import type { ArchNode, ArchEdge } from './types'

// Node box size used for layout spacing (must roughly match the rendered node).
const NODE_W = 172
const NODE_H = 84

/**
 * Auto-layout the graph left-to-right with dagre. Dagre assigns each node to a
 * "rank" by following edge direction and orders nodes within a rank to minimize
 * edge crossings — so the diagram stays clean and non-overlapping no matter how
 * many components a domain has. Returns a map of nodeId -> top-left position.
 */
export function layoutDomain(nodes: ArchNode[], edges: ArchEdge[]): Record<string, { x: number; y: number }> {
  const g = new dagre.graphlib.Graph()
  g.setGraph({
    rankdir: 'LR', // left-to-right request flow
    nodesep: 30, // vertical gap between nodes in the same rank
    ranksep: 95, // horizontal gap between ranks — room for edge labels
    marginx: 20,
    marginy: 20,
  })
  g.setDefaultEdgeLabel(() => ({}))

  for (const n of nodes) g.setNode(n.id, { width: NODE_W, height: NODE_H })
  for (const e of edges) g.setEdge(e.source, e.target)

  dagre.layout(g)

  const positions: Record<string, { x: number; y: number }> = {}
  for (const n of nodes) {
    const { x, y } = g.node(n.id)
    // dagre centers nodes; React Flow positions by top-left corner.
    positions[n.id] = { x: x - NODE_W / 2, y: y - NODE_H / 2 }
  }
  return positions
}
