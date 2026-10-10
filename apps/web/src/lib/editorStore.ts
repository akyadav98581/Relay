import { applyEdgeChanges, applyNodeChanges, type Connection, type Edge, type EdgeChange, type Node, type NodeChange, type XYPosition } from '@xyflow/react'
import { configureStore, createSlice, type PayloadAction } from '@reduxjs/toolkit'
import { useDispatch, useSelector, type TypedUseSelectorHook } from 'react-redux'
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

export type EditorState = {
  workflowId: string | null
  name: string
  enabled: boolean
  nodes: FlowNode[]
  edges: Edge[]
  baseline: string
}

const initialState: EditorState = { workflowId: null, name: '', enabled: false, nodes: [], edges: [], baseline: '' }

const snapshot = (name: string, nodes: FlowNode[], edges: Edge[]) => JSON.stringify([name, toGraph(nodes, edges)])

// Would adding source -> target be allowed? Plain function over the state, so the canvas can call it while dragging.
export function canConnect(s: EditorState, { source, target }: { source: string; target: string }): boolean {
  if (source === target) return false
  const t = s.nodes.find((n) => n.id === target)
  if (!t || isTrigger(t.data.type)) return false // a trigger has no input
  if (s.edges.some((e) => e.source === source && e.target === target)) return false
  return !reaches(s.edges, target, source) // would close a loop
}

const slice = createSlice({
  name: 'editor',
  initialState,
  reducers: {
    load(_state, a: PayloadAction<WorkflowDetail>) {
      const wf = a.payload
      const { nodes, edges } = toFlow(wf.graph)
      return { workflowId: wf.id, name: wf.name, enabled: wf.enabled, nodes, edges, baseline: snapshot(wf.name, nodes, edges) }
    },
    markSaved(state, a: PayloadAction<WorkflowDetail>) {
      state.name = a.payload.name
      state.enabled = a.payload.enabled
      state.baseline = snapshot(state.name, state.nodes, state.edges)
    },
    setName(state, a: PayloadAction<string>) {
      state.name = a.payload
    },
    onNodesChange(state, a: PayloadAction<NodeChange<FlowNode>[]>) {
      state.nodes = applyNodeChanges(a.payload, state.nodes)
    },
    onEdgesChange(state, a: PayloadAction<EdgeChange[]>) {
      state.edges = applyEdgeChanges(a.payload, state.edges)
    },
    connect(state, a: PayloadAction<Connection>) {
      const { source, target } = a.payload
      if (!source || !target || !canConnect(state, { source, target })) return
      state.edges.push({ id: `e_${source}_${target}`, source, target })
    },
    addNode: {
      // The random id is made in prepare, because a reducer has to give the same answer every time.
      prepare: (type: NodeType, at?: XYPosition) => ({ payload: { type, at, id: `n_${rid()}` } }),
      reducer(state, a: PayloadAction<{ type: NodeType; at?: XYPosition; id: string }>) {
        const { type, at, id } = a.payload
        const { nodes } = state
        let n = 1
        while (nodes.some((x) => x.data.key === `${type}${n}`)) n++
        const key = type === 'webhook' && !nodes.some((x) => x.data.key === 'start') ? 'start' : `${type}${n}`
        // Next to the selected step (or the right-most one), so a chain builds left to right and edges stay readable.
        const anchor = nodes.find((x) => x.selected) ?? nodes.reduce<FlowNode | undefined>((best, x) => (!best || x.position.x > best.position.x ? x : best), undefined)
        const position = at ?? (anchor ? { x: anchor.position.x + 300, y: anchor.position.y } : { x: 80, y: 120 })
        for (const x of nodes) x.selected = false
        nodes.push({ id, type: 'step', position, selected: true, data: { key, type, config: defaultConfig(type) } })
      },
    },
    setKey(state, a: PayloadAction<{ id: string; key: string }>) {
      const n = state.nodes.find((x) => x.id === a.payload.id)
      if (n) n.data.key = a.payload.key
    },
    setConfig(state, a: PayloadAction<{ id: string; patch: Record<string, unknown> }>) {
      const n = state.nodes.find((x) => x.id === a.payload.id)
      if (n) Object.assign(n.data.config, a.payload.patch)
    },
  },
})

export const { load, markSaved, setName, onNodesChange, onEdgesChange, connect, addNode, setKey, setConfig } = slice.actions

export const store = configureStore({ reducer: { editor: slice.reducer } })
export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch

export const useAppDispatch = () => useDispatch<AppDispatch>()
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector

export const isDirty = (s: RootState) => s.editor.workflowId !== null && snapshot(s.editor.name, s.editor.nodes, s.editor.edges) !== s.editor.baseline
