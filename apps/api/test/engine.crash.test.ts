import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { jobs } from '../src/db/schema.js'
import { claimJob, createEngine, processJob, startRun } from '../src/engine/index.js'
import { createSandbox } from '../src/sandbox.js'
import { getRun, graph, jobsFor, node, seedUser, seedWorkflow, waitRunDone } from './engine-helpers.js'
import { newDatabase, testConfig, waitFor } from './helpers.js'

let t: Awaited<ReturnType<typeof newDatabase>>
const engines: ReturnType<typeof createEngine>[] = []
const sandbox = createSandbox({ size: 1 })
beforeAll(async () => { t = await newDatabase() })
afterAll(async () => { for (const e of engines) await e.stop(); await sandbox.close(); await t.close() })

const g = graph([node('start', 'webhook'), node('work', 'transform', { expression: '"ok"' })], [['start', 'work']])

it('a job whose worker died is picked up again after the lock expires, and not before', async () => {
  const wf = await seedWorkflow(t.db, await seedUser(t.db), g)
  const runId = await startRun(t.db, wf, 'manual', {})

  // a worker claims the job and then vanishes without reporting back
  const claimed = await claimJob(t.db, 'dead-worker', 2500)
  expect(claimed).toMatchObject({ runId, nodeId: 'n_work' })

  const eng = createEngine(t.db, testConfig({ lockMs: 2500 }))
  eng.startWorkers(2)

  await new Promise((r) => setTimeout(r, 300))
  expect((await getRun(t.db, runId)).run.status).toBe('running') // lock still fresh, nobody touches it
  expect((await jobsFor(t.db, runId))[0]!.lockedBy).toBe('dead-worker')

  const { run, steps } = await waitRunDone(t.db, runId, 10_000)
  expect(run.status).toBe('success')
  expect(steps.work).toMatchObject({ status: 'success', output: 'ok' })
  expect(await jobsFor(t.db, runId)).toHaveLength(0)
  // This engine has to stop now. If it kept running it would steal the jobs of the tests below,
  // which claim and process jobs by hand.
  await eng.stop()
})

it('a slow worker that lost its lock cannot overwrite the result of the one that took over', async () => {
  const wf = await seedWorkflow(t.db, await seedUser(t.db), g)
  const runId = await startRun(t.db, wf, 'manual', {})
  const cfg = testConfig()
  const job = (await claimJob(t.db, 'slow', 60_000))!

  let release!: () => void
  const gate = new Promise<void>((r) => (release = r))
  const slowDeps = { db: t.db, config: cfg, workerId: 'slow', evaluate: async () => { await gate; return 'late answer' } }
  const slowRun = processJob(slowDeps, job)

  // while it is stuck, its lock is taken over by another worker
  await waitFor(async () => (await getRun(t.db, runId)).steps.work?.status === 'running', 3000)
  await t.db.update(jobs).set({ lockedBy: 'fast' }).where(eq(jobs.id, job.id))
  release()
  await slowRun

  const after = await getRun(t.db, runId)
  expect(after.steps.work!.status).toBe('running') // the slow worker wrote nothing
  expect(after.run.status).toBe('running')
  expect((await jobsFor(t.db, runId))[0]).toMatchObject({ lockedBy: 'fast' })

  // the new owner finishes the step for real
  await processJob({ db: t.db, config: cfg, workerId: 'fast', evaluate: sandbox.evaluate }, job)
  const done = await getRun(t.db, runId)
  expect(done.run.status).toBe('success')
  expect(done.steps.work!.output).toBe('ok')
  expect(done.steps.work!.attempts).toBe(2) // both workers started it, only one result counted
})

it('a job for a run that already ended is dropped quietly', async () => {
  const wf = await seedWorkflow(t.db, await seedUser(t.db), g)
  const runId = await startRun(t.db, wf, 'manual', {})
  const job = (await claimJob(t.db, 'w', 60_000))!
  await t.db.execute((await import('drizzle-orm')).sql`update runs set status = 'failed' where id = ${runId}`)
  await processJob({ db: t.db, config: testConfig(), workerId: 'w', evaluate: sandbox.evaluate }, job)
  expect(await t.db.select().from(jobs).where(and(eq(jobs.id, job.id)))).toHaveLength(0)
})
