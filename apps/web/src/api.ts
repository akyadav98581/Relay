import type { Graph, RunView } from '@relay/shared'

export type User = { id: string; email: string }
export type WorkflowSummary = {
  id: string
  name: string
  enabled: boolean
  updatedAt: string
  trigger: 'webhook' | 'schedule' | null
  lastRun: { status: string; startedAt: string; finishedAt: string | null } | null
  steps: string[]
}
export type Stats = { runs24h: number; failed24h: number; succeeded24h: number }
export type WorkflowDetail = {
  id: string
  name: string
  enabled: boolean
  graph: Graph
  webhookPath: string
  nextRunAt: string | null
  updatedAt: string
  problems: string[]
}
export type RunSummary = { id: string; status: string; trigger: string; startedAt: string; finishedAt: string | null; error: string | null }

export class ApiError extends Error {
  constructor(public status: number, message: string, public details?: string[]) { super(message) }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new ApiError(res.status, data.error ?? 'request failed', Array.isArray(data.details) ? data.details : undefined)
  return data as T
}

export const api = {
  me: () => request<User>('GET', '/auth/me'),
  register: (email: string, password: string) => request<User>('POST', '/auth/register', { email, password }),
  login: (email: string, password: string) => request<User>('POST', '/auth/login', { email, password }),
  logout: () => request<{ ok: true }>('POST', '/auth/logout', {}),
  workflows: () => request<WorkflowSummary[]>('GET', '/workflows'),
  stats: () => request<Stats>('GET', '/stats'),
  workflow: (id: string) => request<WorkflowDetail>('GET', `/workflows/${id}`),
  createWorkflow: (name: string, graph?: Graph) => request<WorkflowDetail>('POST', '/workflows', { name, graph }),
  saveWorkflow: (id: string, patch: { name?: string; graph?: Graph; enabled?: boolean }) => request<WorkflowDetail>('PUT', `/workflows/${id}`, patch),
  deleteWorkflow: (id: string) => request<{ ok: true }>('DELETE', `/workflows/${id}`),
  runWorkflow: (id: string, payload?: unknown) => request<{ runId: string }>('POST', `/workflows/${id}/run`, { payload }),
  runs: (id: string) => request<RunSummary[]>('GET', `/workflows/${id}/runs`),
  run: (id: string) => request<RunView>('GET', `/runs/${id}`),
}
