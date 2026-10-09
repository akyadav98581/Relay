import { and, eq, inArray, sql } from 'drizzle-orm'
import { configSchemas, renderString, renderTemplate, type Evaluator, type Graph, type GraphNode, type RunContext } from '@relay/shared'
import type { Config } from '../config.js'
import type { Db } from '../db/index.js'
import { jobs, runSteps, runs } from '../db/schema.js'
import { BlockedError, safeFetch, type SafeFetchOpts } from '../http-guard.js'
import type { ClaimedJob } from './queue.js'
import { advance, capJson, lockRun } from './runs.js'

export type RunnerDeps = {
  db: Db
  config: Config
  evaluate: Evaluator
  workerId: string
  fetchOpts?: SafeFetchOpts // seam for tests
}


// Carries what the step was doing when it failed, so the run page can show the request and the last response.
class StepFailure extends Error {
  constructor(message: string, public input: unknown, public output?: unknown, public retryable = false) { super(message) }
}

const SECRET_HEADER = /auth|token|secret|key|cookie|password/i
const maskHeaders = (h: Record<string, string>) => Object.fromEntries(Object.entries(h).map(([k, v]) => [k, SECRET_HEADER.test(k) ? '***' : v]))

type StepResult = { input: unknown; output: unknown }

// 1x, 2x, 4x the base wait, capped at five minutes.
export const backoffMs = (attempt: number, baseMs: number) => Math.min(baseMs * 2 ** (attempt - 1), 300_000)

async function execute(deps: RunnerDeps, node: GraphNode, ctx: RunContext): Promise<StepResult> {
  const { evaluate, config } = deps
  switch (node.type) {
    case 'transform': {
      const cfg = configSchemas.transform.parse(node.config)
      return { input: { expression: cfg.expression }, output: (await evaluate(cfg.expression, ctx)) ?? null }
    }
    case 'filter': {
      const cfg = configSchemas.filter.parse(node.config)
      const pass = (await evaluate(`$boolean((${cfg.condition}))`, ctx)) === true
      return { input: { condition: cfg.condition }, output: { pass } }
    }
    case 'http': {
      const cfg = configSchemas.http.parse(node.config)
      const url = await renderString(cfg.url, ctx, evaluate)
      const headers: Record<string, string> = {}
      for (const [k, v] of Object.entries(cfg.headers)) headers[k] = await renderString(v, ctx, evaluate)
      let body: string | undefined
      if (cfg.body) {
        const rendered = await renderTemplate(cfg.body, ctx, evaluate)
        if (typeof rendered === 'string') body = rendered
        else {
          body = JSON.stringify(rendered)
          if (!Object.keys(headers).some((h) => h.toLowerCase() === 'content-type')) headers['content-type'] = 'application/json'
        }
      }
      const input = { method: cfg.method, url, headers: maskHeaders(headers), body: body ?? null }
      let res
      try {
        res = await safeFetch(url, { method: cfg.method, headers, body }, { allowPrivate: config.allowPrivateHttp, timeoutMs: cfg.timeoutMs, ...deps.fetchOpts })
      } catch (err) {
        const cause = (err as { cause?: { code?: string; message?: string } }).cause
        const msg = cause?.code ? `${(err as Error).message} (${cause.code})` : (err as Error).message
        // a blocked address or a bad URL will not fix itself, a dropped connection might
        const hopeless = err instanceof BlockedError || /not a valid URL|only http|username|too many redirects/.test(msg)
        throw new StepFailure(msg, input, undefined, !hopeless)
      }
      const output = { status: res.status, ok: res.ok, headers: res.headers, body: res.body, truncated: res.truncated }
      if (res.status >= 500 || res.status === 429) throw new StepFailure(`HTTP ${res.status}`, input, output, true)
      return { input, output }
    }
    default:
      throw new Error(`${node.type} cannot be run as a step`)
  }
}

async function buildContext(db: Db, runId: string, payload: unknown): Promise<RunContext> {
  const rows = await db.select({ key: runSteps.key, output: runSteps.output }).from(runSteps).where(and(eq(runSteps.runId, runId), eq(runSteps.status, 'success')))
  return { trigger: payload, steps: Object.fromEntries(rows.map((r) => [r.key, r.output])) }
}

export async function processJob(deps: RunnerDeps, job: ClaimedJob): Promise<void> {
  const { db, workerId } = deps
  const dropJob = () => db.delete(jobs).where(eq(jobs.id, job.id))

  const [run] = await db.select().from(runs).where(eq(runs.id, job.runId))
  const [step] = await db.select().from(runSteps).where(and(eq(runSteps.runId, job.runId), eq(runSteps.nodeId, job.nodeId)))
  if (!run || !step || run.status !== 'running' || ['success', 'skipped', 'failed'].includes(step.status)) return void (await dropJob())
  const node = (run.graph as Graph).nodes.find((n) => n.id === job.nodeId)
  if (!node) return failStep(deps, job, run.graph, step.attempts, 'node no longer exists', false)

  // A delay never sleeps in memory. The first time we see it, it goes back on the queue with a
  // future run_at. When that time comes and the job is claimed again, the delay is over.
  if (node.type === 'delay') {
    if (step.status === 'waiting') return complete(deps, job, run.graph, { input: { seconds: node.config.seconds }, output: { waitedSeconds: node.config.seconds } })
    const seconds = configSchemas.delay.parse(node.config).seconds
    await db.update(runSteps).set({ status: 'waiting', attempts: sql`${runSteps.attempts} + 1`, startedAt: sql`coalesce(${runSteps.startedAt}, now())` }).where(and(eq(runSteps.runId, job.runId), eq(runSteps.nodeId, job.nodeId)))
    await db.update(jobs).set({ status: 'queued', runAt: new Date(Date.now() + seconds * 1000), lockedAt: null, lockedBy: null }).where(and(eq(jobs.id, job.id), eq(jobs.lockedBy, workerId)))
    return
  }

  const [started] = await db
    .update(runSteps)
    .set({ status: 'running', attempts: sql`${runSteps.attempts} + 1`, startedAt: sql`coalesce(${runSteps.startedAt}, now())` })
    .where(and(eq(runSteps.runId, job.runId), eq(runSteps.nodeId, job.nodeId)))
    .returning({ attempts: runSteps.attempts })
  const attempts = started!.attempts

  let result: StepResult
  try {
    result = await execute(deps, node, await buildContext(db, job.runId, run.payload))
  } catch (err) {
    const retries = node.type === 'http' ? configSchemas.http.parse(node.config).retries : 0
    const failure = err instanceof StepFailure ? err : null
    const retryable = !!failure?.retryable && attempts <= retries
    return failStep(deps, job, run.graph, attempts, (err as Error).message, retryable, failure ? { input: failure.input, output: failure.output } : undefined)
  }
  await complete(deps, job, run.graph, result)
}

async function complete(deps: RunnerDeps, job: ClaimedJob, graph: Graph, result: StepResult) {
  const { db, workerId } = deps
  await db.transaction(async (tx) => {
    await lockRun(tx, job.runId)
    // If our lock expired and another worker took the job, our result is not wanted.
    const mine = await tx.delete(jobs).where(and(eq(jobs.id, job.id), eq(jobs.lockedBy, workerId))).returning({ id: jobs.id })
    if (mine.length === 0) return
    const [run] = await tx.select({ status: runs.status }).from(runs).where(eq(runs.id, job.runId))
    if (run?.status !== 'running') return
    await tx
      .update(runSteps)
      .set({ status: 'success', input: capJson(result.input), output: capJson(result.output), error: null, finishedAt: new Date() })
      .where(and(eq(runSteps.runId, job.runId), eq(runSteps.nodeId, job.nodeId), inArray(runSteps.status, ['running', 'waiting'])))
    await advance(tx, job.runId, graph)
  })
}

async function failStep(deps: RunnerDeps, job: ClaimedJob, graph: Graph, attempts: number, message: string, retryable: boolean, seen?: { input: unknown; output: unknown }) {
  const { db, workerId, config } = deps
  await db.transaction(async (tx) => {
    await lockRun(tx, job.runId)
    const [mine] = await tx.select({ id: jobs.id }).from(jobs).where(and(eq(jobs.id, job.id), eq(jobs.lockedBy, workerId)))
    if (!mine) return
    const [run] = await tx.select({ status: runs.status }).from(runs).where(eq(runs.id, job.runId))
    if (run?.status !== 'running') return void (await tx.delete(jobs).where(eq(jobs.id, job.id)))

    if (retryable) {
      const wait = backoffMs(attempts, config.retryBaseMs)
      await tx.update(runSteps).set({ status: 'queued', error: message, input: capJson(seen?.input), output: capJson(seen?.output) }).where(and(eq(runSteps.runId, job.runId), eq(runSteps.nodeId, job.nodeId)))
      await tx.update(jobs).set({ status: 'queued', runAt: new Date(Date.now() + wait), lockedAt: null, lockedBy: null }).where(eq(jobs.id, job.id))
      return
    }

    const now = new Date()
    await tx.update(runSteps).set({ status: 'failed', error: message, input: capJson(seen?.input), output: capJson(seen?.output), finishedAt: now }).where(and(eq(runSteps.runId, job.runId), eq(runSteps.nodeId, job.nodeId)))
    // The run is over. Anything that has not started will not start, and steps still in
    // flight on other branches have their results thrown away when they report back.
    await tx.update(runSteps).set({ status: 'skipped', finishedAt: now }).where(and(eq(runSteps.runId, job.runId), inArray(runSteps.status, ['pending', 'queued'])))
    await tx.delete(jobs).where(and(eq(jobs.runId, job.runId), sql`${jobs.id} <> ${job.id}`, eq(jobs.status, 'queued')))
    await tx.delete(jobs).where(eq(jobs.id, job.id))
    const key = graph.nodes.find((n) => n.id === job.nodeId)?.key ?? job.nodeId
    await tx.update(runs).set({ status: 'failed', error: `${key}: ${message}`, finishedAt: now }).where(eq(runs.id, job.runId))
  })
}
