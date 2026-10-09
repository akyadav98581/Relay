import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createEngine, pruneRuns, startRun } from '../src/engine/index.js'
import { COOKIE } from '../src/auth.js'
import { runs } from '../src/db/schema.js'
import { browser, forgeToken, listen } from './api-helpers.js'
import { graph, node, seedUser, seedWorkflow, waitRunDone } from './engine-helpers.js'
import { newDatabase, testConfig, testServer, waitFor } from './helpers.js'

const config = testConfig({ maxWorkflowsPerUser: 4, minScheduleMinutes: 5 })
let t: Awaited<ReturnType<typeof newDatabase>>
let app: ReturnType<typeof listen>
let echo: Awaited<ReturnType<typeof testServer>>
let engine: ReturnType<typeof createEngine>

beforeAll(async () => {
  t = await newDatabase()
  echo = await testServer()
  engine = createEngine(t.db, config)
  engine.startWorkers(2)
  app = listen(t.db, config)
})
afterAll(async () => {
  await app.close()
  await engine.stop()
  await echo.close()
  await t.close()
})

let n = 0
const signedIn = async () => {
  const b = browser(app.base)
  const r = await b.post('/api/auth/register', { email: `user${++n}@example.com`, password: 'correct horse' })
  expect(r.status).toBe(201)
  return b
}

const goodGraph = () =>
  graph([node('start', 'webhook'), node('call', 'http', { method: 'POST', url: `${echo.url}/hook`, body: '{{ trigger.body }}' })], [['start', 'call']])

describe('accounts', () => {
  it('registers, signs in, and knows who you are', async () => {
    const b = browser(app.base)
    const reg = await b.post('/api/auth/register', { email: 'Ada@Example.com', password: 'correct horse' })
    expect(reg.status).toBe(201)
    expect(reg.json.email).toBe('ada@example.com') // stored lowercase
    expect(b.jar.has(COOKIE)).toBe(true)
    expect((await b.get('/api/auth/me')).json.email).toBe('ada@example.com')

    await b.post('/api/auth/logout')
    expect(b.jar.has(COOKIE)).toBe(false)
    expect((await b.get('/api/auth/me')).status).toBe(401)

    const login = await b.post('/api/auth/login', { email: 'ada@example.com', password: 'correct horse' })
    expect(login.status).toBe(200)
    expect((await b.get('/api/auth/me')).status).toBe(200)
  })

  it('rejects bad input, duplicate emails and wrong passwords without saying which part was wrong', async () => {
    const b = browser(app.base)
    expect((await b.post('/api/auth/register', { email: 'nope', password: 'correct horse' })).status).toBe(400)
    expect((await b.post('/api/auth/register', { email: 'x@example.com', password: 'short' })).status).toBe(400)
    await b.post('/api/auth/register', { email: 'dup@example.com', password: 'correct horse' })
    expect((await browser(app.base).post('/api/auth/register', { email: 'DUP@example.com', password: 'another one' })).status).toBe(409)

    const wrongPw = await browser(app.base).post('/api/auth/login', { email: 'dup@example.com', password: 'wrong password' })
    const noUser = await browser(app.base).post('/api/auth/login', { email: 'ghost@example.com', password: 'wrong password' })
    expect(wrongPw.status).toBe(401)
    expect(noUser.status).toBe(401)
    expect(wrongPw.json.error).toBe(noUser.json.error)
  })

  it('never stores the password, and the cookie is httpOnly', async () => {
    const b = browser(app.base)
    const r = await b.raw('POST', '/api/auth/register', { email: 'cookie@example.com', password: 'correct horse' })
    expect(r.headers.getSetCookie()[0]).toMatch(/HttpOnly/i)
    const rows = (await t.db.execute((await import('drizzle-orm')).sql`select password_hash from users where email = 'cookie@example.com'`)).rows
    expect(String(rows[0]!.password_hash)).toMatch(/^\$2[aby]\$/)
    expect(String(rows[0]!.password_hash)).not.toContain('correct horse')
  })

  it('treats a forged or garbage cookie as signed out', async () => {
    const b = browser(app.base)
    b.jar.set(COOKIE, 'garbage')
    expect((await b.get('/api/workflows')).status).toBe(401)
    b.jar.set(COOKIE, forgeToken('some-other-secret-value-xx', '00000000-0000-0000-0000-000000000000'))
    expect((await b.get('/api/workflows')).status).toBe(401)
    expect((await browser(app.base).get('/api/workflows')).status).toBe(401)
  })
})

describe('workflows', () => {
  it('creates, lists, reads, renames and deletes', async () => {
    const b = await signedIn()
    const created = await b.post('/api/workflows', { name: 'Orders' })
    expect(created.status).toBe(201)
    expect(created.json.graph.nodes[0].type).toBe('webhook') // starts with a trigger
    expect(created.json.webhookPath).toMatch(/^\/hooks\/[\w-]{20,}$/)
    const id = created.json.id

    expect((await b.get('/api/workflows')).json).toHaveLength(1)
    expect((await b.get(`/api/workflows/${id}`)).json.name).toBe('Orders')
    expect((await b.put(`/api/workflows/${id}`, { name: 'Orders v2' })).json.name).toBe('Orders v2')
    expect((await b.del(`/api/workflows/${id}`)).status).toBe(200)
    expect((await b.get(`/api/workflows/${id}`)).status).toBe(404)
  })

  it('caps how many workflows one user can have', async () => {
    const b = await signedIn()
    for (let i = 0; i < 4; i++) expect((await b.post('/api/workflows', { name: `w${i}` })).status).toBe(201)
    const over = await b.post('/api/workflows', { name: 'one too many' })
    expect(over.status).toBe(403)
  })

  it('keeps each user inside their own workflows and runs', async () => {
    const alice = await signedIn()
    const bob = await signedIn()
    const wf = (await alice.post('/api/workflows', { name: 'private', graph: goodGraph() })).json
    const runId = (await alice.post(`/api/workflows/${wf.id}/run`, { payload: {} })).json.runId

    expect((await bob.get('/api/workflows')).json).toEqual([])
    for (const res of [
      await bob.get(`/api/workflows/${wf.id}`),
      await bob.put(`/api/workflows/${wf.id}`, { name: 'mine now' }),
      await bob.del(`/api/workflows/${wf.id}`),
      await bob.post(`/api/workflows/${wf.id}/run`, {}),
      await bob.get(`/api/workflows/${wf.id}/runs`),
      await bob.get(`/api/runs/${runId}`),
      await bob.get(`/api/runs/${runId}/events`),
    ]) expect(res.status).toBe(404) // not 403: Bob cannot even tell it exists
    expect((await alice.get(`/api/workflows/${wf.id}`)).json.name).toBe('private')
    expect((await alice.get(`/api/runs/${runId}`)).status).toBe(200)
  })

  it('answers 404 for ids that are not ids', async () => {
    const b = await signedIn()
    expect((await b.get('/api/workflows/not-a-uuid')).status).toBe(404)
    expect((await b.get('/api/runs/123')).status).toBe(404)
  })
})

describe('graph rules', () => {
  const save = async (b: Awaited<ReturnType<typeof signedIn>>, g: unknown) => {
    const wf = (await b.post('/api/workflows', { name: 'g' })).json
    return { id: wf.id as string, res: await b.put(`/api/workflows/${wf.id}`, { graph: g }) }
  }

  it('saves a draft with a loop but lists the problem and refuses to enable or run it', async () => {
    const b = await signedIn()
    const loop = graph([node('start', 'webhook'), node('a', 'delay'), node('b', 'delay')], [['start', 'a'], ['a', 'b'], ['b', 'a']])
    const { id, res } = await save(b, loop)
    expect(res.status).toBe(200)
    expect(res.json.problems).toContain('the workflow has a loop')
    expect(res.json.enabled).toBe(false)
    const enable = await b.put(`/api/workflows/${id}`, { enabled: true })
    expect(enable.status).toBe(422)
    expect(enable.json.details).toContain('the workflow has a loop')
    expect((await b.post(`/api/workflows/${id}/run`, {})).status).toBe(422)
  })

  it('reports a missing trigger, an unreachable step and bad expressions', async () => {
    const b = await signedIn()
    const noTrigger = await save(b, graph([node('a', 'delay')], []))
    expect(noTrigger.res.json.problems).toContain('add a webhook or schedule trigger')
    const orphan = await save(b, graph([node('start', 'webhook'), node('lonely', 'delay')], []))
    expect(orphan.res.json.problems).toContain('lonely is not connected to the trigger')
    const badExpr = await save(b, graph([node('start', 'webhook'), node('x', 'transform', { expression: 'a.' })], [['start', 'x']]))
    expect(badExpr.res.json.problems.some((p: string) => p.startsWith('x: expression'))).toBe(true)
  })

  it('rejects input that is not a graph at all', async () => {
    const b = await signedIn()
    const wf = (await b.post('/api/workflows', { name: 'g' })).json
    for (const bad of ['text', { nodes: 'x' }, { nodes: [{ id: 'a', key: 'a', type: 'teleport', position: { x: 0, y: 0 }, config: {} }], edges: [] }]) {
      const res = await b.put(`/api/workflows/${wf.id}`, { graph: bad })
      expect(res.status).toBe(400)
    }
    expect((await b.post('/api/workflows', { name: 'x', graph: { nodes: 5 } })).status).toBe(400)
  })

  it('limits how often a schedule may fire', async () => {
    const b = await signedIn()
    const every = (cron: string) => graph([node('tick', 'schedule', { cron }), node('w', 'delay')], [['tick', 'w']])
    const fast = await save(b, every('* * * * *'))
    expect(fast.res.json.problems.some((p: string) => p.includes('at most every 5 minutes'))).toBe(true)
    const ok = await save(b, every('*/10 * * * *'))
    expect(ok.res.json.problems).toEqual([])
    const enabled = await b.put(`/api/workflows/${ok.id}`, { enabled: true })
    expect(enabled.json.enabled).toBe(true)
    expect(new Date(enabled.json.nextRunAt).getTime()).toBeGreaterThan(Date.now())
    const off = await b.put(`/api/workflows/${ok.id}`, { enabled: false })
    expect(off.json.nextRunAt).toBeNull()
  })

  it('editing a graph into a broken one switches the workflow off', async () => {
    const b = await signedIn()
    const { id } = await save(b, goodGraph())
    expect((await b.put(`/api/workflows/${id}`, { enabled: true })).json.enabled).toBe(true)
    const broken = await b.put(`/api/workflows/${id}`, { graph: graph([node('a', 'delay')], []) })
    expect(broken.json.enabled).toBe(false)
  })
})

describe('running', () => {
  it('runs on demand and exposes every step through the api', async () => {
    const b = await signedIn()
    const wf = (await b.post('/api/workflows', { name: 'run me', graph: goodGraph() })).json
    const started = await b.post(`/api/workflows/${wf.id}/run`, { payload: { body: { hello: 'world' } } })
    expect(started.status).toBe(202)
    const view = await waitFor(async () => {
      const r = (await b.get(`/api/runs/${started.json.runId}`)).json
      return r.status !== 'running' ? r : false
    })
    expect(view.status).toBe('success')
    expect(view.trigger).toBe('manual')
    expect(view.steps.map((s: any) => s.key)).toEqual(['start', 'call']) // graph order
    expect(view.steps[1]).toMatchObject({ status: 'success', attempts: 1, output: { status: 200 } })
    expect((await b.get(`/api/workflows/${wf.id}/runs`)).json[0]).toMatchObject({ id: started.json.runId, status: 'success' })
    const list = (await b.get('/api/workflows')).json[0]
    expect(list).toMatchObject({ trigger: 'webhook', lastRun: { status: 'success' }, steps: ['webhook', 'http'] })
    expect(view.graph.nodes).toHaveLength(2) // the run page draws the graph the run started with
    const stats = (await b.get('/api/stats')).json
    expect(stats).toMatchObject({ runs24h: 1, succeeded24h: 1, failed24h: 0 })
    expect((await browser(app.base).get('/api/stats')).status).toBe(401)
  })

  it('streams run updates until the run finishes', async () => {
    const b = await signedIn()
    const g = graph([node('start', 'webhook'), node('pause', 'delay', { seconds: 1 }), node('end', 'transform', { expression: '"done"' })], [['start', 'pause'], ['pause', 'end']])
    const wf = (await b.post('/api/workflows', { name: 'slow', graph: g })).json
    const { runId } = (await b.post(`/api/workflows/${wf.id}/run`, {})).json

    const res = await fetch(`${app.base}/api/runs/${runId}/events`, { headers: { cookie: `${COOKIE}=${b.jar.get(COOKIE)}` } })
    expect(res.headers.get('content-type')).toContain('text/event-stream')
    const events: any[] = []
    const reader = res.body!.getReader()
    const dec = new TextDecoder()
    let buf = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buf += dec.decode(value)
      for (const part of buf.split('\n\n').slice(0, -1)) events.push(JSON.parse(part.replace(/^data: /, '')))
      buf = buf.slice(buf.lastIndexOf('\n\n') + 2)
    }
    expect(events.length).toBeGreaterThanOrEqual(2)
    expect(events[0].status).toBe('running')
    expect(events.at(-1).status).toBe('success')
    expect(events.some((e) => e.steps.some((s: any) => s.key === 'pause' && s.status === 'waiting'))).toBe(true)
  })
})

describe('webhooks', () => {
  const setup = async (g = goodGraph(), enable = true) => {
    const b = await signedIn()
    const wf = (await b.post('/api/workflows', { name: 'hook', graph: g })).json
    if (enable) await b.put(`/api/workflows/${wf.id}`, { enabled: true })
    return { b, wf, url: wf.webhookPath as string }
  }
  const call = (path: string, body?: string, headers: Record<string, string> = {}, method = 'POST') =>
    fetch(app.base + path, { method, body, headers })

  it('starts a run from a POST and hands the body to the workflow', async () => {
    const { b, wf, url } = await setup()
    const res = await call(url, JSON.stringify({ order: 7 }), { 'content-type': 'application/json', authorization: 'Bearer secret', 'x-source': 'shop' })
    expect(res.status).toBe(202)
    const { runId } = (await res.json()) as { runId: string }
    const done = await waitFor(async () => {
      const r = (await b.get(`/api/runs/${runId}`)).json
      return r.status !== 'running' ? r : false
    })
    expect(done.status).toBe('success')
    expect(done.trigger).toBe('webhook')
    expect(done.payload.body).toEqual({ order: 7 })
    expect(done.payload.headers['x-source']).toBe('shop')
    expect(done.payload.headers.authorization).toBeUndefined() // never stored
    expect(JSON.parse(echo.hits.at(-1)!.body)).toEqual({ order: 7 })
    expect((await b.get(`/api/workflows/${wf.id}/runs`)).json).toHaveLength(1)
  })

  it('accepts query strings, plain text and an empty body', async () => {
    const { b, url } = await setup()
    const text = await call(`${url}?src=a`, 'just text', { 'content-type': 'text/plain' })
    const { runId } = (await text.json()) as { runId: string }
    const run = (await b.get(`/api/runs/${runId}`)).json
    expect(run.payload).toMatchObject({ body: 'just text', query: { src: 'a' }, method: 'POST' })
    expect((await call(url, undefined, {}, 'GET')).status).toBe(202)
  })

  it('answers 404 for a disabled workflow, an unknown token, and a schedule-only workflow', async () => {
    const off = await setup(goodGraph(), false)
    expect((await call(off.url, '{}')).status).toBe(404)
    expect((await call('/hooks/not-a-real-token', '{}')).status).toBe(404)
    const sched = await setup(graph([node('tick', 'schedule', { cron: '*/10 * * * *' }), node('w', 'delay')], [['tick', 'w']]))
    expect((await call(sched.url, '{}')).status).toBe(404)
  })

  it('rejects a body that claims to be JSON and is not', async () => {
    const { url } = await setup()
    expect((await call(url, '{oops', { 'content-type': 'application/json' })).status).toBe(400)
  })

  it('turns away oversize bodies', async () => {
    const { url } = await setup()
    expect((await call(url, 'x'.repeat(200_000), { 'content-type': 'text/plain' })).status).toBe(413)
  })

  it('rate limits a noisy caller', async () => {
    const small = listen(t.db, config, { hooks: 3 })
    try {
      const b = browser(small.base)
      await b.post('/api/auth/register', { email: `rl${++n}@example.com`, password: 'correct horse' })
      const wf = (await b.post('/api/workflows', { name: 'rl', graph: goodGraph() })).json
      await b.put(`/api/workflows/${wf.id}`, { enabled: true })
      const codes: number[] = []
      for (let i = 0; i < 5; i++) codes.push((await fetch(small.base + wf.webhookPath, { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } })).status)
      expect(codes.slice(0, 3)).toEqual([202, 202, 202])
      expect(codes.slice(3)).toEqual([429, 429])
    } finally {
      await small.close()
    }
  })

  it('rate limits login attempts', async () => {
    const small = listen(t.db, config, { auth: 3 })
    try {
      const codes: number[] = []
      for (let i = 0; i < 5; i++) codes.push((await browser(small.base).post('/api/auth/login', { email: 'a@example.com', password: 'whatever12' })).status)
      expect(codes).toEqual([401, 401, 401, 429, 429])
    } finally {
      await small.close()
    }
  })
})

describe('housekeeping', () => {
  it('keeps only the newest runs of each workflow and never touches a run in progress', async () => {
    const wf = await seedWorkflow(t.db, await seedUser(t.db), graph([node('start', 'webhook')], []))
    const ids: string[] = []
    for (let i = 0; i < 8; i++) ids.push(await startRun(t.db, wf, 'manual', { i }))
    const inProgress = await seedWorkflow(t.db, await seedUser(t.db), graph([node('start', 'webhook'), node('w', 'delay', { seconds: 600 })], [['start', 'w']]))
    const pending = await startRun(t.db, inProgress, 'manual', {})
    await new Promise((r) => setTimeout(r, 50))

    expect(await pruneRuns(t.db, 3)).toBe(5)
    const left = (await t.db.select({ id: runs.id }).from(runs)).map((r) => r.id)
    expect(ids.filter((id) => left.includes(id))).toHaveLength(3)
    expect(left).toContain(pending)
    await waitRunDone(t.db, ids[7]!)
  })
})
