import { useEffect, useMemo, useState } from 'react'
import { Check, Copy, Plus, X } from '@phosphor-icons/react'
import type { Edge } from '@xyflow/react'
import { KEY_PATTERN, MAX_DELAY_SECONDS, NODE_INFO, nextRun } from '@relay/shared'
import { ICONS } from '../lib/nodeMeta'
import { humanSeconds } from '../lib/format'
import { setConfig, setKey, useAppDispatch, useAppSelector, type FlowNode } from '../lib/editorStore'

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
      {hint && <p className="mt-1.5 text-xs leading-relaxed text-mute">{hint}</p>}
    </div>
  )
}

function CopyBox({ text }: { text: string }) {
  const [done, setDone] = useState(false)
  return (
    <div className="relative">
      <pre className="overflow-x-auto rounded-xl border border-white/[0.07] bg-black/30 p-3 pr-9 font-mono text-xs leading-relaxed text-soft">{text}</pre>
      <button
        aria-label="Copy"
        className="absolute right-1.5 top-1.5 grid size-6 place-items-center rounded text-mute hover:bg-wash hover:text-ink"
        onClick={async () => {
          try { await navigator.clipboard.writeText(text) } catch { /* clipboard can be blocked */ }
          setDone(true)
          setTimeout(() => setDone(false), 1400)
        }}
      >
        {done ? <Check size={13} weight="bold" /> : <Copy size={13} weight="bold" />}
      </button>
    </div>
  )
}

function HeadersEditor({ value, onChange }: { value: Record<string, string>; onChange: (v: Record<string, string>) => void }) {
  const [rows, setRows] = useState<[string, string][]>(() => Object.entries(value))
  const push = (next: [string, string][]) => {
    setRows(next)
    onChange(Object.fromEntries(next.filter(([k]) => k.trim())))
  }
  return (
    <div className="space-y-2">
      {rows.map(([k, v], i) => (
        <div key={i} className="flex gap-1.5">
          <input aria-label="Header name" className="field mono w-2/5" placeholder="Name" value={k} onChange={(e) => push(rows.map((r, j) => (j === i ? [e.target.value, r[1]] : r)))} />
          <input aria-label="Header value" className="field mono" placeholder="Value" value={v} onChange={(e) => push(rows.map((r, j) => (j === i ? [r[0], e.target.value] : r)))} />
          <button aria-label="Remove header" className="grid w-8 shrink-0 place-items-center rounded text-mute hover:bg-wash hover:text-ink" onClick={() => push(rows.filter((_, j) => j !== i))}>
            <X size={14} weight="bold" />
          </button>
        </div>
      ))}
      <button className="btn" onClick={() => push([...rows, ['', '']])}><Plus size={13} weight="bold" /> Add header</button>
    </div>
  )
}

function ancestors(nodes: FlowNode[], edges: Edge[], id: string): string[] {
  const seen = new Set<string>()
  const stack = [id]
  while (stack.length) {
    const cur = stack.pop()!
    for (const e of edges) if (e.target === cur && !seen.has(e.source)) { seen.add(e.source); stack.push(e.source) }
  }
  return nodes.filter((n) => seen.has(n.id)).map((n) => n.data.key)
}

export default function ConfigPanel({ node, webhookPath }: { node: FlowNode; webhookPath: string }) {
  const dispatch = useAppDispatch()
  const { nodes, edges } = useAppSelector((s) => s.editor)
  const { type, key, config } = node.data
  const Icon = ICONS[type]
  const set = (patch: Record<string, unknown>) => dispatch(setConfig({ id: node.id, patch }))
  const before = useMemo(() => ancestors(nodes, edges, node.id), [nodes, edges, node.id])
  const keyError = !KEY_PATTERN.test(key) ? 'Lowercase letters, digits and underscores, starting with a letter.' : nodes.some((n) => n.id !== node.id && n.data.key === key) ? 'Another step already uses this name.' : null

  return (
    <div className="space-y-5 p-4" key={node.id}>
      <div className="flex items-start gap-3">
        <span className="step-icon" data-t={type} style={{ width: 36, height: 36, borderRadius: 11 }}><Icon size={17} weight="bold" /></span>
        <div>
          <div className="text-sm font-medium">{NODE_INFO[type].label}</div>
          <p className="text-xs leading-relaxed text-mute">{NODE_INFO[type].blurb}</p>
        </div>
      </div>

      <Field label="Name" hint={keyError ?? 'Later steps read this step as steps.' + key}>
        <input className={`field mono ${keyError ? 'border-red-ink' : ''}`} value={key} onChange={(e) => dispatch(setKey({ id: node.id, key: e.target.value }))} spellCheck={false} />
      </Field>

      {type === 'webhook' && (
        <>
          <Field label="URL" hint="Send any request here to start the workflow. It only answers while the workflow is enabled.">
            <CopyBox text={`${location.origin}${webhookPath}`} />
          </Field>
          <Field label="Try it">
            <CopyBox text={`curl -X POST ${location.origin}${webhookPath} \\\n  -H 'content-type: application/json' \\\n  -d '{"hello":"world"}'`} />
          </Field>
        </>
      )}

      {type === 'schedule' && <SchedulePreview cron={String(config.cron ?? '')} onChange={(cron) => set({ cron })} />}

      {type === 'http' && (
        <>
          <Field label="URL"><input className="field mono" value={String(config.url ?? '')} onChange={(e) => set({ url: e.target.value })} placeholder="https://api.example.com/items" spellCheck={false} /></Field>
          <div className="grid grid-cols-3 gap-2">
            <Field label="Method">
              <select className="field" value={String(config.method ?? 'GET')} onChange={(e) => set({ method: e.target.value })}>
                {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => <option key={m}>{m}</option>)}
              </select>
            </Field>
            <Field label="Timeout ms"><input className="field" type="number" min={100} max={30000} value={Number(config.timeoutMs ?? 10000)} onChange={(e) => set({ timeoutMs: Number(e.target.value) })} /></Field>
            <Field label="Retries"><input className="field" type="number" min={0} max={5} value={Number(config.retries ?? 2)} onChange={(e) => set({ retries: Number(e.target.value) })} /></Field>
          </div>
          <Field label="Headers"><HeadersEditor value={(config.headers as Record<string, string>) ?? {}} onChange={(headers) => set({ headers })} /></Field>
          <Field label="Body" hint="Leave empty for none. {{ steps.name }} alone sends that data as JSON.">
            <textarea className="field" rows={4} value={String(config.body ?? '')} onChange={(e) => set({ body: e.target.value })} spellCheck={false} />
          </Field>
          <p className="text-xs leading-relaxed text-mute">Network errors, 429 and 5xx are retried with a growing wait. A 4xx counts as an answer: the step succeeds and <code className="font-mono">ok</code> is false, so a filter can react to it.</p>
        </>
      )}

      {type === 'filter' && (
        <Field label="Condition" hint="A JSONata expression. The steps after this one run only if it is true.">
          <textarea className="field" rows={3} value={String(config.condition ?? '')} onChange={(e) => set({ condition: e.target.value })} spellCheck={false} />
        </Field>
      )}

      {type === 'transform' && (
        <Field label="Expression" hint="A JSONata expression. Its result becomes this step's output.">
          <textarea className="field" rows={6} value={String(config.expression ?? '')} onChange={(e) => set({ expression: e.target.value })} spellCheck={false} />
        </Field>
      )}

      {type === 'delay' && (
        <Field label="Seconds" hint={`Waits ${humanSeconds(Number(config.seconds) || 0)}. Up to ${humanSeconds(MAX_DELAY_SECONDS)}. The wait is saved in the database, so a restart does not lose it.`}>
          <input className="field" type="number" min={1} max={MAX_DELAY_SECONDS} value={Number(config.seconds ?? 60)} onChange={(e) => set({ seconds: Number(e.target.value) })} />
        </Field>
      )}

      {(type === 'http' || type === 'filter' || type === 'transform') && (
        <div className="border-t border-line pt-4 text-xs leading-relaxed text-mute">
          <p className="mb-1.5 uppercase tracking-[0.08em]">Data you can use</p>
          <p><code className="font-mono text-soft">trigger</code>{type === 'http' ? ' (in {{ }})' : ''}: what started the run, for a webhook <code className="font-mono text-soft">trigger.body</code>.</p>
          {before.length > 0 ? (
            <p className="mt-1">Earlier steps: {before.map((k, i) => <span key={k}><code className="font-mono text-soft">steps.{k}</code>{i < before.length - 1 ? ', ' : ''}</span>)}</p>
          ) : (
            <p className="mt-1">Connect an earlier step to read its output.</p>
          )}
        </div>
      )}
    </div>
  )
}

function SchedulePreview({ cron, onChange }: { cron: string; onChange: (c: string) => void }) {
  const upcoming = useMemo(() => {
    try {
      const out: Date[] = []
      let from = new Date()
      for (let i = 0; i < 3; i++) { from = nextRun(cron, from); out.push(from) }
      return out
    } catch {
      return null
    }
  }, [cron])
  const [local, setLocal] = useState(cron)
  useEffect(() => setLocal(cron), [cron])
  return (
    <Field label="Cron (UTC)" hint="Five fields: minute, hour, day of month, month, day of week.">
      <input className={`field mono ${upcoming ? '' : 'border-red-ink'}`} value={local} onChange={(e) => { setLocal(e.target.value); onChange(e.target.value) }} spellCheck={false} />
      <div className="mt-2 text-xs leading-relaxed text-mute">
        {upcoming ? (
          <>
            <p className="uppercase tracking-[0.08em]">Next runs</p>
            {upcoming.map((d) => <p key={d.toISOString()} className="font-mono text-soft">{d.toISOString().replace('T', ' ').slice(0, 16)} UTC</p>)}
          </>
        ) : (
          <p className="text-red-ink">Not a valid cron expression.</p>
        )}
      </div>
    </Field>
  )
}
