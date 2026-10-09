import { afterAll, beforeAll, expect, it } from 'vitest'
import { createEngine, startRun } from '../src/engine/index.js'
import { jobsFor, getRun, graph, node, seedUser, seedWorkflow, waitRunDone } from './engine-helpers.js'
import { newDatabase, testConfig, testServer } from './helpers.js'

let t: Awaited<ReturnType<typeof newDatabase>>
let srv: Awaited<ReturnType<typeof testServer>>
let engine: ReturnType<typeof createEngine>

beforeAll(async () => {
  t = await newDatabase()
  srv = await testServer()
  engine = createEngine(t.db, testConfig())
  engine.startWorkers(2)
})
afterAll(async () => {
  await engine.stop()
  await srv.close()
  await t.close()
})

it('runs webhook -> transform -> http and keeps every step input and output', async () => {
  const g = graph(
    [
      node('start', 'webhook'),
      node('calc', 'transform', { expression: '{ "id": trigger.id * 2, "who": trigger.name }' }),
      node('call', 'http', {
        method: 'POST',
        url: `${srv.url}/orders/{{ trigger.id }}`,
        headers: { 'X-Token': 'abc{{ trigger.id }}', Authorization: 'Bearer top-secret', Accept: 'application/json' },
        body: '{{ steps.calc }}',
      }),
    ],
    [['start', 'calc'], ['calc', 'call']],
  )
  const wf = await seedWorkflow(t.db, await seedUser(t.db), g)
  const runId = await startRun(t.db, wf, 'webhook', { id: 21, name: 'Ada' })
  const { run, steps } = await waitRunDone(t.db, runId)

  expect(run.status).toBe('success')
  expect(run.finishedAt).toBeTruthy()
  expect(steps.start).toMatchObject({ status: 'success', output: { id: 21, name: 'Ada' } })
  expect(steps.calc).toMatchObject({ status: 'success', output: { id: 42, who: 'Ada' }, attempts: 1 })

  // what the server actually received
  expect(srv.hits).toHaveLength(1)
  expect(srv.hits[0]!.url).toBe('/orders/21')
  expect(JSON.parse(srv.hits[0]!.body)).toEqual({ id: 42, who: 'Ada' })
  expect(srv.hits[0]!.headers['x-token']).toBe('abc21')
  expect(srv.hits[0]!.headers['content-type']).toBe('application/json')
  expect(srv.hits[0]!.headers.authorization).toBe('Bearer top-secret')

  // what we stored: secret-looking headers are masked, the rest is kept, output has the response
  const call = steps.call!
  expect(call.status).toBe('success')
  expect(call.input).toMatchObject({ method: 'POST', url: `${srv.url}/orders/21`, headers: { Authorization: '***', 'X-Token': '***', Accept: 'application/json' } })
  expect(call.output).toMatchObject({ status: 200, ok: true, body: { ok: true, echo: { id: 42, who: 'Ada' } } })
  expect(await jobsFor(t.db, runId)).toHaveLength(0)
})

it('a transform error fails the run with a readable message and skips what follows', async () => {
  const g = graph(
    [node('start', 'webhook'), node('bad', 'transform', { expression: '$number("abc")' }), node('after', 'transform', { expression: '1' })],
    [['start', 'bad'], ['bad', 'after']],
  )
  const wf = await seedWorkflow(t.db, await seedUser(t.db), g)
  const { run, steps } = await waitRunDone(t.db, await startRun(t.db, wf, 'manual', {}))
  expect(run.status).toBe('failed')
  expect(run.error).toMatch(/^bad:/)
  expect(steps.bad).toMatchObject({ status: 'failed', attempts: 1 })
  expect(steps.after!.status).toBe('skipped')
})

it('a workflow that is only a trigger finishes at once', async () => {
  const wf = await seedWorkflow(t.db, await seedUser(t.db), graph([node('start', 'webhook')], []))
  const runId = await startRun(t.db, wf, 'manual', { hello: 1 })
  expect((await getRun(t.db, runId)).run.status).toBe('success')
})

it('a run keeps the graph it started with when the workflow is edited later', async () => {
  const g = graph([node('start', 'webhook'), node('a', 'transform', { expression: '"v1"' })], [['start', 'a']])
  const wf = await seedWorkflow(t.db, await seedUser(t.db), g)
  const runId = await startRun(t.db, wf, 'manual', {})
  const { run } = await getRun(t.db, runId)
  expect(run.graph).toEqual(g)
})
