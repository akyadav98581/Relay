import { afterAll, beforeAll, expect, it } from 'vitest'
import { createEngine, startRun } from '../src/engine/index.js'
import { edge, graph, node, seedUser, seedWorkflow, waitRunDone } from './engine-helpers.js'
import { newDatabase, testConfig, testServer } from './helpers.js'

let t: Awaited<ReturnType<typeof newDatabase>>
let srv: Awaited<ReturnType<typeof testServer>>
let engine: ReturnType<typeof createEngine>

beforeAll(async () => {
  t = await newDatabase()
  srv = await testServer((hit, _n, res) => {
    if (hit.url.startsWith('/slow')) { setTimeout(() => { res.setHeader('content-type', 'application/json'); res.end('{"ok":true}') }, 60); return true }
  })
  engine = createEngine(t.db, testConfig())
  engine.startWorkers(4)
})
afterAll(async () => {
  await engine.stop()
  await srv.close()
  await t.close()
})

const hitsTo = (prefix: string) => srv.hits.filter((h) => h.url.startsWith(prefix)).length
const run = async (g: ReturnType<typeof graph>, payload: unknown) => {
  const wf = await seedWorkflow(t.db, await seedUser(t.db), g)
  return waitRunDone(t.db, await startRun(t.db, wf, 'manual', payload))
}

it('a filter that says no skips only the steps behind it', async () => {
  const g = graph(
    [
      node('start', 'webhook'),
      node('big', 'filter', { condition: 'trigger.amount > 100' }),
      node('notify', 'http', { url: `${srv.url}/notify-big` }),
      node('log', 'transform', { expression: '"logged"' }),
      node('side', 'transform', { expression: '"side"' }),
    ],
    [['start', 'big'], ['big', 'notify'], ['notify', 'log'], ['start', 'side']],
  )
  const small = await run(g, { amount: 50 })
  expect(small.run.status).toBe('success')
  expect(small.steps.big!.output).toEqual({ pass: false })
  expect(small.steps.notify!.status).toBe('skipped')
  expect(small.steps.log!.status).toBe('skipped')
  expect(small.steps.side).toMatchObject({ status: 'success', output: 'side' })
  expect(hitsTo('/notify-big')).toBe(0)

  const large = await run(g, { amount: 500 })
  expect(large.steps.big!.output).toEqual({ pass: true })
  expect(large.steps.notify!.status).toBe('success')
  expect(large.steps.log!.status).toBe('success')
  expect(hitsTo('/notify-big')).toBe(1)
})

it('filter conditions follow JSONata truthiness', async () => {
  const g = (cond: string) => graph([node('start', 'webhook'), node('f', 'filter', { condition: cond }), node('after', 'transform', { expression: '1' })], [['start', 'f'], ['f', 'after']])
  expect((await run(g('trigger.name'), { name: 'x' })).steps.after!.status).toBe('success')
  expect((await run(g('trigger.name'), {})).steps.after!.status).toBe('skipped')
  expect((await run(g('$exists(trigger.name)'), { name: '' })).steps.after!.status).toBe('success')
  expect((await run(g('trigger.items'), { items: [] })).steps.after!.status).toBe('skipped')
})

it('a merge step runs when one branch is filtered out and the other is live', async () => {
  const g = graph(
    [
      node('start', 'webhook'),
      node('gate', 'filter', { condition: 'trigger.go = true' }),
      node('a', 'transform', { expression: '"from a"' }),
      node('b', 'transform', { expression: '"from b"' }),
      node('merge', 'transform', { expression: '{ "a": steps.a, "b": steps.b }' }),
    ],
    [['start', 'gate'], ['gate', 'a'], ['start', 'b'], ['a', 'merge'], ['b', 'merge']],
  )
  const dead = await run(g, { go: false })
  expect(dead.steps.a!.status).toBe('skipped')
  expect(dead.steps.merge).toMatchObject({ status: 'success', output: { b: 'from b' } })
  const live = await run(g, { go: true })
  expect(live.steps.merge).toMatchObject({ status: 'success', output: { a: 'from a', b: 'from b' } })
})

it('a merge step runs exactly once even when both parents finish together', async () => {
  const g = graph(
    [
      node('start', 'webhook'),
      node('left', 'http', { url: `${srv.url}/slow-left` }),
      node('right', 'http', { url: `${srv.url}/slow-right` }),
      node('join', 'http', { url: `${srv.url}/join` }),
    ],
    [['start', 'left'], ['start', 'right'], ['left', 'join'], ['right', 'join']],
  )
  for (let i = 0; i < 6; i++) await run(g, {})
  expect(hitsTo('/slow-left')).toBe(6)
  expect(hitsTo('/slow-right')).toBe(6)
  expect(hitsTo('/join')).toBe(6) // not 12
})

it('a merge step is skipped when every branch into it is dead', async () => {
  const g = graph(
    [node('start', 'webhook'), node('f1', 'filter', { condition: 'false' }), node('f2', 'filter', { condition: 'false' }), node('m', 'transform', { expression: '1' })],
    [['start', 'f1'], ['start', 'f2'], ['f1', 'm'], ['f2', 'm']],
  )
  const r = await run(g, {})
  expect(r.run.status).toBe('success')
  expect(r.steps.m!.status).toBe('skipped')
})

it('a failure on one branch ends the run and the other branch result is dropped', async () => {
  const g = graph(
    [
      node('start', 'webhook'),
      node('slow', 'http', { url: `${srv.url}/slow-x` }),
      node('boom', 'transform', { expression: '$number("nope")' }),
      node('after', 'transform', { expression: '1' }),
    ],
    [['start', 'slow'], ['start', 'boom'], ['slow', 'after']],
  )
  const r = await run(g, {})
  await new Promise((res) => setTimeout(res, 200)) // let the slow branch report back
  const again = (await waitRunDone(t.db, r.run.id))
  expect(again.run.status).toBe('failed')
  expect(again.steps.after!.status).toBe('skipped')
})

void edge
