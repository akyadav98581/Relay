import { describe, expect, it } from 'vitest'
import { validateGraph } from '../src/index.js'
import { graph, node } from './helpers.js'

const errorsOf = (g: unknown) => {
  const r = validateGraph(g)
  return r.ok ? [] : r.errors
}

describe('validateGraph', () => {
  it('accepts a simple chain', () => {
    const g = graph([node('start', 'webhook'), node('call', 'http', { url: 'https://example.com' }), node('wait', 'delay')], [['start', 'call'], ['call', 'wait']])
    expect(validateGraph(g).ok).toBe(true)
  })

  it('needs exactly one trigger', () => {
    expect(errorsOf(graph([node('a', 'delay')], []))).toContain('add a webhook or schedule trigger')
    const two = graph([node('a', 'webhook'), node('b', 'schedule')], [])
    expect(errorsOf(two)).toContain('only one trigger per workflow')
  })

  it('rejects a loop', () => {
    const g = graph([node('start', 'webhook'), node('a', 'delay'), node('b', 'delay')], [['start', 'a'], ['a', 'b'], ['b', 'a']])
    expect(errorsOf(g)).toContain('the workflow has a loop')
  })

  it('rejects an input on a trigger and a self connection', () => {
    const g = graph([node('start', 'webhook'), node('a', 'delay')], [['a', 'start'], ['a', 'a']])
    const errs = errorsOf(g)
    expect(errs.some((e) => e.includes('cannot have an input'))).toBe(true)
    expect(errs.some((e) => e.includes('connected to itself'))).toBe(true)
  })

  it('rejects steps that the trigger cannot reach', () => {
    const g = graph([node('start', 'webhook'), node('a', 'delay'), node('orphan', 'delay')], [['start', 'a']])
    expect(errorsOf(g)).toContain('orphan is not connected to the trigger')
  })

  it('rejects duplicate keys and bad key names', () => {
    const g = graph([node('start', 'webhook'), node('a', 'delay'), node('a', 'delay')], [['start', 'a']])
    expect(errorsOf(g).some((e) => e.includes('duplicate key'))).toBe(true)
    expect(errorsOf(graph([node('Bad-Key', 'webhook')], [])).length).toBeGreaterThan(0)
  })

  it('checks each node config', () => {
    const g = graph([node('start', 'schedule', { cron: 'not a cron' }), node('d', 'delay', { seconds: 0 }), node('h', 'http', { url: '' })], [['start', 'd'], ['d', 'h']])
    const errs = errorsOf(g)
    expect(errs.some((e) => e.startsWith('start:'))).toBe(true)
    expect(errs.some((e) => e.startsWith('d:'))).toBe(true)
    expect(errs.some((e) => e.startsWith('h:'))).toBe(true)
  })

  it('rejects an edge to a node that does not exist', () => {
    const g = { ...graph([node('start', 'webhook')], []), edges: [{ id: 'x', source: 'n_start', target: 'ghost' }] }
    expect(errorsOf(g).some((e) => e.includes('missing node'))).toBe(true)
  })

  it('rejects junk input without throwing', () => {
    expect(validateGraph(null).ok).toBe(false)
    expect(validateGraph({ nodes: 'x' }).ok).toBe(false)
  })

  it('caps the node count', () => {
    const many = Array.from({ length: 51 }, (_, i) => node(`n${i}`, 'delay'))
    expect(validateGraph({ nodes: many, edges: [] }).ok).toBe(false)
  })
})

import { findProblems } from '../src/index.js'

describe('findProblems', () => {
  it('reports expression syntax errors with the node key', () => {
    const g = graph([node('start', 'webhook'), node('calc', 'transform', { expression: 'trigger.body.' }), node('gate', 'filter', { condition: '(' })], [['start', 'calc'], ['calc', 'gate']])
    const { problems } = findProblems(g)
    expect(problems.some((p) => p.startsWith('calc: expression'))).toBe(true)
    expect(problems.some((p) => p.startsWith('gate: condition'))).toBe(true)
  })

  it('checks placeholders inside http fields', () => {
    const g = graph([node('start', 'webhook'), node('call', 'http', { url: 'https://x.dev/{{ trigger. }}', headers: { A: '{{ ( }}' } })], [['start', 'call']])
    const { problems } = findProblems(g)
    expect(problems.some((p) => p.startsWith('call url'))).toBe(true)
    expect(problems.some((p) => p.startsWith('call header A'))).toBe(true)
  })

  it('returns no problems for a good graph and null for garbage', () => {
    const ok = graph([node('start', 'webhook'), node('call', 'http', { url: 'https://x.dev/{{ trigger.id }}' })], [['start', 'call']])
    expect(findProblems(ok)).toEqual({ graph: ok, problems: [] })
    expect(findProblems({ nodes: [{ id: 1 }] }).graph).toBeNull()
  })
})
