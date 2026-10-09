import { sql } from 'drizzle-orm'
import { nextRun, type Graph } from '@relay/shared'
import type { Db } from '../db/index.js'
import { startRunIn } from './runs.js'

const cronOf = (graph: Graph): string | null => {
  const n = graph.nodes.find((x) => x.type === 'schedule')
  return n ? String((n.config as { cron: string }).cron) : null
}

// When a workflow should next fire, or null if it should not fire on its own.
export function nextRunAt(graph: Graph, enabled: boolean, from = new Date()): Date | null {
  const cron = cronOf(graph)
  return enabled && cron ? nextRun(cron, from) : null
}

// Start every workflow whose time has come. If the server was down for a while we run once
// and jump ahead, we do not replay every missed slot.
export async function tickScheduler(db: Db, now = new Date()): Promise<number> {
  return db.transaction(async (tx) => {
    const due = (
      await tx.execute(sql`
        select id, graph, next_run_at as "nextRunAt" from workflows
        where enabled and next_run_at is not null and next_run_at <= ${now}
        order by next_run_at limit 50
        for update skip locked`)
    ).rows as { id: string; graph: Graph; nextRunAt: Date }[]
    for (const wf of due) {
      const cron = cronOf(wf.graph)
      await startRunIn(tx, wf, 'schedule', { scheduledFor: new Date(wf.nextRunAt).toISOString(), firedAt: now.toISOString() })
      await tx.execute(sql`update workflows set next_run_at = ${cron ? nextRun(cron, now) : null} where id = ${wf.id}`)
    }
    return due.length
  })
}

// Keeps the newest `keep` runs of every workflow. Without this the database only grows.
export async function pruneRuns(db: Db, keep: number): Promise<number> {
  const res = await db.execute(sql`
    delete from runs where id in (
      select id from (
        select id, row_number() over (partition by workflow_id order by started_at desc, id desc) as rn from runs
        where status <> 'running'
      ) ranked where rn > ${keep}
    )`)
  return res.rowCount ?? 0
}

export function startScheduler(db: Db, everyMs: number, keepRuns = 100) {
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let lastPrune = 0
  const loop = async () => {
    if (stopped) return
    try {
      await tickScheduler(db)
      if (Date.now() - lastPrune > 3_600_000) { lastPrune = Date.now(); await pruneRuns(db, keepRuns) }
    } catch (err) { console.error('scheduler error:', (err as Error).message) }
    timer = setTimeout(loop, everyMs)
  }
  timer = setTimeout(loop, 0)
  return { stop() { stopped = true; clearTimeout(timer) } }
}
