import { z } from 'zod'
import { NODE_TYPES, configSchemas, isTrigger } from './nodes.js'

export const MAX_NODES = 50
export const KEY_PATTERN = /^[a-z][a-z0-9_]{0,31}$/

export const nodeSchema = z.object({
  id: z.string().min(1).max(64),
  key: z.string().regex(KEY_PATTERN, 'key must be lowercase letters, digits and underscores, starting with a letter'),
  type: z.enum(NODE_TYPES),
  position: z.object({ x: z.number(), y: z.number() }),
  config: z.record(z.string(), z.unknown()),
})

export const edgeSchema = z.object({
  id: z.string().min(1).max(64),
  source: z.string().min(1),
  target: z.string().min(1),
})

export const graphSchema = z.object({
  nodes: z.array(nodeSchema).max(MAX_NODES),
  edges: z.array(edgeSchema).max(MAX_NODES * 3),
})

export type GraphNode = z.infer<typeof nodeSchema>
export type GraphEdge = z.infer<typeof edgeSchema>
export type Graph = z.infer<typeof graphSchema>

export type GraphCheck = { ok: true; graph: Graph } | { ok: false; errors: string[] }

// Everything a saved workflow has to satisfy. The editor and the API share this,
// so what the canvas accepts is what the server accepts.
export function validateGraph(input: unknown): GraphCheck {
  const parsed = graphSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map((i) => `${i.path.join('.') || 'graph'}: ${i.message}`) }
  }
  const g = parsed.data
  const errors: string[] = []
  const byId = new Map<string, GraphNode>()
  const keys = new Set<string>()

  for (const n of g.nodes) {
    if (byId.has(n.id)) errors.push(`duplicate node id ${n.id}`)
    byId.set(n.id, n)
    if (keys.has(n.key)) errors.push(`duplicate key "${n.key}"`)
    keys.add(n.key)
    const cfg = configSchemas[n.type].safeParse(n.config)
    if (!cfg.success) {
      for (const i of cfg.error.issues) errors.push(`${n.key}: ${i.path.join('.') || 'config'} ${i.message}`)
    }
  }

  const triggers = g.nodes.filter((n) => isTrigger(n.type))
  if (triggers.length === 0) errors.push('add a webhook or schedule trigger')
  if (triggers.length > 1) errors.push('only one trigger per workflow')

  const incoming = new Map<string, string[]>()
  const outgoing = new Map<string, string[]>()
  const seenEdges = new Set<string>()
  for (const e of g.edges) {
    if (!byId.has(e.source) || !byId.has(e.target)) { errors.push(`edge ${e.id} points at a missing node`); continue }
    if (e.source === e.target) { errors.push(`${byId.get(e.source)!.key} is connected to itself`); continue }
    const pair = `${e.source}>${e.target}`
    if (seenEdges.has(pair)) { errors.push('duplicate connection'); continue }
    seenEdges.add(pair)
    ;(incoming.get(e.target) ?? incoming.set(e.target, []).get(e.target)!).push(e.source)
    ;(outgoing.get(e.source) ?? outgoing.set(e.source, []).get(e.source)!).push(e.target)
  }

  for (const t of triggers) {
    if (incoming.get(t.id)?.length) errors.push(`${t.key} is a trigger and cannot have an input`)
  }

  // cycle check (Kahn). Anything left over sits on a cycle.
  const indeg = new Map(g.nodes.map((n) => [n.id, incoming.get(n.id)?.length ?? 0]))
  const queue = g.nodes.filter((n) => indeg.get(n.id) === 0).map((n) => n.id)
  let seen = 0
  while (queue.length) {
    const id = queue.pop()!
    seen++
    for (const next of outgoing.get(id) ?? []) {
      indeg.set(next, indeg.get(next)! - 1)
      if (indeg.get(next) === 0) queue.push(next)
    }
  }
  if (seen < g.nodes.length) errors.push('the workflow has a loop')

  // every step has to be reachable from the trigger
  if (triggers.length === 1 && seen === g.nodes.length) {
    const reach = new Set<string>([triggers[0]!.id])
    const stack = [triggers[0]!.id]
    while (stack.length) for (const n of outgoing.get(stack.pop()!) ?? []) if (!reach.has(n)) { reach.add(n); stack.push(n) }
    for (const n of g.nodes) if (!reach.has(n.id)) errors.push(`${n.key} is not connected to the trigger`)
  }

  return errors.length ? { ok: false, errors } : { ok: true, graph: g }
}

export function parentsOf(graph: Graph, id: string): string[] {
  return graph.edges.filter((e) => e.target === id).map((e) => e.source)
}

export function childrenOf(graph: Graph, id: string): string[] {
  return graph.edges.filter((e) => e.source === id).map((e) => e.target)
}

