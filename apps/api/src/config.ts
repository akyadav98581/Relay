export type Config = {
  port: number
  databaseUrl: string
  jwtSecret: string
  publicUrl: string
  allowPrivateHttp: boolean
  workerConcurrency: number
  lockMs: number
  pollMs: number
  retryBaseMs: number
  schedulerMs: number
  minScheduleMinutes: number
  maxWorkflowsPerUser: number
  keepRunsPerWorkflow: number
  production: boolean
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const production = env.NODE_ENV === 'production'
  if (production && !env.DATABASE_URL) throw new Error('DATABASE_URL is required in production')
  if (production && (!env.JWT_SECRET || env.JWT_SECRET.length < 24)) throw new Error('JWT_SECRET must be set to at least 24 characters in production')
  return {
    port: Number(env.PORT) || 3001,
    databaseUrl: env.DATABASE_URL ?? '',
    jwtSecret: env.JWT_SECRET ?? 'dev-only-secret-change-me',
    publicUrl: (env.PUBLIC_URL ?? '').replace(/\/$/, ''),
    allowPrivateHttp: env.ALLOW_PRIVATE_HTTP === '1',
    workerConcurrency: Number(env.WORKER_CONCURRENCY) || 4,
    lockMs: Number(env.LOCK_MS) || 60_000,
    pollMs: Number(env.POLL_MS) || 250,
    retryBaseMs: Number(env.RETRY_BASE_MS) || 1000,
    schedulerMs: Number(env.SCHEDULER_MS) || 5000,
    minScheduleMinutes: Number(env.MIN_SCHEDULE_MINUTES) || 1,
    maxWorkflowsPerUser: Number(env.MAX_WORKFLOWS_PER_USER) || 20,
    keepRunsPerWorkflow: Number(env.KEEP_RUNS_PER_WORKFLOW) || 100,
    production,
  }
}
