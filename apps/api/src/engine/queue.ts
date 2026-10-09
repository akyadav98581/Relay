import { sql } from 'drizzle-orm'
import type { Db, Exec } from '../db/index.js'

export type ClaimedJob = { id: number; runId: string; nodeId: string }

// Take the next job that is due. SKIP LOCKED means workers never wait on each other and two
// workers never get the same row. A job still marked running whose lock is older than lockMs
// belongs to a worker that died, so it is up for grabs again.
export async function claimJob(db: Db, workerId: string, lockMs: number): Promise<ClaimedJob | null> {
  const res = await db.execute(sql`
    with next as (
      select id from jobs
      where (status = 'queued' and run_at <= now())
         or (status = 'running' and locked_at < now() - make_interval(secs => ${lockMs / 1000}))
      order by run_at, id
      limit 1
      for update skip locked
    )
    update jobs j
       set status = 'running', locked_at = now(), locked_by = ${workerId}
      from next
     where j.id = next.id
    returning j.id, j.run_id as "runId", j.node_id as "nodeId"`)
  const row = res.rows[0] as ClaimedJob | undefined
  return row ? { id: Number(row.id), runId: row.runId, nodeId: row.nodeId } : null
}

export async function enqueue(exec: Exec, runId: string, nodeId: string, runAt?: Date) {
  await exec.execute(sql`insert into jobs (run_id, node_id, run_at) values (${runId}, ${nodeId}, ${runAt ?? new Date()})`)
}
