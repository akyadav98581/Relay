import { afterAll, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { migrateDb } from '../src/db/index.js'
import { newDatabase } from './helpers.js'

let ctx: Awaited<ReturnType<typeof newDatabase>>
afterAll(() => ctx?.close())

it('creates every table on an empty database and a second run changes nothing', async () => {
  ctx = await newDatabase() // already ran the migrations once
  const tables = async () =>
    (await ctx.db.execute(sql`select table_name from information_schema.tables where table_schema = 'public' order by 1`)).rows.map((r) => r.table_name)
  const first = await tables()
  expect(first).toEqual(expect.arrayContaining(['users', 'workflows', 'runs', 'run_steps', 'jobs']))

  await migrateDb(ctx.db)
  expect(await tables()).toEqual(first)
  const applied = (await ctx.db.execute(sql`select count(*)::int as n from drizzle.__drizzle_migrations`)).rows[0]!.n
  expect(applied).toBe(1)
})

it('has the index the queue claims from', async () => {
  const rows = (await ctx.db.execute(sql`select indexname from pg_indexes where tablename = 'jobs'`)).rows.map((r) => r.indexname)
  expect(rows).toContain('jobs_claim_idx')
})
