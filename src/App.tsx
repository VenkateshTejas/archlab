import { useEffect, useMemo, useState } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  MarkerType,
  useNodesInitialized,
  useReactFlow,
  type Node,
  type Edge,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

import { domains } from './data'
import type { Choices, Domain, NodeCategory } from './types'
import { ComponentNode, type ComponentNodeData } from './components/ComponentNode'
import { InspectorPanel } from './components/InspectorPanel'
import { DomainBrief } from './components/DomainBrief'
import { PatternsView } from './components/PatternsView'
import { ComponentsView } from './components/ComponentsView'
import { CategoryInfo, CATEGORY_META } from './components/CategoryInfo'
import { Landing } from './components/Landing'
import { layoutDomain } from './layout'

const nodeTypes = { component: ComponentNode }
const defaultEdgeOptions = { type: 'smoothstep' as const }

/** Default selection for every decision node in a domain (the reference choice). */
function defaultChoices(domain: Domain): Choices {
  const c: Choices = {}
  for (const n of domain.nodes) {
    if (n.decision) {
      const def = n.decision.options.find((o) => o.isDefault) ?? n.decision.options[0]
      c[n.id] = def.id
    }
  }
  return c
}

export function App() {
  const [activeDomainId, setActiveDomainId] = useState(domains[0].id)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [selectedCategory, setSelectedCategory] = useState<NodeCategory | null>(null)
  const [quizMode, setQuizMode] = useState(false)
  const [showPatterns, setShowPatterns] = useState(false)
  const [showComponents, setShowComponents] = useState(false)
  const [showLanding, setShowLanding] = useState(true)
  const [panelCollapsed, setPanelCollapsed] = useState(false)
  const [choicesByDomain, setChoicesByDomain] = useState<Record<string, Choices>>(() =>
    Object.fromEntries(domains.map((d) => [d.id, defaultChoices(d)])),
  )

  const domain = useMemo(
    () => domains.find((d) => d.id === activeDomainId)!,
    [activeDomainId],
  )
  const choices = choicesByDomain[activeDomainId]
  const selectedNode = domain.nodes.find((n) => n.id === selectedNodeId) ?? null

  // Auto-layout: dagre ranks nodes by request flow and minimizes edge crossings.
  const positions = useMemo(() => layoutDomain(domain.nodes, domain.edges), [domain])

  // The consequence cascade: nodes the selected node's *current* choice affects.
  const highlightedIds = useMemo(() => {
    if (!selectedNode?.decision) return new Set<string>()
    const opt = selectedNode.decision.options.find((o) => o.id === choices[selectedNode.id])
    return new Set(opt?.affects ?? [])
  }, [selectedNode, choices])

  // Is the selected node's current choice a deviation from the reference design?
  // If so, the cascade renders as *impact* (red + ⚠) rather than a neutral highlight —
  // this is how "what breaks" shows up on the diagram, not just in the panel.
  const impactMode = useMemo(() => {
    if (!selectedNode?.decision) return false
    const def =
      selectedNode.decision.options.find((o) => o.isDefault) ?? selectedNode.decision.options[0]
    return choices[selectedNode.id] !== def.id
  }, [selectedNode, choices])

  const rfNodes: Node<ComponentNodeData>[] = useMemo(
    () =>
      domain.nodes.map((n) => {
        const activeId = choices[n.id]
        const activeLabel = n.decision?.options.find((o) => o.id === activeId)?.label
        const def = n.decision
          ? n.decision.options.find((o) => o.isDefault) ?? n.decision.options[0]
          : null
        const affected = highlightedIds.has(n.id)
        return {
          id: n.id,
          type: 'component',
          position: positions[n.id] ?? n.position,
          data: {
            baseLabel: n.label,
            category: n.category,
            activeLabel,
            hasDecision: !!n.decision,
            isHighlighted: affected && !impactMode,
            isImpacted: affected && impactMode,
            // Persistent marker: this component's choice deviates from the reference design.
            isChanged: !!def && activeId !== def.id,
            isCategoryMatch: selectedCategory != null && n.category === selectedCategory,
            isDimmed: selectedCategory != null && n.category !== selectedCategory,
          },
        }
      }),
    [domain, choices, highlightedIds, impactMode, positions, selectedCategory],
  )

  const rfEdges: Edge[] = useMemo(
    () =>
      domain.edges.map((e) => {
        const inCascade =
          selectedNodeId === e.source && highlightedIds.has(e.target)
        const className = inCascade
          ? impactMode
            ? 'edge--impact'
            : 'edge--cascade'
          : e.control
            ? 'edge--control'
            : e.async
              ? 'edge--async'
              : undefined
        return {
          id: e.id,
          source: e.source,
          target: e.target,
          label: e.label,
          // Control-plane edges (DNS resolution) are not request hops — never animate them.
          animated: (e.async && !e.control) || inCascade,
          markerEnd: { type: MarkerType.ArrowClosed },
          className,
        }
      }),
    [domain, selectedNodeId, highlightedIds, impactMode],
  )

  // ── Browser-history navigation: Back/Forward move between top-level views ──
  type Nav = { landing: boolean; components: boolean; patterns: boolean; domainId: string }

  function applyNav(n: Nav) {
    setShowLanding(n.landing)
    setShowComponents(n.components)
    setShowPatterns(n.patterns)
    setActiveDomainId(n.domainId)
    setSelectedNodeId(null)
    setSelectedCategory(null)
  }

  function pushNav(partial: Partial<Nav>) {
    const next: Nav = {
      landing: false,
      components: false,
      patterns: false,
      domainId: activeDomainId,
      ...partial,
    }
    window.history.pushState(next, '')
    applyNav(next)
  }

  useEffect(() => {
    const home: Nav = { landing: true, components: false, patterns: false, domainId: domains[0].id }
    // Seed the first entry (the landing screen) so Back has somewhere to return to.
    window.history.replaceState(home, '')
    const onPop = (e: PopStateEvent) => applyNav((e.state as Nav) ?? home)
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // On phones the details panel sits below the canvas — scroll to it on select.
  useEffect(() => {
    if (selectedNodeId && window.matchMedia('(max-width: 760px)').matches) {
      document.querySelector('.inspector')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [selectedNodeId])

  function selectOption(nodeId: string, optionId: string) {
    setChoicesByDomain((prev) => ({
      ...prev,
      [activeDomainId]: { ...prev[activeDomainId], [nodeId]: optionId },
    }))
  }

  function selectNode(id: string | null) {
    setSelectedNodeId(id)
    setSelectedCategory(null)
    if (id) setPanelCollapsed(false) // reopen the pane when a component is clicked
  }

  function selectCategory(cat: NodeCategory) {
    setSelectedCategory((cur) => (cur === cat ? null : cat))
    setSelectedNodeId(null)
    setPanelCollapsed(false)
  }

  function switchDomain(id: string) {
    pushNav({ domainId: id })
  }

  // Jump from a pattern instance to the exact node in its domain.
  function jumpToNode(domainId: string, nodeId: string) {
    pushNav({ domainId })
    setSelectedNodeId(nodeId)
    setPanelCollapsed(false)
  }

  function resetDomain() {
    setChoicesByDomain((prev) => ({ ...prev, [activeDomainId]: defaultChoices(domain) }))
  }

  // Has the user swapped anything away from the reference design?
  const isModified = domain.nodes.some(
    (n) => n.decision && choices[n.id] !== (n.decision.options.find((o) => o.isDefault) ?? n.decision.options[0]).id,
  )

  if (showLanding) {
    return (
      <Landing
        onEnter={(id) => pushNav(id ? { domainId: id } : {})}
        onPatterns={() => pushNav({ patterns: true })}
        onComponents={() => pushNav({ components: true })}
      />
    )
  }

  return (
    <div className="app">
      <header className="topbar">
        <button
          className="brand"
          onClick={() => pushNav({ landing: true })}
          title="Back to the intro"
        >
          <span className="brand__name">ArchLab</span>
          <span className="brand__tag">swap a component, see what breaks</span>
        </button>
        <nav className="domains">
          <label className="domain-select">
            <span className="domain-select__caption">Architecture</span>
            <select
              className="domain-select__input"
              value={activeDomainId}
              onChange={(e) => switchDomain(e.target.value)}
            >
              {domains.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          <button
            className={`domain-tab domain-tab--patterns ${showComponents ? 'domain-tab--active' : ''}`}
            onClick={() => pushNav({ components: true })}
          >
            Components
          </button>
          <button
            className={`domain-tab domain-tab--patterns ${showPatterns ? 'domain-tab--active' : ''}`}
            onClick={() => pushNav({ patterns: true })}
          >
            Patterns
          </button>
        </nav>
        <div className="actions">
          <button
            className={`action ${quizMode ? 'action--on' : ''}`}
            onClick={() => setQuizMode((q) => !q)}
            title="Hide the answers and predict what breaks before revealing"
          >
            {quizMode ? '◉ Quiz mode on' : '○ Quiz mode'}
          </button>
          <button className="action" onClick={resetDomain} disabled={!isModified}>
            ↺ Reset swaps
          </button>
        </div>
      </header>

      {showComponents ? (
        <ComponentsView />
      ) : showPatterns ? (
        <PatternsView onJump={jumpToNode} />
      ) : (
        <>
      <div className="domain-blurb">
        <strong>{domain.tagline}</strong> <span>{domain.referenceNote}</span>
      </div>

      <div className="main">
        <div className="canvas">
          <ReactFlow
            key={activeDomainId}
            nodes={rfNodes}
            edges={rfEdges}
            nodeTypes={nodeTypes}
            defaultEdgeOptions={defaultEdgeOptions}
            onNodeClick={(_, node) => selectNode(node.id)}
            onPaneClick={() => {
              setSelectedNodeId(null)
              setSelectedCategory(null)
            }}
            nodesDraggable={false}
            fitView
            fitViewOptions={{ padding: 0.18 }}
            minZoom={0.15}
            maxZoom={1.5}
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={20} />
            <Controls showInteractive={false} />
            <FitView dep={`${activeDomainId}-${panelCollapsed}`} />
          </ReactFlow>
          <Legend active={selectedCategory} onSelect={selectCategory} />
        </div>

        <button
          className="panel-toggle"
          onClick={() => setPanelCollapsed((c) => !c)}
          title={panelCollapsed ? 'Show details panel' : 'Collapse details panel'}
          aria-label={panelCollapsed ? 'Show details panel' : 'Collapse details panel'}
        >
          {panelCollapsed ? '‹' : '›'}
        </button>

        {!panelCollapsed &&
          (selectedNode ? (
            <InspectorPanel
              node={selectedNode}
              activeOptionId={choices[selectedNode.id]}
              quizMode={quizMode}
              onSelectOption={selectOption}
              onClose={() => selectNode(null)}
            />
          ) : selectedCategory ? (
            <CategoryInfo
              category={selectedCategory}
              domain={domain}
              onClose={() => setSelectedCategory(null)}
            />
          ) : (
            <DomainBrief domain={domain} />
          ))}
      </div>
        </>
      )}
    </div>
  )
}

// Re-fits the view once React Flow has measured the custom nodes (and whenever
// the domain changes). Without this, fitView runs before nodes have real
// dimensions and the wide graph gets clipped on the left.
function FitView({ dep }: { dep: string }) {
  const initialized = useNodesInitialized()
  const { fitView } = useReactFlow()
  useEffect(() => {
    if (initialized) fitView({ padding: 0.18, duration: 250 })
  }, [initialized, dep, fitView])
  // Keep the whole graph in view when the window/canvas is resized.
  useEffect(() => {
    const onResize = () => fitView({ padding: 0.18 })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [fitView])
  return null
}

function Legend({
  active,
  onSelect,
}: {
  active: NodeCategory | null
  onSelect: (cat: NodeCategory) => void
}) {
  const cats: NodeCategory[] = [
    'client',
    'edge',
    'compute',
    'cache',
    'datastore',
    'queue',
    'external',
  ]
  return (
    <div className="legend">
      <span className="legend__hint">What's this? →</span>
      {cats.map((cat) => (
        <button
          key={cat}
          className={`legend__item ${active === cat ? 'legend__item--active' : ''}`}
          onClick={() => onSelect(cat)}
          title={`What is the ${CATEGORY_META[cat].label} category?`}
        >
          <span className={`legend__dot legend__dot--${cat}`} />
          {CATEGORY_META[cat].label}
        </button>
      ))}
    </div>
  )
}
