import { randomUUID } from 'node:crypto'
import type { Config } from '../config.js'
import type { Db } from '../db/index.js'
import { claimJob } from './queue.js'
import { processJob, type RunnerDeps } from './runner.js'
import type { Evaluator } from '@relay/shared'
import type { SafeFetchOpts } from '../http-guard.js'
import { sleepUntilWoken, wakeAll } from './wake.js'

// n loops in this process, each claiming one job at a time.
export function startWorkers(opts: { db: Db; config: Config; evaluate: Evaluator; count: number; fetchOpts?: SafeFetchOpts }) {
  let stopped = false
  const loops = Array.from({ length: opts.count }, async () => {
    const deps: RunnerDeps = { db: opts.db, config: opts.config, evaluate: opts.evaluate, workerId: `w-${randomUUID().slice(0, 8)}`, fetchOpts: opts.fetchOpts }
    while (!stopped) {
      try {
        const job = await claimJob(opts.db, deps.workerId, opts.config.lockMs)
        if (!job) { await sleepUntilWoken(opts.config.pollMs); continue }
        await processJob(deps, job)
      } catch (err) {
        // The job stays locked and comes back when the lock expires.
        console.error('worker error:', (err as Error).message)
        await sleepUntilWoken(opts.config.pollMs * 4)
      }
    }
  })
  return { async stop() { stopped = true; wakeAll(); await Promise.all(loops) } }
}
