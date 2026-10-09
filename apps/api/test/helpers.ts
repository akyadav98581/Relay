import http from 'node:http'
import type { AddressInfo } from 'node:net'
import pg from 'pg'
import { inject } from 'vitest'
import { connect, migrateDb, type Db } from '../src/db/index.js'
import type { Config } from '../src/config.js'
import { loadConfig } from '../src/config.js'

let admin: pg.Pool | undefined

// A fresh, migrated database for one test file.
export async function newDatabase() {
  admin ??= new pg.Pool({ connectionString: inject('pgAdminUrl'), max: 2 })
  const name = 't_' + Math.random().toString(36).slice(2, 10)
  await admin.query(`create database ${name}`)
  const url = inject('pgAdminUrl').replace(/\/postgres$/, `/${name}`)
  const { pool, db } = connect(url, { max: 12 })
  await migrateDb(db)
  return { db, pool, url, name, close: () => pool.end() }
}

export const testConfig = (over: Partial<Config> = {}): Config => ({
  ...loadConfig({}),
  allowPrivateHttp: true, // tests talk to a server on localhost
  pollMs: 20,
  retryBaseMs: 30,
  lockMs: 60_000,
  schedulerMs: 50,
  ...over,
})

export async function waitFor<T>(fn: () => Promise<T | false | undefined | null> | T | false | undefined | null, ms = 8000, label = 'condition'): Promise<T> {
  const end = Date.now() + ms
  for (;;) {
    const v = await fn()
    if (v) return v as T
    if (Date.now() > end) throw new Error(`timed out waiting for ${label}`)
    await new Promise((r) => setTimeout(r, 15))
  }
}

export type Hit = { method: string; url: string; headers: http.IncomingHttpHeaders; body: string }

// A small scripted HTTP server the http node can call.
export async function testServer(handler?: (req: Hit, n: number, res: http.ServerResponse) => boolean | void) {
  const hits: Hit[] = []
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      const hit = { method: req.method!, url: req.url!, headers: req.headers, body }
      hits.push(hit)
      if (handler?.(hit, hits.length, res) === true) return
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ ok: true, n: hits.length, echo: body ? safeJson(body) : null }))
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const port = (server.address() as AddressInfo).port
  return {
    hits,
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()) }),
  }
}

const safeJson = (s: string) => { try { return JSON.parse(s) } catch { return s } }

export type { Db }
