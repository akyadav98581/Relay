import { and, eq, inArray, sql } from 'drizzle-orm'
import { isRunFinished, isTrigger, planNext, type Graph, type StepState, type StepStatus } from '@relay/shared'
import { runSteps, runs } from '../db/schema.js'
import type { Db, Exec } from '../db/index.js'
import { enqueue } from './queue.js'

export type TriggerKind = 'webhook' | 'schedule' | 'manual'

const MAX_OUTPUT_CHARS = 100_000

// Keeps one huge response from filling the database.
export function capJson(value: unknown): unknown {
  if (value === undefined) return null
  const text = JSON.stringify(value)
  if (text === undefined || text.length <= MAX_OUTPUT_CHARS) return value ?? null
  return { _truncated: true, preview: text.slice(0, MAX_OUTPUT_CHARS) }
}

// Create a run and queue whatever can start right away. Call it inside a transaction when the
// caller holds locks (the scheduler does), or use startRun for a standalone one.
export async function startRunIn(exec: Exec, wf: { id: string; graph: Graph }, trigger: TriggerKind, payload: unknown): Promise<string> {
  const [run] = await exec.insert(runs).values({ workflowId: wf.id, trigger, payload: capJson(payload), graph: wf.graph }).returning({ id: runs.id })
  const runId = run!.id
  const now = new Date()
  await exec.insert(runSteps).values(
    wf.graph.nodes.map((n) => ({
      runId,
      nodeId: n.id,
      key: n.key,
      type: n.type,
      status: isTrigger(n.type) ? 'success' : 'pending',
      output: isTrigger(n.type) ? capJson(payload) : null,
      startedAt: isTrigger(n.type) ? now : null,
      finishedAt: isTrigger(n.type) ? now : null,
    })),
  )
  await advance(exec, runId, wf.graph)
  return runId
}

export const startRun = (db: Db, wf: { id: string; graph: Graph }, trigger: TriggerKind, payload: unknown) =>
  db.transaction((tx) => startRunIn(tx, wf, trigger, payload))

export async function loadStates(exec: Exec, runId: string): Promise<Map<string, StepState>> {
  const rows = await exec.select({ nodeId: runSteps.nodeId, status: runSteps.status, output: runSteps.output }).from(runSteps).where(eq(runSteps.runId, runId))
  return new Map(rows.map((r) => [r.nodeId, { status: r.status as StepStatus, output: r.output }]))
}

// Look at the run, queue the steps that became ready, skip the ones that never will run,
// and close the run when nothing is left. Callers hold the run's row lock, so two steps
// that finish at the same moment cannot both queue the step after them.
export async function advance(exec: Exec, runId: string, graph: Graph) {
  const states = await loadStates(exec, runId)
  const { toRun, toSkip } = planNext(graph, states)
  const now = new Date()
  if (toSkip.length) {
    await exec.update(runSteps).set({ status: 'skipped', finishedAt: now }).where(and(eq(runSteps.runId, runId), inArray(runSteps.nodeId, toSkip)))
    for (const id of toSkip) states.set(id, { status: 'skipped' })
  }
  if (toRun.length) {
    await exec.update(runSteps).set({ status: 'queued' }).where(and(eq(runSteps.runId, runId), inArray(runSteps.nodeId, toRun)))
    for (const id of toRun) {
      await enqueue(exec, runId, id)
      states.set(id, { status: 'queued' })
    }
  }
  if (isRunFinished(states)) {
    const failed = [...states.values()].some((s) => s.status === 'failed')
    await exec.update(runs).set({ status: failed ? 'failed' : 'success', finishedAt: now }).where(and(eq(runs.id, runId), eq(runs.status, 'running')))
  }
}

export const lockRun = (exec: Exec, runId: string) => exec.execute(sql`select id from runs where id = ${runId} for update`)
