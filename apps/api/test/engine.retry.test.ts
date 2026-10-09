import { afterAll, beforeAll, expect, it } from 'vitest'
import { createEngine, startRun } from '../src/engine/index.js'
import { backoffMs } from '../src/engine/runner.js'
import { graph, node, seedUser, seedWorkflow, waitRunDone } from './engine-helpers.js'
import { newDatabase, testConfig, testServer } from './helpers.js'

let t: Awaited<ReturnType<typeof newDatabase>>
let engine: ReturnType<typeof createEngine>
let strictEngine: ReturnType<typeof createEngine>
const servers: Awaited<ReturnType<typeof testServer>>[] = []

beforeAll(async () => {
  t = await newDatabase()
  engine = createEngine(t.db, testConfig({ retryBaseMs: 80 }))
  engine.startWorkers(2)
})
afterAll(async () => {
  await engine.stop()
  await strictEngine?.stop()
  for (const s of servers) await s.close()
  await t.close()
})

const flow = (url: string, retries?: number) =>
  graph([node('start', 'webhook'), node('call', 'http', { url, ...(retries === undefined ? {} : { retries }) }), node('after', 'transform', { expression: '"done"' })], [['start', 'call'], ['call', 'after']])

const go = async (g: ReturnType<typeof flow>) => {
  const wf = await seedWorkflow(t.db, await seedUser(t.db), g)
  return waitRunDone(t.db, await startRun(t.db, wf, 'manual', {}))
}

it('retries a 503 with growing waits and succeeds on the third attempt', async () => {
  const times: number[] = []
  const srv = await testServer((_hit, n, res) => {
    times.push(Date.now())
    if (n <= 2) { res.statusCode = 503; res.end('busy'); return true }
  })
  servers.push(srv)
  const { run, steps } = await go(flow(srv.url, 2))
  expect(run.status).toBe('success')
  expect(steps.call).toMatchObject({ status: 'success', attempts: 3, error: null })
  expect(steps.after!.status).toBe('success')
  const gap1 = times[1]! - times[0]!
  const gap2 = times[2]! - times[1]!
  // Only lower bounds: a busy machine can make a wait longer, never shorter.
  expect(gap1).toBeGreaterThanOrEqual(70) // about 1x the 80 ms base
  expect(gap2).toBeGreaterThanOrEqual(150) // about 2x
})

it('the wait doubles with every attempt and stops growing at five minutes', () => {
  expect([1, 2, 3, 4].map((a) => backoffMs(a, 1000))).toEqual([1000, 2000, 4000, 8000])
  expect(backoffMs(20, 1000)).toBe(300_000)
  expect(backoffMs(1, 80)).toBe(80)
})

it('gives up when the retries run out and fails the run', async () => {
  const srv = await testServer((_h, _n, res) => { res.statusCode = 500; res.end('nope'); return true })
  servers.push(srv)
  const { run, steps } = await go(flow(srv.url, 1))
  expect(srv.hits).toHaveLength(2) // first try plus one retry
  expect(run.status).toBe('failed')
  expect(run.error).toBe('call: HTTP 500')
  expect(steps.call).toMatchObject({ status: 'failed', attempts: 2, error: 'HTTP 500' })
  expect(steps.after!.status).toBe('skipped')
  // a failed step still shows what it sent and the last answer it got
  expect(steps.call!.input).toMatchObject({ method: 'GET', url: srv.url })
  expect(steps.call!.output).toMatchObject({ status: 500, ok: false, body: 'nope' })
})

it('retries=0 means one attempt', async () => {
  const srv = await testServer((_h, _n, res) => { res.statusCode = 502; res.end(); return true })
  servers.push(srv)
  const { run, steps } = await go(flow(srv.url, 0))
  expect(srv.hits).toHaveLength(1)
  expect(run.status).toBe('failed')
  expect(steps.call!.attempts).toBe(1)
})

it('treats a 4xx as an answer, not a failure: the step succeeds with ok=false so a filter can react', async () => {
  const srv = await testServer((_h, _n, res) => { res.statusCode = 404; res.setHeader('content-type', 'application/json'); res.end('{"error":"missing"}'); return true })
  servers.push(srv)
  const { run, steps } = await go(flow(srv.url, 3))
  expect(srv.hits).toHaveLength(1)
  expect(run.status).toBe('success')
  expect(steps.call!.output).toMatchObject({ status: 404, ok: false, body: { error: 'missing' } })
})

it('retries a refused connection, then fails with the reason', async () => {
  const srv = await testServer()
  const dead = srv.url
  await srv.close()
  const { run, steps } = await go(flow(dead, 1))
  expect(run.status).toBe('failed')
  expect(steps.call!.attempts).toBe(2)
  expect(steps.call!.error).toMatch(/ECONNREFUSED/)
})

it('does not retry a bad URL', async () => {
  const { run, steps } = await go(flow('not a url', 3))
  expect(run.status).toBe('failed')
  expect(steps.call!.attempts).toBe(1)
  expect(steps.call!.error).toMatch(/not a valid URL/)
})

it('does not retry a blocked address, and never connects to it', async () => {
  const srv = await testServer()
  servers.push(srv)
  strictEngine = createEngine(t.db, testConfig({ allowPrivateHttp: false }))
  await engine.stop() // only the strict engine should pick up this run
  strictEngine.startWorkers(1)
  const { run, steps } = await go(flow(`${srv.url}/secret`, 3))
  expect(run.status).toBe('failed')
  expect(steps.call!.attempts).toBe(1)
  expect(steps.call!.error).toMatch(/blocked/)
  expect(steps.call!.input).toMatchObject({ url: `${srv.url}/secret` }) // the request is kept even though it never left
  expect(srv.hits).toHaveLength(0)
})
