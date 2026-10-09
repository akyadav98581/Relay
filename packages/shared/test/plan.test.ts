import { describe, expect, it } from 'vitest'
import { isRunFinished, planNext, type StepState } from '../src/index.js'
import { graph, node } from './helpers.js'

const states = (obj: Record<string, StepState['status'] | StepState>) =>
  new Map(Object.entries(obj).map(([k, v]) => [`n_${k}`, typeof v === 'string' ? { status: v } : v]))

describe('planNext', () => {
  const chain = graph([node('t', 'webhook'), node('a', 'transform'), node('b', 'transform')], [['t', 'a'], ['a', 'b']])

  it('starts the step after a finished trigger', () => {
    expect(planNext(chain, states({ t: 'success', a: 'pending', b: 'pending' }))).toEqual({ toRun: ['n_a'], toSkip: [] })
  })

  it('waits while a parent is still running', () => {
    expect(planNext(chain, states({ t: 'success', a: 'running', b: 'pending' }))).toEqual({ toRun: [], toSkip: [] })
  })

  it('waits while a parent sleeps in a delay', () => {
    expect(planNext(chain, states({ t: 'success', a: 'waiting', b: 'pending' })).toRun).toEqual([])
  })

  const filtered = graph(
    [node('t', 'webhook'), node('f', 'filter'), node('a', 'transform'), node('b', 'transform'), node('side', 'transform')],
    [['t', 'f'], ['f', 'a'], ['a', 'b'], ['t', 'side']],
  )

  it('skips everything behind a filter that said no, and only that', () => {
    const plan = planNext(filtered, states({
      t: 'success', f: { status: 'success', output: { pass: false } }, a: 'pending', b: 'pending', side: 'pending',
    }))
    expect(plan.toSkip.sort()).toEqual(['n_a', 'n_b'])
    expect(plan.toRun).toEqual(['n_side'])
  })

  it('lets the run through when the filter said yes', () => {
    const plan = planNext(filtered, states({
      t: 'success', f: { status: 'success', output: { pass: true } }, a: 'pending', b: 'pending', side: 'success',
    }))
    expect(plan).toEqual({ toRun: ['n_a'], toSkip: [] })
  })

  const diamond = graph(
    [node('t', 'webhook'), node('f', 'filter'), node('l', 'transform'), node('r', 'transform'), node('m', 'transform')],
    [['t', 'f'], ['t', 'l'], ['f', 'r'], ['l', 'm'], ['r', 'm']],
  )

  it('runs a merge step when one branch is dead and the other is live', () => {
    const plan = planNext(diamond, states({
      t: 'success', f: { status: 'success', output: { pass: false } }, l: 'success', r: 'pending', m: 'pending',
    }))
    expect(plan.toSkip).toEqual(['n_r'])
    expect(plan.toRun).toEqual(['n_m'])
  })

  it('waits at a merge until both branches have finished', () => {
    const plan = planNext(diamond, states({
      t: 'success', f: { status: 'success', output: { pass: true } }, l: 'running', r: 'success', m: 'pending',
    }))
    expect(plan.toRun).toEqual([])
  })

  it('skips a merge when both branches are dead', () => {
    const g = graph([node('t', 'webhook'), node('f1', 'filter'), node('f2', 'filter'), node('m', 'transform')], [['t', 'f1'], ['t', 'f2'], ['f1', 'm'], ['f2', 'm']])
    const no = { status: 'success' as const, output: { pass: false } }
    expect(planNext(g, states({ t: 'success', f1: no, f2: no, m: 'pending' })).toSkip).toEqual(['n_m'])
  })
})

describe('isRunFinished', () => {
  it('is true only when nothing can still move', () => {
    expect(isRunFinished(states({ a: 'success', b: 'skipped', c: 'failed' }))).toBe(true)
    expect(isRunFinished(states({ a: 'success', b: 'waiting' }))).toBe(false)
    expect(isRunFinished(states({ a: 'success', b: 'pending' }))).toBe(false)
  })
})
