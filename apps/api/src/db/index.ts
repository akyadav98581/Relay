import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import pg from 'pg'
import * as schema from './schema.js'

export { schema }
export type Db = NodePgDatabase<typeof schema>
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]
// Anything that can run queries: the pool-backed db or an open transaction.
export type Exec = Db | Tx

export function connect(url: string, opts: { max?: number } = {}) {
  const local = /localhost|127\.0\.0\.1/.test(url)
  const pool = new pg.Pool({ connectionString: url, max: opts.max ?? 10, ssl: local ? false : { rejectUnauthorized: false } })
  // Hosted Postgres drops idle connections now and then. Without a listener, that error
  // is unhandled and takes the whole process down. The pool opens a fresh connection next time.
  pool.on('error', (err) => console.error('idle database client error:', err.message))
  return { pool, db: drizzle(pool, { schema }) as Db }
}

// Works from src/db (tsx, vitest) and from dist (the bundle). Both sit under apps/api.
const here = path.dirname(fileURLToPath(import.meta.url))
const migrationsFolder = [path.resolve(here, '../../drizzle'), path.resolve(here, '../drizzle')].find((p) =>
  existsSync(path.join(p, 'meta', '_journal.json')),
)

export async function migrateDb(db: Db) {
  if (!migrationsFolder) throw new Error('drizzle migrations folder not found')
  await migrate(db, { migrationsFolder })
}
