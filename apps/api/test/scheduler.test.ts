import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { nextRun } from '@relay/shared'
import { runs, workflows } from '../src/db/schema.js'
import { createEngine, nextRunAt, tickScheduler } from '../src/engine/index.js'
import { graph, node, seedUser, seedWorkflow, waitRunDone } from './engine-helpers.js'
import { newDatabase, testConfig, waitFor } from './helpers.js'

let t: Awaited<ReturnType<typeof newDatabase>>
let userId: string
const engines: ReturnType<typeof createEngine>[] = []
beforeAll(async () => { t = await newDatabase(); userId = await seedUser(t.db) })
afterAll(async () => { for (const e of engines) await e.stop(); await t.close() })

const g = (cron = '*/5 * * * *') => graph([node('tick', 'schedule', { cron }), node('work', 'transform', { expression: '"ran"' })], [['tick', 'work']])
const runsOf = (id: string) => t.db.select().from(runs).where(eq(runs.workflowId, id))
const nextOf = async (id: string) => (await t.db.select().from(workflows).where(eq(workflows.id, id)))[0]!.nextRunAt

it('nextRunAt is only set for an enabled workflow with a schedule trigger', () => {
  const from = new Date('2026-10-09T10:02:00Z')
  expect(nextRunAt(g('*/5 * * * *'), true, from)?.toISOString()).toBe('2026-10-09T10:05:00.000Z')
  expect(nextRunAt(g(), false, from)).toBeNull()
  expect(nextRunAt(graph([node('hook', 'webhook')], []), true, from)).toBeNull()
})

it('starts a due workflow once and moves next_run_at into the future', async () => {
  const now = new Date('2026-10-09T10:07:30Z')
  const wf = await seedWorkflow(t.db, userId, g(), { enabled: true, nextRunAt: new Date('2026-10-09T10:05:00Z') })

  expect(await tickScheduler(t.db, now)).toBe(1)
  const [run] = await runsOf(wf.id)
  expect(run).toMatchObject({ trigger: 'schedule', status: 'running' })
  expect(run!.payload).toMatchObject({ scheduledFor: '2026-10-09T10:05:00.000Z', firedAt: now.toISOString() })
  expect((await nextOf(wf.id))!.toISOString()).toBe('2026-10-09T10:10:00.000Z')

  expect(await tickScheduler(t.db, now)).toBe(0) // same moment again: nothing is due
  expect(await runsOf(wf.id)).toHaveLength(1)
})

it('ignores disabled workflows and ones that are not due yet', async () => {
  const now = new Date('2026-10-09T10:07:30Z')
  const off = await seedWorkflow(t.db, userId, g(), { enabled: false, nextRunAt: new Date('2026-10-09T10:00:00Z') })
  const later = await seedWorkflow(t.db, userId, g(), { enabled: true, nextRunAt: new Date('2026-10-09T10:30:00Z') })
  await tickScheduler(t.db, now)
  expect(await runsOf(off.id)).toHaveLength(0)
  expect(await runsOf(later.id)).toHaveLength(0)
})

it('after downtime it runs once and skips ahead instead of replaying every missed slot', async () => {
  const now = new Date('2026-10-09T10:07:30Z')
  const wf = await seedWorkflow(t.db, userId, g('* * * * *'), { enabled: true, nextRunAt: new Date('2026-10-06T00:00:00Z') })
  await tickScheduler(t.db, now)
  expect(await runsOf(wf.id)).toHaveLength(1)
  expect((await nextOf(wf.id))!.toISOString()).toBe(nextRun('* * * * *', now).toISOString())
})

it('three schedulers ticking at the same time start the workflow only once', async () => {
  const now = new Date('2026-10-09T10:07:30Z')
  const wf = await seedWorkflow(t.db, userId, g(), { enabled: true, nextRunAt: new Date('2026-10-09T10:05:00Z') })
  const counts = await Promise.all([tickScheduler(t.db, now), tickScheduler(t.db, now), tickScheduler(t.db, now)])
  expect(counts.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(1)
  expect(await runsOf(wf.id)).toHaveLength(1)
})

it('the running scheduler and workers carry a due workflow all the way through', async () => {
  const wf = await seedWorkflow(t.db, userId, g('* * * * *'), { enabled: true, nextRunAt: new Date(Date.now() - 1000) })
  const eng = createEngine(t.db, testConfig())
  engines.push(eng)
  eng.startWorkers(1)
  eng.startScheduler()
  const run = await waitFor(async () => (await runsOf(wf.id))[0], 5000, 'scheduled run')
  const done = await waitRunDone(t.db, run.id)
  expect(done.run.status).toBe('success')
  expect(done.steps.work!.output).toBe('ran')
  expect((await nextOf(wf.id))!.getTime()).toBeGreaterThan(Date.now())
})
