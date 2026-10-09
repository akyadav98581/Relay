import { loadConfig } from './config.js'
import { connect, migrateDb } from './db/index.js'
import { createApp } from './app.js'
import { createEngine } from './engine/index.js'

const config = loadConfig()
let stopDevDb: (() => Promise<void>) | undefined
let url = config.databaseUrl
if (!url) {
  const dev = await (await import('./dev-db.js')).startDevDatabase()
  url = dev.url
  stopDevDb = dev.stop
}

const { pool, db } = connect(url)
await migrateDb(db)

const engine = createEngine(db, config)
engine.startWorkers()
engine.startScheduler()

const server = createApp({ db, config }).listen(config.port, () => console.log(`relay listening on :${config.port}`))

// Render sends SIGTERM on every deploy. Stop taking work, let running steps report back, close the pool.
for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, async () => {
    server.close()
    await engine.stop()
    await pool.end()
    await stopDevDb?.()
    process.exit(0)
  })
}
