import { afterAll, expect, it } from 'vitest'
import { createSandbox } from '../src/sandbox.js'

const sb = createSandbox({ size: 2, timeoutMs: 1000 })
afterAll(() => sb.close())

const ctx = { trigger: { body: { items: [{ p: 5 }, { p: 7 }], name: 'Ada' } }, steps: {} }
const RUNAWAY = '( $f := function($n){ $f($n + 1) }; $f(0) )'

it('evaluates ordinary expressions', async () => {
  expect(await sb.evaluate('$sum(trigger.body.items.p)', ctx)).toBe(12)
  expect(await sb.evaluate('{ "who": trigger.body.name }', ctx)).toEqual({ who: 'Ada' })
  expect(await sb.evaluate('trigger.body.missing', ctx)).toBeNull()
})

it('reports a bad expression as an error, not a crash', async () => {
  await expect(sb.evaluate('trigger.body.', ctx)).rejects.toThrow()
  expect(await sb.evaluate('1 + 1', ctx)).toBe(2)
})

it('stops a runaway expression, keeps the main thread alive, and still works afterwards', async () => {
  let ticks = 0
  const timer = setInterval(() => ticks++, 20)
  const started = Date.now()
  await expect(sb.evaluate(RUNAWAY, ctx)).rejects.toThrow('too long')
  clearInterval(timer)
  expect(Date.now() - started).toBeLessThan(6000)
  expect(ticks).toBeGreaterThan(10) // timers kept firing on the main thread the whole time
  expect(await sb.evaluate('$sum(trigger.body.items.p)', ctx)).toBe(12)
})

it('survives several runaways in a row and handles parallel work', async () => {
  const bad = [sb.evaluate(RUNAWAY, ctx), sb.evaluate(RUNAWAY, ctx), sb.evaluate(RUNAWAY, ctx)].map((p) => p.catch((e) => e.message))
  const good = Array.from({ length: 20 }, (_, i) => sb.evaluate(`${i} * 2`, ctx))
  expect(await Promise.all(bad)).toEqual(Array(3).fill('expression took too long'))
  expect(await Promise.all(good)).toEqual(Array.from({ length: 20 }, (_, i) => i * 2))
})

it('cannot reach the host', async () => {
  expect(await sb.evaluate('$exists(process)', ctx)).toBe(false)
  expect(await sb.evaluate('$exists(require)', ctx)).toBe(false)
})
