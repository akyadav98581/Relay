import { afterAll, beforeAll, expect, it } from 'vitest'
import { createEngine, startRun } from '../src/engine/index.js'
import { graph, jobsFor, node, seedUser, seedWorkflow, waitRunDone } from './engine-helpers.js'
import { newDatabase, testConfig, testServer } from './helpers.js'

let t: Awaited<ReturnType<typeof newDatabase>>
let srv: Awaited<ReturnType<typeof testServer>>
const engines: ReturnType<typeof createEngine>[] = []

beforeAll(async () => {
  t = await newDatabase()
  srv = await testServer((_h, _n, res) => { setTimeout(() => { res.setHeader('content-type', 'application/json'); res.end('{"ok":true}') }, 5); return true })
})
afterAll(async () => { for (const e of engines) await e.stop(); await srv.close(); await t.close() })

it('eight workers across two engines never run a step twice', async () => {
  // two engines on one database stand in for two server processes
  for (let i = 0; i < 2; i++) {
    const e = createEngine(t.db, testConfig())
    engines.push(e)
    e.startWorkers(4)
  }
  const g = graph(
    [
      node('start', 'webhook'),
      node('a', 'http', { url: `${srv.url}/a/{{ trigger.i }}` }),
      node('b', 'http', { url: `${srv.url}/b/{{ trigger.i }}` }),
      node('c', 'http', { url: `${srv.url}/c/{{ trigger.i }}` }),
      node('d', 'transform', { expression: '{ "i": trigger.i }' }),
    ],
    [['start', 'a'], ['start', 'b'], ['a', 'c'], ['b', 'c'], ['c', 'd']],
  )
  const wf = await seedWorkflow(t.db, await seedUser(t.db), g)
  const N = 60
  const ids = await Promise.all(Array.from({ length: N }, (_, i) => startRun(t.db, wf, 'manual', { i })))
  const results = await Promise.all(ids.map((id) => waitRunDone(t.db, id, 25_000)))

  expect(results.every((r) => r.run.status === 'success')).toBe(true)
  for (const step of ['a', 'b', 'c']) {
    const seen = new Map<string, number>()
    for (const h of srv.hits.filter((h) => h.url.startsWith(`/${step}/`))) seen.set(h.url, (seen.get(h.url) ?? 0) + 1)
    expect(seen.size).toBe(N)
    expect([...seen.values()].every((n) => n === 1)).toBe(true) // exactly one call per run per step
  }
  // the trigger never executes (attempts 0), every other step ran exactly one attempt
  expect(results.every((r) => Object.entries(r.steps).every(([k, s]) => (k === 'start' ? s.attempts === 0 : s.attempts === 1)))).toBe(true)
  for (const id of ids.slice(0, 5)) expect(await jobsFor(t.db, id)).toHaveLength(0)
}, 40_000)
