import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { and, desc, eq, sql } from 'drizzle-orm'
import cookieParser from 'cookie-parser'
import express, { type NextFunction, type Request, type Response } from 'express'
import { rateLimit } from 'express-rate-limit'
import { z } from 'zod'
import { findProblems, nextRun, type Graph, type RunStepView, type RunView } from '@relay/shared'
import { clearSession, checkPassword, hashPassword, readSession, requireUser, setSession } from './auth.js'
import type { Config } from './config.js'
import type { Db } from './db/index.js'
import { runSteps, runs, users, workflows } from './db/schema.js'
import { nextRunAt, startRun } from './engine/index.js'

export type AppDeps = {
  db: Db
  config: Config
  limits?: { auth?: number; hooks?: number }
  webDir?: string
}

class HttpError extends Error {
  constructor(public status: number, message: string, public details?: unknown) { super(message) }
}

const emailSchema = z.string().trim().toLowerCase().email().max(200)
const credentials = z.object({ email: emailSchema, password: z.string().min(8).max(72) })
const DEFAULT_GRAPH: Graph = { nodes: [{ id: 'n_start', key: 'start', type: 'webhook', position: { x: 80, y: 120 }, config: {} }], edges: [] }
const uuid = z.string().uuid()

const newToken = () => randomBytes(18).toString('base64url')

export function createApp({ db, config, limits = {}, webDir }: AppDeps) {
  const app = express()
  app.set('trust proxy', 1)
  app.disable('x-powered-by')
  app.use(cookieParser())
  app.use(readSession(config))
  app.get('/healthz', (_req, res) => void res.send('ok'))

  // ---------- webhooks: public, guarded by an unguessable token ----------
  const hookLimit = rateLimit({ windowMs: 60_000, limit: limits.hooks ?? 120, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'too many requests' } })
  app.all('/hooks/:token', hookLimit, express.text({ type: () => true, limit: '100kb' }), async (req, res) => {
    const [wf] = await db.select().from(workflows).where(eq(workflows.webhookToken, String(req.params.token)))
    const hasHook = wf?.graph.nodes.some((n) => n.type === 'webhook')
    if (!wf || !wf.enabled || !hasHook) throw new HttpError(404, 'not found')
    let body: unknown = typeof req.body === 'string' && req.body.length ? req.body : null
    if (typeof body === 'string' && (req.headers['content-type'] ?? '').includes('json')) {
      try { body = JSON.parse(body) } catch { throw new HttpError(400, 'body is not valid JSON') }
    }
    const headers = Object.fromEntries(Object.entries(req.headers).filter(([k]) => !['cookie', 'authorization'].includes(k)).map(([k, v]) => [k, String(v)]))
    const runId = await startRun(db, wf, 'webhook', { method: req.method, body, query: req.query, headers })
    res.status(202).json({ runId })
  })

  // ---------- everything under /api needs JSON ----------
  const api = express.Router()
  api.use(express.json({ limit: '300kb' }))

  const authLimit = rateLimit({ windowMs: 15 * 60_000, limit: limits.auth ?? 40, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'too many attempts, try again later' } })

  api.post('/auth/register', authLimit, async (req, res) => {
    const { email, password } = credentials.parse(req.body)
    const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email))
    if (existing) throw new HttpError(409, 'that email is already registered')
    const [u] = await db.insert(users).values({ email, passwordHash: await hashPassword(password) }).returning({ id: users.id })
    setSession(res, config, u!.id)
    res.status(201).json({ id: u!.id, email })
  })

  api.post('/auth/login', authLimit, async (req, res) => {
    const { email, password } = credentials.parse(req.body)
    const [u] = await db.select().from(users).where(eq(users.email, email))
    if (!(await checkPassword(password, u?.passwordHash))) throw new HttpError(401, 'wrong email or password')
    setSession(res, config, u!.id)
    res.json({ id: u!.id, email })
  })

  api.post('/auth/logout', (_req, res) => { clearSession(res); res.json({ ok: true }) })

  api.get('/auth/me', requireUser, async (req, res) => {
    const [u] = await db.select({ id: users.id, email: users.email }).from(users).where(eq(users.id, req.userId!))
    if (!u) { clearSession(res); throw new HttpError(401, 'sign in first') }
    res.json(u)
  })

  api.use(requireUser)

  // ---------- workflows ----------
  const owned = async (req: Request) => {
    const id = uuid.safeParse(req.params.id)
    if (!id.success) throw new HttpError(404, 'not found')
    const [wf] = await db.select().from(workflows).where(and(eq(workflows.id, id.data), eq(workflows.userId, req.userId!)))
    if (!wf) throw new HttpError(404, 'not found') // same answer whether it exists or belongs to someone else
    return wf
  }

  const view = (wf: typeof workflows.$inferSelect) => ({
    id: wf.id, name: wf.name, enabled: wf.enabled, graph: wf.graph, webhookPath: `/hooks/${wf.webhookToken}`,
    nextRunAt: wf.nextRunAt, createdAt: wf.createdAt, updatedAt: wf.updatedAt, problems: findProblems(wf.graph).problems,
  })

  // Schedules run for real on the server, so how often is capped.
  const scheduleProblems = (graph: Graph): string[] => {
    const n = graph.nodes.find((x) => x.type === 'schedule')
    if (!n) return []
    try {
      const a = nextRun(String(n.config.cron), new Date())
      const b = nextRun(String(n.config.cron), a)
      return (b.getTime() - a.getTime()) / 60_000 < config.minScheduleMinutes ? [`${n.key}: this server allows a schedule at most every ${config.minScheduleMinutes} minutes`] : []
    } catch { return [] }
  }

  api.get('/workflows', async (req, res) => {
    const rows = await db.execute(sql`
      select w.id, w.name, w.enabled, w.updated_at as "updatedAt",
        (select jsonb_build_object('status', r.status, 'startedAt', r.started_at, 'finishedAt', r.finished_at) from runs r where r.workflow_id = w.id order by r.started_at desc limit 1) as "lastRun",
        (select coalesce(jsonb_agg(t.n->>'type' order by (t.n->'position'->>'x')::numeric), '[]'::jsonb) from jsonb_array_elements(w.graph->'nodes') as t(n)) as steps,
        (select n->>'type' from jsonb_array_elements(w.graph->'nodes') n where n->>'type' in ('webhook','schedule') limit 1) as "trigger"
      from workflows w where w.user_id = ${req.userId!} order by w.updated_at desc`)
    res.json(rows.rows)
  })

  // Numbers for the top of the workflows page.
  api.get('/stats', async (req, res) => {
    const row = (await db.execute(sql`
      select count(*)::int as runs, count(*) filter (where r.status = 'failed')::int as failed,
             count(*) filter (where r.status = 'success')::int as succeeded
      from runs r join workflows w on w.id = r.workflow_id
      where w.user_id = ${req.userId!} and r.started_at > now() - interval '24 hours'`)).rows[0] as { runs: number; failed: number; succeeded: number }
    res.json({ runs24h: row.runs, failed24h: row.failed, succeeded24h: row.succeeded })
  })

  api.post('/workflows', async (req, res) => {
    const body = z.object({ name: z.string().trim().min(1).max(80), graph: z.unknown().optional() }).parse(req.body)
    const count = (await db.execute(sql`select count(*)::int as n from workflows where user_id = ${req.userId!}`)).rows[0] as { n: number }
    if (count.n >= config.maxWorkflowsPerUser) throw new HttpError(403, `you can have up to ${config.maxWorkflowsPerUser} workflows`)
    const parsed = body.graph === undefined ? { graph: DEFAULT_GRAPH } : findProblems(body.graph)
    if (!parsed.graph) throw new HttpError(400, 'invalid graph', (parsed as { problems: string[] }).problems)
    const [wf] = await db.insert(workflows).values({ userId: req.userId!, name: body.name, graph: parsed.graph, webhookToken: newToken() }).returning()
    res.status(201).json(view(wf!))
  })

  api.get('/workflows/:id', async (req, res) => void res.json(view(await owned(req))))

  api.put('/workflows/:id', async (req, res) => {
    const wf = await owned(req)
    const body = z.object({ name: z.string().trim().min(1).max(80).optional(), graph: z.unknown().optional(), enabled: z.boolean().optional() }).parse(req.body)
    let graph = wf.graph
    if (body.graph !== undefined) {
      const shape = findProblems(body.graph)
      if (!shape.graph) throw new HttpError(400, 'invalid graph', shape.problems) // not even shaped like a graph
      graph = shape.graph
    }
    const problems = [...findProblems(graph).problems, ...scheduleProblems(graph)]
    const wantsEnabled = body.enabled ?? wf.enabled
    if (body.enabled === true && problems.length) throw new HttpError(422, 'fix the problems before enabling', problems)
    // a draft with problems can be saved, but it cannot stay switched on
    const enabled = problems.length ? false : wantsEnabled
    const [saved] = await db
      .update(workflows)
      .set({ name: body.name ?? wf.name, graph, enabled, nextRunAt: nextRunAt(graph, enabled), updatedAt: new Date() })
      .where(eq(workflows.id, wf.id))
      .returning()
    res.json({ ...view(saved!), problems })
  })

  api.delete('/workflows/:id', async (req, res) => {
    const wf = await owned(req)
    await db.delete(workflows).where(eq(workflows.id, wf.id))
    res.json({ ok: true })
  })

  api.post('/workflows/:id/run', async (req, res) => {
    const wf = await owned(req)
    const problems = findProblems(wf.graph).problems
    if (problems.length) throw new HttpError(422, 'fix the problems before running', problems)
    const body = z.object({ payload: z.unknown().optional() }).parse(req.body ?? {})
    const runId = await startRun(db, wf, 'manual', body.payload ?? {})
    res.status(202).json({ runId })
  })

  api.get('/workflows/:id/runs', async (req, res) => {
    const wf = await owned(req)
    const limit = Math.min(Number(req.query.limit) || 30, 100)
    const rows = await db
      .select({ id: runs.id, status: runs.status, trigger: runs.trigger, startedAt: runs.startedAt, finishedAt: runs.finishedAt, error: runs.error })
      .from(runs).where(eq(runs.workflowId, wf.id)).orderBy(desc(runs.startedAt)).limit(limit)
    res.json(rows)
  })

  // ---------- runs ----------
  const runView = async (req: Request): Promise<RunView> => {
    const id = uuid.safeParse(req.params.id)
    if (!id.success) throw new HttpError(404, 'not found')
    const [run] = await db
      .select({ run: runs }).from(runs).innerJoin(workflows, eq(workflows.id, runs.workflowId))
      .where(and(eq(runs.id, id.data), eq(workflows.userId, req.userId!)))
    if (!run) throw new HttpError(404, 'not found')
    const steps = await db.select().from(runSteps).where(eq(runSteps.runId, id.data))
    const order = new Map(run.run.graph.nodes.map((n, i) => [n.id, i]))
    const stepViews: RunStepView[] = steps
      .sort((a, b) => (order.get(a.nodeId) ?? 0) - (order.get(b.nodeId) ?? 0))
      .map((s) => ({ nodeId: s.nodeId, key: s.key, type: s.type, status: s.status, attempts: s.attempts, input: s.input, output: s.output, error: s.error, startedAt: s.startedAt?.toISOString() ?? null, finishedAt: s.finishedAt?.toISOString() ?? null }))
    return {
      id: run.run.id, workflowId: run.run.workflowId, status: run.run.status as RunView['status'], trigger: run.run.trigger, payload: run.run.payload,
      startedAt: run.run.startedAt.toISOString(), finishedAt: run.run.finishedAt?.toISOString() ?? null, error: run.run.error, graph: run.run.graph, steps: stepViews,
    }
  }

  api.get('/runs/:id', async (req, res) => void res.json(await runView(req)))

  // Live updates. The server looks at the run twice a second and sends a message when it changed.
  api.get('/runs/:id/events', async (req, res) => {
    let last = await runView(req)
    res.set({ 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', 'x-accel-buffering': 'no' })
    res.flushHeaders()
    const send = (v: RunView) => res.write(`data: ${JSON.stringify(v)}\n\n`)
    send(last)
    let closed = false
    req.on('close', () => { closed = true })
    const started = Date.now()
    while (!closed && last.status === 'running' && Date.now() - started < 10 * 60_000) {
      await new Promise((r) => setTimeout(r, 500))
      if (closed) break
      const next = await runView(req).catch(() => null)
      if (!next) break
      if (JSON.stringify(next) !== JSON.stringify(last)) { last = next; send(next) }
    }
    res.end()
  })

  app.use('/api', api)

  // ---------- built web app ----------
  const dir = webDir ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist')
  if (fs.existsSync(path.join(dir, 'index.html'))) {
    app.use(express.static(dir, { index: false, maxAge: '1h' }))
    app.use((req, res, next) => (req.method === 'GET' && !req.path.startsWith('/api') ? res.sendFile(path.join(dir, 'index.html')) : next()))
  }

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof z.ZodError) return void res.status(400).json({ error: 'invalid input', details: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`) })
    if (err instanceof HttpError) return void res.status(err.status).json({ error: err.message, details: err.details })
    if ((err as { type?: string }).type === 'entity.too.large') return void res.status(413).json({ error: 'request too large' })
    if ((err as { type?: string }).type === 'entity.parse.failed') return void res.status(400).json({ error: 'body is not valid JSON' })
    console.error(err)
    res.status(500).json({ error: 'something went wrong' })
  })

  return app
}
