import { describe, expect, it } from 'vitest'
import { checkExpr, evalInProcess as evalExpr, nextRun, isValidCron, renderString as render, renderTemplate as tpl } from '../src/index.js'

const renderTemplate = (t: string, c: typeof ctx) => tpl(t, c, evalExpr)
const renderString = (t: string, c: typeof ctx) => render(t, c, evalExpr)

const ctx = {
  trigger: { body: { id: 42, name: 'Ada', items: [{ p: 5 }, { p: 7 }] } },
  steps: { fetch: { status: 200, body: { ok: true } } },
}

describe('templating', () => {
  it('keeps the real type for a lone placeholder', async () => {
    expect(await renderTemplate('{{ trigger.body.id }}', ctx)).toBe(42)
    expect(await renderTemplate('{{ steps.fetch.body }}', ctx)).toEqual({ ok: true })
  })

  it('interpolates inside text', async () => {
    expect(await renderString('hello {{ trigger.body.name }}, id {{ trigger.body.id }}', ctx)).toBe('hello Ada, id 42')
  })

  it('leaves text without placeholders alone', async () => {
    expect(await renderString('plain', ctx)).toBe('plain')
  })

  it('renders a missing value as empty text', async () => {
    expect(await renderString('x{{ trigger.nope }}y', ctx)).toBe('xy')
  })

  it('runs JSONata expressions', async () => {
    expect(await evalExpr('$sum(trigger.body.items.p)', ctx)).toBe(12)
    expect(await evalExpr('trigger.body.id > 40', ctx)).toBe(true)
    expect(await evalExpr('{ "who": trigger.body.name }', ctx)).toEqual({ who: 'Ada' })
  })

  it('cannot see the host', async () => {
    expect(await evalExpr('$exists(process)', ctx)).toBe(false)
    expect(await evalExpr('$exists(require)', ctx)).toBe(false)
  })

  it('checks syntax without running', () => {
    expect(checkExpr('trigger.body.id')).toBeNull()
    expect(checkExpr('trigger.body.')).not.toBeNull()
  })
})

describe('cron', () => {
  it('validates and finds the next time in UTC', () => {
    expect(isValidCron('*/10 * * * *')).toBe(true)
    expect(isValidCron('nope')).toBe(false)
    const next = nextRun('0 9 * * *', new Date('2026-10-09T08:00:00Z'))
    expect(next.toISOString()).toBe('2026-10-09T09:00:00.000Z')
    expect(nextRun('0 9 * * *', next).toISOString()).toBe('2026-10-10T09:00:00.000Z')
  })
})
