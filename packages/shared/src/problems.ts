import { configSchemas } from './nodes.js'
import { graphSchema, validateGraph, type Graph } from './graph.js'
import { checkExpr } from './template.js'

const PLACEHOLDER = /\{\{([\s\S]*?)\}\}/g

function templateProblems(label: string, text: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(PLACEHOLDER)) {
    const err = checkExpr(m[1]!)
    if (err) out.push(`${label}: {{${m[1]}}} ${err}`)
  }
  return out
}

// Everything that would stop a workflow from running, as a list a person can read.
// A workflow with problems can still be saved as a draft, but not enabled or run.
export function findProblems(input: unknown): { graph: Graph | null; problems: string[] } {
  const shape = graphSchema.safeParse(input)
  if (!shape.success) return { graph: null, problems: shape.error.issues.map((i) => `${i.path.join('.') || 'graph'}: ${i.message}`) }
  const problems: string[] = []
  const checked = validateGraph(shape.data)
  if (!checked.ok) problems.push(...checked.errors)

  for (const n of shape.data.nodes) {
    if (n.type === 'transform' || n.type === 'filter') {
      const field = n.type === 'transform' ? 'expression' : 'condition'
      const err = checkExpr(String(n.config[field] ?? ''))
      if (err) problems.push(`${n.key}: ${field} ${err}`)
    }
    if (n.type === 'http') {
      const cfg = configSchemas.http.safeParse(n.config)
      if (cfg.success) {
        problems.push(...templateProblems(`${n.key} url`, cfg.data.url), ...templateProblems(`${n.key} body`, cfg.data.body))
        for (const [k, v] of Object.entries(cfg.data.headers)) problems.push(...templateProblems(`${n.key} header ${k}`, v))
      }
    }
  }
  return { graph: shape.data, problems }
}
