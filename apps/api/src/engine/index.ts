import type { Config } from '../config.js'
import type { Db } from '../db/index.js'
import type { SafeFetchOpts } from '../http-guard.js'
import { createSandbox } from '../sandbox.js'
import { startScheduler } from './scheduler.js'
import { startWorkers } from './worker.js'

export * from './runs.js'
export * from './queue.js'
export * from './scheduler.js'
export { processJob } from './runner.js'

// Workers, scheduler and the expression sandbox, started and stopped together.
export function createEngine(db: Db, config: Config, fetchOpts?: SafeFetchOpts) {
  const sandbox = createSandbox({ size: 2 })
  const parts: { stop(): void | Promise<void> }[] = []
  return {
    evaluate: sandbox.evaluate,
    startWorkers(count = config.workerConcurrency) {
      parts.push(startWorkers({ db, config, evaluate: sandbox.evaluate, count, fetchOpts }))
    },
    startScheduler() {
      parts.push(startScheduler(db, config.schedulerMs, config.keepRunsPerWorkflow))
    },
    async stop() {
      await Promise.all(parts.splice(0).map((p) => p.stop()))
      await sandbox.close()
    },
  }
}
