// Starts the built app against a throwaway Postgres, so e2e runs anywhere with no setup.
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import EmbeddedPostgres from 'embedded-postgres'

const freePort = () =>
  new Promise((resolve) => {
    const s = net.createServer().listen(0, () => {
      const { port } = s.address()
      s.close(() => resolve(port))
    })
  })

export async function startApp(env = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'relay-e2e-'))
  const pgPort = await freePort()
  const pg = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'pw', port: pgPort, persistent: false, onLog: () => {}, onError: () => {} })
  await pg.initialise()
  await pg.start()
  await pg.createDatabase('relay')

  const port = await freePort()
  const server = spawn('node', ['apps/api/dist/index.js'], {
    env: { ...process.env, PORT: String(port), DATABASE_URL: `postgres://postgres:pw@localhost:${pgPort}/relay`, ALLOW_PRIVATE_HTTP: '1', POLL_MS: '100', RETRY_BASE_MS: '200', ...env },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  await new Promise((resolve, reject) => {
    server.stdout.on('data', (d) => String(d).includes('listening') && resolve())
    server.once('exit', () => reject(new Error('server exited early')))
  })
  return {
    url: `http://localhost:${port}`,
    async stop() {
      const exited = new Promise((r) => server.once('exit', r))
      server.kill('SIGTERM')
      await exited
      await pg.stop()
      rmSync(dir, { recursive: true, force: true })
    },
  }
}
