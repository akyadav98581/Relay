import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { Clock, Plus, Trash, WebhooksLogo } from '@phosphor-icons/react'
import { defaultConfig, type Graph } from '@relay/shared'
import { api, ApiError } from '../api'
import Chain from '../components/Chain'
import Pill from '../components/Pill'
import { ago } from '../lib/format'
import { spotlight, useCountUp } from '../lib/motion'

const n = (id: string, key: string, type: Graph['nodes'][number]['type'], x: number, y: number, config: Record<string, unknown> = {}) => ({
  id, key, type, position: { x, y }, config: { ...defaultConfig(type), ...config },
})

const TEMPLATES: { name: string; blurb: string; graph: Graph }[] = [
  {
    name: 'Order alert',
    blurb: 'A webhook comes in. If the amount is over 100, call another service.',
    graph: {
      nodes: [
        n('n_start', 'start', 'webhook', 60, 140),
        n('n_big', 'big_order', 'filter', 340, 140, { condition: 'trigger.body.amount > 100' }),
        n('n_notify', 'notify', 'http', 620, 140, {
          method: 'POST', url: 'https://httpbin.org/post', headers: { 'content-type': 'application/json' },
          body: '{ "text": "Big order {{ trigger.body.id }}: {{ trigger.body.amount }}" }',
        }),
      ],
      edges: [{ id: 'e_n_start_n_big', source: 'n_start', target: 'n_big' }, { id: 'e_n_big_n_notify', source: 'n_big', target: 'n_notify' }],
    },
  },
  {
    name: 'Slow follow-up',
    blurb: 'A webhook comes in, waits a minute, then reshapes the data and sends it on.',
    graph: {
      nodes: [
        n('n_start', 'start', 'webhook', 60, 140),
        n('n_wait', 'wait', 'delay', 340, 140, { seconds: 60 }),
        n('n_shape', 'shape', 'transform', 620, 140, { expression: '{ "who": trigger.body.name, "at": $now() }' }),
        n('n_send', 'send', 'http', 900, 140, { method: 'POST', url: 'https://httpbin.org/post', body: '{{ steps.shape }}' }),
      ],
      edges: [
        { id: 'e_n_start_n_wait', source: 'n_start', target: 'n_wait' },
        { id: 'e_n_wait_n_shape', source: 'n_wait', target: 'n_shape' },
        { id: 'e_n_shape_n_send', source: 'n_shape', target: 'n_send' },
      ],
    },
  },
]

function Stat({ label, value, tone, i }: { label: string; value: number; tone?: 'good' | 'bad'; i: number }) {
  const shown = useCountUp(value)
  return (
    <div className="glass rise px-5 py-4" style={{ '--i': i } as React.CSSProperties}>
      <p className="mono text-[0.68rem] uppercase tracking-[0.1em] text-mute">{label}</p>
      <p className={`display mt-2 text-4xl ${tone === 'bad' && value > 0 ? 'text-[var(--s-failed)]' : tone === 'good' && value > 0 ? 'text-[var(--s-success)]' : ''}`}>{shown}</p>
    </div>
  )
}

export default function Workflows() {
  const qc = useQueryClient()
  const nav = useNavigate()
  const list = useQuery({ queryKey: ['workflows'], queryFn: api.workflows, refetchInterval: 5000 })
  const stats = useQuery({ queryKey: ['stats'], queryFn: api.stats, refetchInterval: 5000 })
  const [confirm, setConfirm] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const create = useMutation({
    mutationFn: (t?: (typeof TEMPLATES)[number]) => api.createWorkflow(t?.name ?? 'Untitled workflow', t?.graph),
    onSuccess: (wf) => { qc.invalidateQueries({ queryKey: ['workflows'] }); nav(`/workflows/${wf.id}`) },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not create it.'),
  })
  const remove = useMutation({
    mutationFn: api.deleteWorkflow,
    onSuccess: () => { setConfirm(null); qc.invalidateQueries({ queryKey: ['workflows'] }); qc.invalidateQueries({ queryKey: ['stats'] }) },
  })

  const all = list.data ?? []
  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="display text-4xl sm:text-5xl">Workflows</h1>
          <p className="mt-2 text-mute">Draw it once. It runs on a webhook or a schedule.</p>
        </div>
        <button className="btn btn-primary btn-lg" onClick={() => create.mutate(undefined)} disabled={create.isPending} data-testid="new-workflow"><Plus size={16} weight="bold" /> New workflow</button>
      </div>
      {error && <p role="alert" className="mt-4 rounded-lg border border-red-ink/20 bg-red-wash px-3 py-2 text-sm text-red-ink">{error}</p>}

      <div className="mt-8 grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="stats">
        <Stat i={0} label="Workflows" value={all.length} />
        <Stat i={1} label="Turned on" value={all.filter((w) => w.enabled).length} tone="good" />
        <Stat i={2} label="Runs, 24 hours" value={stats.data?.runs24h ?? 0} />
        <Stat i={3} label="Failed, 24 hours" value={stats.data?.failed24h ?? 0} tone="bad" />
      </div>

      {list.isPending && (
        <div className="mt-6 grid gap-4 md:grid-cols-2" aria-label="Loading workflows">
          {[0, 1].map((i) => <div key={i} className="skeleton h-[188px]" />)}
        </div>
      )}

      {all.length > 0 && (
        <ul className="mt-6 grid gap-4 md:grid-cols-2" data-testid="workflow-list">
          {all.map((w, i) => (
            <li key={w.id} className="glass glass-hover spot rise group relative" style={{ '--i': i + 4 } as React.CSSProperties} onPointerMove={spotlight.onPointerMove}>
              <Link to={`/workflows/${w.id}`} className="block p-5" aria-label={`Open ${w.name}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-lg font-semibold tracking-tight">{w.name}</p>
                    <p className="mt-1 flex items-center gap-1.5 font-mono text-xs text-mute">
                      {w.trigger === 'schedule' ? <Clock size={12} weight="bold" /> : <WebhooksLogo size={12} weight="bold" />}
                      {w.trigger ?? 'no trigger'} · edited {ago(w.updatedAt)}
                    </p>
                  </div>
                  <Pill status={w.enabled ? 'on' : 'idle'} label={w.enabled ? 'on' : 'draft'} />
                </div>
                <div className="mt-5"><Chain types={w.steps} /></div>
                <div className="mt-5 flex items-center gap-2 border-t border-white/[0.07] pt-4 text-xs text-mute">
                  {w.lastRun ? (<><Pill status={w.lastRun.status} /> <span>{ago(w.lastRun.startedAt)}</span></>) : <span>Never run</span>}
                </div>
              </Link>
              <div className="absolute bottom-3.5 right-4">
                {confirm === w.id ? (
                  <span className="flex items-center gap-2 text-xs">
                    <button className="btn" onClick={() => setConfirm(null)}>Keep</button>
                    <button className="btn btn-danger" onClick={() => remove.mutate(w.id)}>Delete it</button>
                  </span>
                ) : (
                  <button className="grid size-8 place-items-center rounded-lg text-dim opacity-60 transition hover:bg-white/[0.07] hover:text-[var(--s-failed)] group-hover:opacity-100" aria-label={`Delete ${w.name}`} onClick={() => setConfirm(w.id)}><Trash size={15} weight="bold" /></button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {list.data && all.length === 0 && (
        <div className="glass mt-6 px-6 py-12 text-center">
          <div className="mx-auto mb-5 flex justify-center"><Chain types={['webhook', 'filter', 'http']} /></div>
          <p className="display text-2xl">Nothing here yet</p>
          <p className="mx-auto mt-2 max-w-sm text-sm text-mute">Start from a blank canvas, or pick one of the templates below.</p>
        </div>
      )}

      <section className="mt-12">
        <h2 className="label">Start from a template</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {TEMPLATES.map((t) => (
            <button key={t.name} className="glass glass-hover spot p-5 text-left" onPointerMove={spotlight.onPointerMove} onClick={() => create.mutate(t)} disabled={create.isPending} data-testid={`template-${t.name.toLowerCase().replace(/\W+/g, '-')}`}>
              <div className="text-lg font-semibold tracking-tight">{t.name}</div>
              <p className="mt-1 text-sm leading-relaxed text-mute">{t.blurb}</p>
              <div className="mt-4"><Chain types={t.graph.nodes.map((x) => x.type)} /></div>
            </button>
          ))}
        </div>
      </section>
    </div>
  )
}
