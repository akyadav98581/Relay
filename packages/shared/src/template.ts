import jsonata from 'jsonata'

export type RunContext = {
  trigger: unknown
  steps: Record<string, unknown>
}

// How an expression gets evaluated. The server passes a sandboxed one, see apps/api/src/sandbox.ts.
export type Evaluator = (expr: string, ctx: RunContext) => Promise<unknown>

// Plain in-process evaluation. JSONata has no access to the host, but a recursive
// expression can spin forever and a timeout cannot interrupt it. Use this only in
// tests and in the sandbox worker, never on the main server thread.
export const evalInProcess: Evaluator = (expr, ctx) => jsonata(expr).evaluate(ctx) as Promise<unknown>

const PLACEHOLDER = /\{\{([\s\S]*?)\}\}/g

const asText = (v: unknown) => (v === undefined || v === null ? '' : typeof v === 'string' ? v : JSON.stringify(v))

// "{{ trigger.body.id }}" alone keeps the real type. Mixed text is interpolated as a string.
export async function renderTemplate(text: string, ctx: RunContext, evaluate: Evaluator): Promise<unknown> {
  const matches = [...text.matchAll(PLACEHOLDER)]
  if (matches.length === 0) return text
  if (matches.length === 1 && matches[0]![0] === text.trim()) return evaluate(matches[0]![1]!, ctx)
  let out = ''
  let last = 0
  for (const m of matches) {
    out += text.slice(last, m.index) + asText(await evaluate(m[1]!, ctx))
    last = m.index! + m[0].length
  }
  return out + text.slice(last)
}

export async function renderString(text: string, ctx: RunContext, evaluate: Evaluator): Promise<string> {
  return asText(await renderTemplate(text, ctx, evaluate))
}

// Syntax check without running anything, for the editor and the API.
export function checkExpr(expr: string): string | null {
  try {
    jsonata(expr)
    return null
  } catch (e) {
    return (e as { message?: string }).message ?? 'invalid expression'
  }
}
