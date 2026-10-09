import { asc, eq } from 'drizzle-orm'
import { randomBytes } from 'node:crypto'
import type { Graph } from '@relay/shared'
import { jobs, runSteps, runs, users, workflows } from '../src/db/schema.js'
import type { Db } from '../src/db/index.js'
import { waitFor } from './helpers.js'

export { edge, graph, node } from '../../../packages/shared/test/helpers.js'

export async function seedUser(db: Db, email = `u${Math.random().toString(36).slice(2, 8)}@test.dev`) {
  const [u] = await db.insert(users).values({ email, passwordHash: 'x' }).returning({ id: users.id })
  return u!.id
}

export async function seedWorkflow(db: Db, userId: string, graph: Graph, over: Partial<typeof workflows.$inferInsert> = {}) {
  const [w] = await db
    .insert(workflows)
    .values({ userId, name: 'test', graph, webhookToken: randomBytes(12).toString('hex'), ...over })
    .returning()
  return w!
}

export async function getRun(db: Db, runId: string) {
  const [run] = await db.select().from(runs).where(eq(runs.id, runId))
  const steps = await db.select().from(runSteps).where(eq(runSteps.runId, runId)).orderBy(asc(runSteps.key))
  return { run: run!, steps: Object.fromEntries(steps.map((s) => [s.key, s])) }
}

export const jobsFor = (db: Db, runId: string) => db.select().from(jobs).where(eq(jobs.runId, runId))

export const waitRunDone = (db: Db, runId: string, ms = 10_000) =>
  waitFor(async () => {
    const r = await getRun(db, runId)
    return r.run.status !== 'running' ? r : false
  }, ms, `run ${runId} to finish`)
