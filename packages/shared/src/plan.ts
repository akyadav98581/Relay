import { parentsOf, type Graph } from './graph.js'

export type StepStatus = 'pending' | 'queued' | 'running' | 'waiting' | 'success' | 'failed' | 'skipped'
export type StepState = { status: StepStatus; output?: unknown }

const isDone = (s: StepStatus) => s === 'success' || s === 'skipped'

// An edge carries data forward when its source succeeded, and, for a filter,
// only when the filter said yes.
function edgeIsLive(graph: Graph, sourceId: string, states: Map<string, StepState>): boolean {
  const st = states.get(sourceId)
  if (!st || st.status !== 'success') return false
  const node = graph.nodes.find((n) => n.id === sourceId)!
  if (node.type === 'filter') return (st.output as { pass?: boolean } | undefined)?.pass === true
  return true
}

// Which pending steps can start now, and which can never run.
// A step starts when all its parents are finished and at least one edge into it is live.
// A step with no live edge is skipped, and skipping can cascade down the graph.
export function planNext(graph: Graph, input: Map<string, StepState>): { toRun: string[]; toSkip: string[] } {
  const states = new Map(input)
  const toRun: string[] = []
  const toSkip: string[] = []
  let changed = true
  while (changed) {
    changed = false
    for (const node of graph.nodes) {
      if (states.get(node.id)?.status !== 'pending') continue
      const parents = parentsOf(graph, node.id)
      if (parents.length === 0) continue // triggers are created already finished
      if (!parents.every((p) => isDone(states.get(p)?.status ?? 'pending'))) continue
      if (parents.some((p) => edgeIsLive(graph, p, states))) {
        toRun.push(node.id)
        states.set(node.id, { status: 'queued' })
      } else {
        toSkip.push(node.id)
        states.set(node.id, { status: 'skipped' })
      }
      changed = true
    }
  }
  return { toRun, toSkip }
}

export function isRunFinished(states: Map<string, StepState>): boolean {
  return [...states.values()].every((s) => s.status === 'success' || s.status === 'skipped' || s.status === 'failed')
}

