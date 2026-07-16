// ──────────────────────────────────────────────────────────────────────────
// ArchLab type system
//
// The engine is domain-agnostic. A "domain" (ticketing, social media, …) is
// just data conforming to the Domain shape below. Adding a new domain = adding
// a new file that exports a Domain. No engine code changes.
// ──────────────────────────────────────────────────────────────────────────

/** Visual category for a node — drives its colour in the canvas + legend. */
export type NodeCategory =
  | 'client'
  | 'edge' // CDN / load balancer / gateway
  | 'compute' // app servers / services
  | 'cache'
  | 'datastore'
  | 'queue' // async messaging
  | 'external' // 3rd-party (payment, push providers, …)

/** One selectable alternative for a decision point (e.g. "Redis" vs "MySQL"). */
export interface SwapOption {
  id: string
  /** The tech/strategy label shown on the node when this option is active. */
  label: string
  /** True for the option the best-in-class reference design actually uses. */
  isDefault?: boolean
  /** One-line gist shown under the option button. */
  summary: string
  /** Authored prose: what breaks or degrades if you pick this. */
  whatBreaks: string
  /** Authored prose: the honest tradeoffs of this choice. */
  tradeoffs: string
  /** Authored prose: when/why you'd actually choose this. */
  why: string
  /**
   * Node ids downstream of this node that this choice materially affects.
   * Selecting the option highlights these — the "consequence cascade".
   */
  affects: string[]
}

/** A node the user can click + (sometimes) swap. */
export interface ArchNode {
  id: string
  label: string
  category: NodeCategory
  /** Plain-English role of this component in the system. */
  role: string
  position: { x: number; y: number }
  /**
   * The teachable decision at this node. Omit for fixed nodes (e.g. "Client")
   * that exist for context but have no interesting swap.
   */
  decision?: {
    /** The question this node poses, e.g. "How do we generate the feed?" */
    question: string
    options: SwapOption[]
  }
}

export interface ArchEdge {
  id: string
  source: string
  target: string
  label?: string
  /** Optional: render as a dashed async edge. */
  async?: boolean
  /**
   * Control-plane / resolution edge (e.g. DNS), NOT a request hop. Rendered
   * dotted + muted so learners don't think traffic flows through it.
   */
  control?: boolean
}

/** One back-of-the-envelope number that frames the design. */
export interface ScaleFact {
  metric: string
  value: string
  note?: string
}

export interface Domain {
  id: string
  name: string
  /** Who does this best in the real world — the reference design. */
  referenceNote: string
  tagline: string
  /** Step 1 of the interview: scope the problem. */
  requirements: {
    functional: string[]
    nonFunctional: string[]
  }
  /** Step 2: back-of-the-envelope estimation — the numbers that drive decisions. */
  scale: ScaleFact[]
  /** Step 5: the transferable mental model this design teaches. */
  principle: {
    title: string
    body: string
  }
  nodes: ArchNode[]
  edges: ArchEdge[]
}

/** Per-domain map of nodeId -> selected optionId (defaults applied on load). */
export type Choices = Record<string, string>

// ──────────────────────────────────────────────────────────────────────────
// Cross-domain patterns — the meta-lesson: system design is a small set of
// reusable patterns reskinned across domains.
// ──────────────────────────────────────────────────────────────────────────

/** One place a pattern shows up — links back to a real node in a domain. */
export interface PatternInstance {
  domainId: string
  nodeId: string
  /** Human label of the component (so the card reads without a lookup). */
  where: string
  /** One line: how the pattern manifests specifically here. */
  how: string
}

export interface Pattern {
  id: string
  name: string
  /** The essence in one line. */
  essence: string
  /** The situation this pattern solves. */
  problem: string
  /** How it works, in the abstract. */
  mechanism: string
  instances: PatternInstance[]
}
