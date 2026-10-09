import { mkdtempSync, rmSync } from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import EmbeddedPostgres from 'embedded-postgres'
import type { TestProject } from 'vitest/node'

const freePort = () =>
  new Promise<number>((resolve) => {
    const s = net.createServer().listen(0, () => {
      const { port } = s.address() as net.AddressInfo
      s.close(() => resolve(port))
    })
  })

let pg: EmbeddedPostgres
let dir: string

// One real Postgres for the whole test run. Each test file makes its own database inside it.
export async function setup(project: TestProject) {
  dir = mkdtempSync(path.join(os.tmpdir(), 'relay-pg-'))
  const port = await freePort()
  pg = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'pw', port, persistent: false, onLog: () => {}, onError: () => {} })
  await pg.initialise()
  await pg.start()
  project.provide('pgAdminUrl', `postgres://postgres:pw@localhost:${port}/postgres`)
}

export async function teardown() {
  await pg?.stop()
  rmSync(dir, { recursive: true, force: true })
}

declare module 'vitest' {
  export interface ProvidedContext {
    pgAdminUrl: string
  }
}
