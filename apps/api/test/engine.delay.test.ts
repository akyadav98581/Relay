import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { jobs } from '../src/db/schema.js'
import { createEngine, startRun } from '../src/engine/index.js'
import { getRun, graph, jobsFor, node, seedUser, seedWorkflow, waitRunDone } from './engine-helpers.js'
import { newDatabase, testConfig, waitFor } from './helpers.js'

let t: Awaited<ReturnType<typeof newDatabase>>
const engines: ReturnType<typeof createEngine>[] = []
beforeAll(async () => { t = await newDatabase() })
afterAll(async () => { for (const e of engines) await e.stop(); await t.close() })

const g = graph(
  [node('start', 'webhook'), node('before', 'transform', { expression: '"b"' }), node('pause', 'delay', { seconds: 1 }), node('after', 'transform', { expression: '"a"' })],
  [['start', 'before'], ['before', 'pause'], ['pause', 'after']],
)

it('a delay survives a restart: it waits as a queued job, not as a sleeping process', async () => {
  const wf = await seedWorkflow(t.db, await seedUser(t.db), g)

  const first = createEngine(t.db, testConfig())
  engines.push(first)
  first.startWorkers(1)
  const t0 = Date.now()
  const runId = await startRun(t.db, wf, 'manual', {})
  await waitFor(async () => (await getRun(t.db, runId)).steps.pause?.status === 'waiting', 5000, 'delay to start waiting')

  // the whole process goes away mid-delay
  await first.stop()
  const mid = await getRun(t.db, runId)
  expect(mid.run.status).toBe('running')
  const [job] = await jobsFor(t.db, runId)
  expect(job).toMatchObject({ nodeId: 'n_pause', status: 'queued', lockedBy: null })
  expect(job!.runAt.getTime()).toBeGreaterThan(Date.now() - 50) // due in the future
  expect(mid.steps.after!.status).toBe('pending')

  // a new process picks it up and finishes the run after the delay has passed
  const second = createEngine(t.db, testConfig())
  engines.push(second)
  second.startWorkers(1)
  const { run, steps } = await waitRunDone(t.db, runId)
  expect(run.status).toBe('success')
  expect(steps.pause).toMatchObject({ status: 'success', attempts: 1, output: { waitedSeconds: 1 } })
  expect(Date.now() - t0).toBeGreaterThanOrEqual(1000)
  expect(steps.after!.finishedAt!.getTime() - steps.pause!.startedAt!.getTime()).toBeGreaterThanOrEqual(950)
})

it('the step after a delay does not start early', async () => {
  const wf = await seedWorkflow(t.db, await seedUser(t.db), g)
  const eng = createEngine(t.db, testConfig())
  engines.push(eng)
  eng.startWorkers(2)
  const runId = await startRun(t.db, wf, 'manual', {})
  await waitFor(async () => (await getRun(t.db, runId)).steps.pause?.status === 'waiting', 5000)
  await new Promise((r) => setTimeout(r, 400))
  const r = await getRun(t.db, runId)
  expect(r.steps.after!.status).toBe('pending')
  expect(r.run.status).toBe('running')
  await waitRunDone(t.db, runId)
})

it('many delays at once do not hold workers up', async () => {
  const wf = await seedWorkflow(t.db, await seedUser(t.db), graph([node('start', 'webhook'), node('p', 'delay', { seconds: 1 })], [['start', 'p']]))
  const eng = createEngine(t.db, testConfig())
  engines.push(eng)
  eng.startWorkers(1) // one worker, ten sleeping runs
  const t0 = Date.now()
  const ids = await Promise.all(Array.from({ length: 10 }, () => startRun(t.db, wf, 'manual', {})))
  await Promise.all(ids.map((id) => waitRunDone(t.db, id, 8000)))
  expect(Date.now() - t0).toBeLessThan(7000) // ten sequential sleeps would take at least 10 s
  void jobs; void eq
})
