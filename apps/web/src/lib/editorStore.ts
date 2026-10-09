import { applyEdgeChanges, applyNodeChanges, type Connection, type Edge, type EdgeChange, type Node, type NodeChange, type XYPosition } from '@xyflow/react'
import { create } from 'zustand'
import { defaultConfig, isTrigger, type Graph, type NodeType } from '@relay/shared'
import type { WorkflowDetail } from '../api'

export type StepData = { key: string; type: NodeType; config: Record<string, unknown>; [k: string]: unknown }
export type FlowNode = Node<StepData, 'step'>

const rid = () => Math.random().toString(36).slice(2, 8)

export function toFlow(graph: Graph): { nodes: FlowNode[]; edges: Edge[] } {
  return {
    nodes: graph.nodes.map((n) => ({ id: n.id, type: 'step', position: n.position, data: { key: n.key, type: n.type, config: n.config } })),
    edges: graph.edges.map((e) => ({ id: e.id, source: e.source, target: e.target })),
  }
}

export function toGraph(nodes: FlowNode[], edges: Edge[]): Graph {
  return {
    nodes: nodes.map((n) => ({ id: n.id, key: n.data.key, type: n.data.type, position: { x: Math.round(n.position.x), y: Math.round(n.position.y) }, config: n.data.config })),
    edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target })),
  }
}

// Can `from` reach `to` by following edges forward? Used to refuse a connection that would make a loop.
export function reaches(edges: Edge[], from: string, to: string): boolean {
  const seen = new Set<string>()
  const stack = [from]
  while (stack.length) {
    const id = stack.pop()!
    if (id === to) return true
    if (seen.has(id)) continue
    seen.add(id)
    for (const e of edges) if (e.source === id) stack.push(e.target)
  }
  return false
}

type State = {
  workflowId: string | null
  name: string
  enabled: boolean
  nodes: FlowNode[]
  edges: Edge[]
  baseline: string
  load: (wf: WorkflowDetail) => void
  setName: (n: string) => void
  setEnabled: (v: boolean) => void
  onNodesChange: (c: NodeChange<FlowNode>[]) => void
  onEdgesChange: (c: EdgeChange[]) => void
  canConnect: (c: { source: string; target: string }) => boolean
  connect: (c: Connection) => void
  addNode: (type: NodeType, at?: XYPosition) => string
  setKey: (id: string, key: string) => void
  setConfig: (id: string, patch: Record<string, unknown>) => void
  markSaved: (wf: WorkflowDetail) => void
}

const snapshot = (name: string, nodes: FlowNode[], edges: Edge[]) => JSON.stringify([name, toGraph(nodes, edges)])

export const useEditor = create<State>((set, get) => ({
  workflowId: null,
  name: '',
  enabled: false,
  nodes: [],
  edges: [],
  baseline: '',

  load(wf) {
    const { nodes, edges } = toFlow(wf.graph)
    set({ workflowId: wf.id, name: wf.name, enabled: wf.enabled, nodes, edges, baseline: snapshot(wf.name, nodes, edges) })
  },
  markSaved(wf) {
    const { nodes, edges } = get()
    set({ name: wf.name, enabled: wf.enabled, baseline: snapshot(wf.name, nodes, edges) })
  },
  setName: (name) => set({ name }),
  setEnabled: (enabled) => set({ enabled }),
  onNodesChange: (changes) => set({ nodes: applyNodeChanges(changes, get().nodes) }),
  onEdgesChange: (changes) => set({ edges: applyEdgeChanges(changes, get().edges) }),

  canConnect({ source, target }) {
    const { nodes, edges } = get()
    if (source === target) return false
    const t = nodes.find((n) => n.id === target)
    if (!t || isTrigger(t.data.type)) return false // a trigger has no input
    if (edges.some((e) => e.source === source && e.target === target)) return false
    return !reaches(edges, target, source) // would close a loop
  },
  connect(c) {
    if (!c.source || !c.target || !get().canConnect({ source: c.source, target: c.target })) return
    set({ edges: [...get().edges, { id: `e_${c.source}_${c.target}`, source: c.source, target: c.target }] })
  },

  addNode(type, at) {
    const { nodes } = get()
    let n = 1
    while (nodes.some((x) => x.data.key === `${type}${n}`)) n++
    const key = type === 'webhook' && !nodes.some((x) => x.data.key === 'start') ? 'start' : `${type}${n}`
    const id = `n_${rid()}`
    // Next to the selected step (or the right-most one), so a chain builds left to right and edges stay readable.
    const anchor = nodes.find((x) => x.selected) ?? nodes.reduce<FlowNode | undefined>((best, x) => (!best || x.position.x > best.position.x ? x : best), undefined)
    const position = at ?? (anchor ? { x: anchor.position.x + 300, y: anchor.position.y } : { x: 80, y: 120 })
    set({
      nodes: [
        ...nodes.map((x) => ({ ...x, selected: false })),
        { id, type: 'step', position, selected: true, data: { key, type, config: defaultConfig(type) } },
      ],
    })
    return id
  },
  setKey: (id, key) => set({ nodes: get().nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, key } } : n)) }),
  setConfig: (id, patch) =>
    set({ nodes: get().nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, config: { ...n.data.config, ...patch } } } : n)) }),
}))

export const isDirty = (s: State) => s.workflowId !== null && snapshot(s.name, s.nodes, s.edges) !== s.baseline
