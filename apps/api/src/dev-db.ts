import { mkdirSync } from 'node:fs'
import path from 'node:path'

// Local development only: a real Postgres in .data/pg so nothing has to be installed.
// Production always has DATABASE_URL, and this file is never loaded.
export async function startDevDatabase(): Promise<{ url: string; stop: () => Promise<void> }> {
  const { default: EmbeddedPostgres } = await import('embedded-postgres')
  const dir = path.resolve('.data/pg')
  mkdirSync(dir, { recursive: true })
  const fresh = !(await import('node:fs')).existsSync(path.join(dir, 'PG_VERSION'))
  const port = 54329
  const pg = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'postgres', port, persistent: true, onLog: () => {}, onError: () => {} })
  if (fresh) await pg.initialise()
  await pg.start()
  if (fresh) await pg.createDatabase('relay')
  console.warn(`DATABASE_URL not set, using a local Postgres in .data/pg on port ${port}`)
  return { url: `postgres://postgres:postgres@localhost:${port}/relay`, stop: () => pg.stop() }
}
