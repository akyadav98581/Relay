import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Background, BackgroundVariant, ReactFlow, ReactFlowProvider, type Edge } from '@xyflow/react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, CaretRight } from '@phosphor-icons/react'
import type { NodeType, RunStepView, RunView } from '@relay/shared'
import { api } from '../api'
import Pill from '../components/Pill'
import StepNode from '../components/StepNode'
import { toFlow, type FlowNode } from '../lib/editorStore'
import { clock, duration } from '../lib/format'
import { ICONS } from '../lib/nodeMeta'

const nodeTypes = { step: StepNode }
const ACTIVE = new Set(['queued', 'running', 'waiting'])

function Json({ value }: { value: unknown }) {
  const [all, setAll] = useState(false)
  const text = JSON.stringify(value, null, 2) ?? 'null'
  const long = text.length > 4000
  return (
    <div>
      <pre className="max-h-96 overflow-auto rounded-xl border border-white/[0.07] bg-black/30 p-3.5 font-mono text-xs leading-relaxed text-soft">{long && !all ? text.slice(0, 4000) + '\n…' : text}</pre>
      {long && <button className="mt-1.5 text-xs text-mute underline" onClick={() => setAll(!all)}>{all ? 'Show less' : `Show all ${text.length.toLocaleString()} characters`}</button>}
    </div>
  )
}

// The result icon draws itself each time the run changes state.
function Result({ status, tone }: { status: string; tone: string }) {
  const done = status === 'success' || status === 'failed'
  return (
    <span key={status} className={`relative grid size-14 place-items-center rounded-2xl ${done ? 'burst' : ''}`} style={{ '--tone': tone, color: tone, background: `color-mix(in srgb, ${tone} 14%, transparent)`, border: `1px solid color-mix(in srgb, ${tone} 35%, transparent)`, boxShadow: `0 0 28px -6px ${tone}` } as React.CSSProperties}>
      <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        {status === 'success' && <path className="draw-in" style={{ '--len': 24 } as React.CSSProperties} d="M5 12.5l4.5 4.5L19 7.5" />}
        {status === 'failed' && <><path className="draw-in" style={{ '--len': 18 } as React.CSSProperties} d="M6.5 6.5l11 11" /><path className="draw-in" style={{ '--len': 18, '--delay': '160ms' } as React.CSSProperties} d="M17.5 6.5l-11 11" /></>}
        {!done && <path className="animate-spin" style={{ transformOrigin: 'center' }} d="M12 3a9 9 0 1 0 9 9" />}
      </svg>
    </span>
  )
}

function Step({ step, open, onToggle, share, i }: { step: RunStepView; open: boolean; onToggle: (open: boolean) => void; share: number; i: number }) {
  const Icon = ICONS[step.type as NodeType]
  const http = step.type === 'http' && step.output && typeof step.output === 'object' ? (step.output as { status?: number; ok?: boolean }) : null
  const bar = step.status === 'failed' ? 'var(--s-failed)' : step.status === 'success' ? 'var(--s-success)' : 'var(--s-running)'
  return (
    <li id={`step-row-${step.key}`} className="rise" style={{ '--i': i } as React.CSSProperties}>
      <details open={open} onToggle={(e) => onToggle((e.currentTarget as HTMLDetailsElement).open)} className="group" data-testid={`step-${step.key}`} data-status={step.status}>
        <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3.5 transition hover:bg-white/[0.04] sm:px-5">
          <CaretRight size={12} weight="bold" className="text-dim transition group-open:rotate-90" />
          <span className="step-icon" data-t={step.type} style={{ width: 26, height: 26, borderRadius: 8 }}>{Icon && <Icon size={14} weight="bold" />}</span>
          <span className="font-mono text-sm">{step.key}</span>
          <Pill status={step.status} />
          {http && <span className={`font-mono text-xs ${http.ok ? 'text-mute' : 'text-red-ink'}`}>HTTP {http.status}</span>}
          {step.attempts > 1 && <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-xs text-soft">{step.attempts} attempts</span>}
          <span className="ml-auto hidden w-24 sm:block"><span className="block h-1 overflow-hidden rounded-full bg-white/[0.07]"><span className="block h-full rounded-full" style={{ width: `${Math.max(4, share * 100)}%`, background: bar }} /></span></span>
          <span className="w-16 text-right font-mono text-xs text-mute">{step.startedAt ? duration(step.startedAt, step.finishedAt) : ''}</span>
        </summary>
        <div className="space-y-4 border-t border-white/[0.07] bg-black/20 px-5 py-5 sm:px-12">
          {step.error && <p className="rounded-xl border border-red-ink/20 bg-red-wash px-3.5 py-2.5 font-mono text-xs text-red-ink" data-testid="step-error">{step.error}</p>}
          {step.status === 'skipped' && <p className="text-sm text-mute">Skipped: nothing reached this step.</p>}
          {step.input != null && <div><p className="label">Input</p><Json value={step.input} /></div>}
          {step.output != null && <div><p className="label">Output</p><Json value={step.output} /></div>}
          {step.input == null && step.output == null && !step.error && step.status !== 'skipped' && <p className="text-sm text-mute">Nothing recorded yet.</p>}
        </div>
      </details>
    </li>
  )
}

// The graph the run started with, lit by what happened: green for done, amber while running, dashed where nothing reached.
function RunGraph({ run, onPick }: { run: RunView; onPick: (key: string) => void }) {
  const { nodes, edges } = useMemo(() => {
    const flow = toFlow(run.graph)
    const status = new Map(run.steps.map((s) => [s.nodeId, s.status]))
    const nodes: FlowNode[] = flow.nodes.map((n) => ({ ...n, draggable: false, connectable: false, data: { ...n.data, status: status.get(n.id) } }))
    const edges: Edge[] = flow.edges.map((e) => {
      const from = status.get(e.source)
      const to = status.get(e.target)
      const cls = to && ACTIVE.has(to) && from === 'success' ? 'live' : to === 'skipped' ? 'cut' : to === 'success' || to === 'failed' ? 'done' : ''
      return { ...e, className: cls }
    })
    return { nodes, edges }
  }, [run])

  return (
    <div className="glass dots-bg h-[280px] overflow-hidden" data-testid="run-graph">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        nodesDraggable={false}
        nodesConnectable={false}
        panOnScroll={false}
        zoomOnScroll={false}
        onNodeClick={(_, n) => onPick((n as FlowNode).data.key)}
        fitView
        fitViewOptions={{ padding: 0.22, maxZoom: 1 }}
        minZoom={0.3}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={26} size={1} color="rgba(255,255,255,0.05)" />
      </ReactFlow>
    </div>
  )
}

export default function RunDetail() {
  const { id = '' } = useParams()
  const [run, setRun] = useState<RunView | null>(null)
  const [missing, setMissing] = useState(false)
  const [open, setOpen] = useState<Set<string>>(new Set())
  const seeded = useRef(false)

  // The server pushes a message whenever the run changes, and closes the stream when it finishes.
  useEffect(() => {
    const es = new EventSource(`/api/runs/${id}/events`)
    es.onmessage = (e) => {
      const v = JSON.parse(e.data) as RunView
      setRun(v)
      if (v.status !== 'running') es.close()
    }
    es.onerror = () => {
      es.close()
      api.run(id).then(setRun).catch(() => setMissing(true))
    }
    return () => es.close()
  }, [id])

  // open the step that failed, or the one running, once
  useEffect(() => {
    if (!run) return
    const want = run.steps.filter((s) => s.status === 'failed' || s.status === 'running').map((s) => s.key)
    if (want.length) setOpen((cur) => new Set([...cur, ...want]))
    seeded.current = true
  }, [run?.steps.map((s) => s.status).join(',')]) // eslint-disable-line react-hooks/exhaustive-deps

  const wf = useQuery({ queryKey: ['workflow', run?.workflowId], queryFn: () => api.workflow(run!.workflowId), enabled: !!run, staleTime: 60_000 })
  const [, tick] = useState(0)
  useEffect(() => {
    if (run?.status !== 'running') return
    const t = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [run?.status])

  if (missing) return <p className="p-10 text-center text-sm text-mute">That run does not exist.</p>
  if (!run) return <p className="p-10 text-center text-sm text-mute">Loading</p>

  const total = Math.max(1, (run.finishedAt ? new Date(run.finishedAt).getTime() : Date.now()) - new Date(run.startedAt).getTime())
  const share = (s: RunStepView) => (s.startedAt ? (((s.finishedAt ? new Date(s.finishedAt).getTime() : Date.now()) - new Date(s.startedAt).getTime()) / total) : 0)
  const tone = run.status === 'success' ? 'var(--s-success)' : run.status === 'failed' ? 'var(--s-failed)' : 'var(--s-running)'
  const done = run.steps.filter((s) => s.status === 'success').length
  const pick = (key: string) => {
    setOpen((cur) => new Set([...cur, key]))
    setTimeout(() => document.getElementById(`step-row-${key}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60)
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <Link to={`/workflows/${run.workflowId}/runs`} className="inline-flex items-center gap-1.5 text-sm text-mute transition hover:text-ink"><ArrowLeft size={14} weight="bold" /> {wf.data?.name ?? 'Runs'}</Link>

      <div className="glass mt-4 flex flex-wrap items-center gap-5 p-5 sm:p-6" style={{ boxShadow: `0 0 60px -30px ${tone}` }}>
        <Result status={run.status} tone={tone} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="display text-3xl sm:text-4xl">Run</h1>
            <Pill status={run.status} testId="run-status" />
          </div>
          <p className="mt-2 font-mono text-xs text-mute">started by {run.trigger} · {clock(run.startedAt)}</p>
        </div>
        <dl className="flex gap-6 text-sm">
          <div><dt className="text-xs text-mute">Duration</dt><dd className="mt-0.5 font-mono">{duration(run.startedAt, run.finishedAt)}</dd></div>
          <div><dt className="text-xs text-mute">Steps done</dt><dd className="mt-0.5 font-mono">{done} of {run.steps.length}</dd></div>
        </dl>
      </div>
      {run.status === 'running' && (
        <div className="mt-3 h-0.5 overflow-hidden rounded-full bg-white/[0.08]" aria-hidden="true">
          <div className="h-full w-1/3 rounded-full bg-[var(--s-running)] shadow-[0_0_10px_var(--s-running)]" style={{ animation: 'indeterminate 1.3s linear infinite' }} />
        </div>
      )}
      {run.error && <p className="mt-4 rounded-xl border border-red-ink/20 bg-red-wash px-4 py-3 text-sm text-red-ink" data-testid="run-error">{run.error}</p>}

      <div className="mt-5"><ReactFlowProvider><RunGraph run={run} onPick={pick} /></ReactFlowProvider></div>

      <h2 className="label mt-9">Steps</h2>
      <ul className="glass divide-y divide-white/[0.07] overflow-hidden" data-testid="steps">
        {run.steps.map((s, i) => (
          <Step
            key={s.nodeId}
            i={i}
            step={s}
            share={share(s)}
            open={open.has(s.key)}
            onToggle={(o) => setOpen((cur) => { const next = new Set(cur); if (o) next.add(s.key); else next.delete(s.key); return next })}
          />
        ))}
      </ul>

      <details className="glass mt-5">
        <summary className="cursor-pointer px-5 py-3.5 text-sm text-mute transition hover:text-ink">What started this run</summary>
        <div className="border-t border-white/[0.07] p-5"><Json value={run.payload} /></div>
      </details>
    </div>
  )
}
