import { createRequire } from 'node:module'
import { Worker } from 'node:worker_threads'
import type { Evaluator, RunContext } from '@relay/shared'

// JSONata runs in worker threads. A recursive expression can loop forever without ever
// yielding to timers, so a timeout on the main thread would never fire. A worker can be
// terminated no matter what it is doing.

const jsonataPath = createRequire(import.meta.url).resolve('jsonata')

const WORKER_SOURCE = `
const { parentPort } = require('node:worker_threads')
const jsonata = require(${JSON.stringify(jsonataPath)})
parentPort.postMessage({ ready: true })
parentPort.on('message', async ({ id, expr, ctx }) => {
  try {
    const value = await jsonata(expr).evaluate(ctx)
    parentPort.postMessage({ id, ok: true, value: value === undefined ? null : JSON.parse(JSON.stringify(value)) })
  } catch (e) {
    parentPort.postMessage({ id, ok: false, error: String((e && e.message) || e) })
  }
})
`

type Pending = { expr: string; ctx: RunContext; resolve: (v: unknown) => void; reject: (e: Error) => void }
type Slot = { worker: Worker; ready: boolean; current: { id: number; pending: Pending; timer: ReturnType<typeof setTimeout> } | null }

export function createSandbox(opts: { size?: number; timeoutMs?: number } = {}) {
  const size = opts.size ?? 2
  const timeoutMs = opts.timeoutMs ?? 2000
  const queue: Pending[] = []
  const slots: Slot[] = []
  let nextId = 1
  let closed = false

  const spawn = (): Slot => {
    const worker = new Worker(WORKER_SOURCE, { eval: true, resourceLimits: { maxOldGenerationSizeMb: 128, stackSizeMb: 4 } })
    const slot: Slot = { worker, ready: false, current: null }
    worker.on('message', (m: { ready?: boolean; id: number; ok: boolean; value?: unknown; error?: string }) => {
      // Loading JSONata takes a moment. That time must not count against the first expression.
      if (m.ready) { slot.ready = true; pump(); return }
      const cur = slot.current
      if (!cur || cur.id !== m.id) return
      clearTimeout(cur.timer)
      slot.current = null
      if (m.ok) cur.pending.resolve(m.value)
      else cur.pending.reject(new Error(m.error))
      pump()
    })
    worker.on('error', (err: Error) => replace(slot, new Error(`expression failed: ${err.message}`)))
    worker.on('exit', () => { if (slot.current) replace(slot, new Error('expression worker stopped')) })
    return slot
  }

  // Throw the worker away and start a fresh one. Anything it was running is lost.
  const replace = (slot: Slot, err: Error) => {
    const cur = slot.current
    slot.current = null
    if (cur) { clearTimeout(cur.timer); cur.pending.reject(err) }
    void slot.worker.terminate()
    const i = slots.indexOf(slot)
    if (i >= 0 && !closed) slots[i] = spawn()
    pump()
  }

  const pump = () => {
    for (const slot of slots) {
      if (slot.current || !slot.ready || closed) continue
      const pending = queue.shift()
      if (!pending) return
      const id = nextId++
      const timer = setTimeout(() => replace(slot, new Error('expression took too long')), timeoutMs)
      slot.current = { id, pending, timer }
      slot.worker.postMessage({ id, expr: pending.expr, ctx: pending.ctx })
    }
  }

  for (let i = 0; i < size; i++) slots.push(spawn())

  const evaluate: Evaluator = (expr, ctx) =>
    new Promise((resolve, reject) => {
      if (closed) return reject(new Error('sandbox is closed'))
      queue.push({ expr, ctx, resolve, reject })
      pump()
    })

  return {
    evaluate,
    async close() {
      closed = true
      await Promise.all(slots.map((s) => s.worker.terminate()))
    },
  }
}

export type Sandbox = ReturnType<typeof createSandbox>
