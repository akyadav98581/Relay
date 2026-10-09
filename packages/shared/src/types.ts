import type { Graph } from './graph.js'

export type RunStatus = 'running' | 'success' | 'failed'

export type RunStepView = {
  nodeId: string
  key: string
  type: string
  status: string
  attempts: number
  input: unknown
  output: unknown
  error: string | null
  startedAt: string | null
  finishedAt: string | null
}

export type RunView = {
  id: string
  workflowId: string
  status: RunStatus
  trigger: string
  payload: unknown
  startedAt: string
  finishedAt: string | null
  error: string | null
  graph: Graph
  steps: RunStepView[]
}
