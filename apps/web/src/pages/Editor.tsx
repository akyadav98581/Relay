import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Background, BackgroundVariant, Controls, ReactFlow, ReactFlowProvider, useReactFlow } from '@xyflow/react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, ClockCounterClockwise, FloppyDisk, Play, Warning } from '@phosphor-icons/react'
import { findProblems, isTrigger, NODE_INFO, NODE_TYPES, type NodeType } from '@relay/shared'
import { api, ApiError } from '../api'
import ConfigPanel from '../components/ConfigPanel'
import Pill from '../components/Pill'
import StepNode from '../components/StepNode'
import { isDirty, toGraph, useEditor } from '../lib/editorStore'
import { ICONS } from '../lib/nodeMeta'

const nodeTypes = { step: StepNode }
const SAMPLE = JSON.stringify({ method: 'POST', body: { hello: 'world' }, query: {}, headers: {} }, null, 2)

export default function Editor() {
  const { id = '' } = useParams()
  const wf = useQuery({ queryKey: ['workflow', id], queryFn: () => api.workflow(id), refetchOnWindowFocus: false, staleTime: Infinity })
  const load = useEditor((s) => s.load)
  const loaded = useEditor((s) => s.workflowId)

  useEffect(() => { if (wf.data) load(wf.data) }, [wf.data?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  if (wf.isError) return <div className="grid h-full place-items-center text-sm text-mute">That workflow does not exist. <Link className="ml-1 underline" to="/workflows">Back to workflows</Link></div>
  if (!wf.data || loaded !== id) return <div className="grid h-full place-items-center text-sm text-mute">Loading</div>
  return <ReactFlowProvider><Canvas webhookPath={wf.data.webhookPath} /></ReactFlowProvider>
}

function Canvas({ webhookPath }: { webhookPath: string }) {
  const { id = '' } = useParams()
  const nav = useNavigate()
  const qc = useQueryClient()
  const flow = useReactFlow()
  const s = useEditor()
  const dirty = useEditor(isDirty)
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string; list?: string[] } | null>(null)
  const [showProblems, setShowProblems] = useState(false)
  const [runDialog, setRunDialog] = useState(false)
  const [payload, setPayload] = useState(SAMPLE)
  const wrap = useRef<HTMLDivElement>(null)

  const graph = useMemo(() => toGraph(s.nodes, s.edges), [s.nodes, s.edges])
  const problems = useMemo(() => findProblems(graph).problems, [graph])
  const selected = s.nodes.find((n) => n.selected)
  const hasTrigger = s.nodes.some((n) => isTrigger(n.data.type))
  const triggerType = s.nodes.find((n) => isTrigger(n.data.type))?.data.type

  // mark steps that a problem message points at
  const shown = useMemo(
    () => s.nodes.map((n) => ({ ...n, data: { ...n.data, hasProblem: problems.some((p) => p.startsWith(`${n.data.key}:`) || p.startsWith(`${n.data.key} `)) } })),
    [s.nodes, problems],
  )

  const save = useCallback(async (): Promise<boolean> => {
    const st = useEditor.getState()
    setBusy('save')
    try {
      const saved = await api.saveWorkflow(id, { name: st.name.trim() || 'Untitled workflow', graph: toGraph(st.nodes, st.edges), enabled: st.enabled })
      st.markSaved(saved)
      qc.setQueryData(['workflow', id], saved)
      qc.invalidateQueries({ queryKey: ['workflows'] })
      setMessage({ kind: 'ok', text: saved.problems.length ? 'Saved as a draft. Fix the problems before turning it on.' : 'Saved.' })
      return true
    } catch (e) {
      setMessage({ kind: 'error', text: e instanceof ApiError ? e.message : 'Could not save.', list: e instanceof ApiError ? e.details : undefined })
      return false
    } finally {
      setBusy(null)
    }
  }, [id, qc])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); void save() } }
    const onLeave = (e: BeforeUnloadEvent) => { if (isDirty(useEditor.getState())) e.preventDefault() }
    window.addEventListener('keydown', onKey)
    window.addEventListener('beforeunload', onLeave)
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('beforeunload', onLeave) }
  }, [save])

  const toggle = async () => {
    const next = !s.enabled
    setBusy('toggle')
    try {
      if (dirty && !(await save())) return
      const saved = await api.saveWorkflow(id, { enabled: next })
      s.markSaved(saved)
      qc.setQueryData(['workflow', id], saved)
      qc.invalidateQueries({ queryKey: ['workflows'] })
      setMessage({ kind: 'ok', text: next ? 'Turned on.' : 'Turned off.' })
    } catch (e) {
      setMessage({ kind: 'error', text: e instanceof ApiError ? e.message : 'Could not change that.', list: e instanceof ApiError ? e.details : undefined })
    } finally {
      setBusy(null)
    }
  }

  const run = async (body?: unknown) => {
    setBusy('run')
    try {
      if (dirty && !(await save())) return
      const { runId } = await api.runWorkflow(id, body)
      nav(`/runs/${runId}`)
    } catch (e) {
      setMessage({ kind: 'error', text: e instanceof ApiError ? e.message : 'Could not start the run.', list: e instanceof ApiError ? e.details : undefined })
    } finally {
      setBusy(null)
      setRunDialog(false)
    }
  }

  const startRun = () => {
    if (triggerType === 'webhook') return setRunDialog(true)
    void run({ manual: true, firedAt: new Date().toISOString() })
  }

  let payloadError: string | null = null
  try { JSON.parse(payload) } catch { payloadError = 'That is not valid JSON.' }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const type = e.dataTransfer.getData('application/relay-node') as NodeType
    if (!NODE_TYPES.includes(type) || (isTrigger(type) && hasTrigger)) return
    s.addNode(type, flow.screenToFlowPosition({ x: e.clientX, y: e.clientY }))
  }

  return (
    <div className="flex h-full flex-col">
      <header className="relative z-10 flex flex-wrap items-center gap-3 border-b border-white/[0.07] bg-[rgba(10,11,17,0.6)] px-4 py-2.5 backdrop-blur-xl">
        <Link to="/workflows" aria-label="Back to workflows" className="grid size-9 place-items-center rounded-lg text-mute transition hover:bg-white/[0.08] hover:text-ink"><ArrowLeft size={16} weight="bold" /></Link>
        <input aria-label="Workflow name" className="display min-w-0 flex-1 rounded-lg bg-transparent px-2 py-1 text-[1.6rem] outline-none transition hover:bg-white/[0.05] focus:bg-white/[0.07] sm:max-w-md" value={s.name} onChange={(e) => s.setName(e.target.value)} />
        <Pill status={s.enabled ? 'on' : 'idle'} label={s.enabled ? 'On' : 'Draft'} testId="state" />
        {dirty && <span className="text-xs text-mute" data-testid="dirty">Unsaved changes</span>}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button className="btn" onClick={() => setShowProblems((v) => !v)} aria-expanded={showProblems} disabled={problems.length === 0}>
            <Warning size={14} weight="bold" className={problems.length ? 'text-yellow-ink' : ''} /> {problems.length === 0 ? 'No problems' : `${problems.length} problem${problems.length === 1 ? '' : 's'}`}
          </button>
          <Link to={`/workflows/${id}/runs`} className="btn"><ClockCounterClockwise size={14} weight="bold" /> Runs</Link>
          <button className="btn" onClick={startRun} disabled={busy !== null || problems.length > 0}><Play size={14} weight="bold" /> Run now</button>
          <button className="btn" onClick={toggle} disabled={busy !== null || (!s.enabled && problems.length > 0)} aria-pressed={s.enabled}>{s.enabled ? 'Turn off' : 'Turn on'}</button>
          <button className="btn btn-primary" onClick={() => void save()} disabled={busy !== null || !dirty}><FloppyDisk size={14} weight="bold" /> Save</button>
        </div>
      </header>

      {message && (
        <div role="status" className={`slide-down flex items-start justify-between gap-4 border-b border-line px-4 py-2 text-sm ${message.kind === 'ok' ? 'bg-green-wash text-green-ink' : 'bg-red-wash text-red-ink'}`}>
          <div>
            <p>{message.text}</p>
            {message.list && <ul className="mt-1 list-disc pl-5 text-xs">{message.list.map((p) => <li key={p}>{p}</li>)}</ul>}
          </div>
          <button className="text-xs underline" onClick={() => setMessage(null)}>Dismiss</button>
        </div>
      )}
      {showProblems && problems.length > 0 && (
        <ul className="list-disc space-y-0.5 border-b border-line bg-yellow-wash py-2 pl-9 pr-4 text-xs text-yellow-ink" data-testid="problems">{problems.map((p) => <li key={p}>{p}</li>)}</ul>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] md:grid-cols-[190px_minmax(0,1fr)] xl:grid-cols-[190px_minmax(0,1fr)_340px]">
        <aside className="hidden border-r border-white/[0.07] bg-black/25 p-3 md:block" aria-label="Steps you can add">
          <p className="label px-1">Add a step</p>
          <div className="space-y-1.5">
            {NODE_TYPES.map((t) => {
              const Icon = ICONS[t]
              const off = isTrigger(t) && hasTrigger
              return (
                <button
                  key={t}
                  data-testid={`add-${t}`}
                  disabled={off}
                  draggable={!off}
                  onDragStart={(e) => e.dataTransfer.setData('application/relay-node', t)}
                  onClick={() => s.addNode(t)}
                  title={off ? 'A workflow has one trigger' : NODE_INFO[t].blurb}
                  data-t={t}
                  className="flex w-full items-center gap-2.5 rounded-xl border border-white/[0.08] bg-white/[0.03] px-2.5 py-2 text-left text-sm transition hover:border-[color-mix(in_srgb,var(--c)_45%,transparent)] hover:bg-white/[0.07] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <span className="step-icon" style={{ width: 26, height: 26, borderRadius: 8 }}><Icon size={14} weight="bold" /></span> {NODE_INFO[t].label}
                </button>
              )
            })}
          </div>
          <p className="mt-4 px-1 text-xs leading-relaxed text-mute">Click to add, or drag onto the canvas. Drag from the right dot of a step to the left dot of another to connect them.</p>
        </aside>

        <div ref={wrap} className="dots-bg relative min-h-0" onDrop={onDrop} onDragOver={(e) => e.preventDefault()} data-testid="canvas">
          <ReactFlow
            nodes={shown}
            edges={s.edges}
            nodeTypes={nodeTypes}
            onNodesChange={s.onNodesChange}
            onEdgesChange={s.onEdgesChange}
            onConnect={s.connect}
            isValidConnection={(c) => s.canConnect({ source: c.source, target: c.target })}
            deleteKeyCode={['Backspace', 'Delete']}
            fitView
            fitViewOptions={{ padding: 0.4, maxZoom: 1 }}
            minZoom={0.3}
            maxZoom={1.6}
            proOptions={{ hideAttribution: true }}
            colorMode="dark"
          >
            <Background variant={BackgroundVariant.Dots} gap={26} size={1.3} color="rgba(255,255,255,0.1)" />
            <Controls showInteractive={false} />
          </ReactFlow>
          {s.nodes.length === 0 && <p className="pointer-events-none absolute inset-0 grid place-items-center text-sm text-mute">Add a trigger to start.</p>}
        </div>

        <aside className="hidden overflow-y-auto border-l border-white/[0.07] bg-black/25 xl:block" aria-label="Step settings" data-testid="panel">
          {selected ? <ConfigPanel node={selected} webhookPath={webhookPath} /> : <p className="p-4 text-sm leading-relaxed text-mute">Select a step to edit it.</p>}
        </aside>
      </div>

      {selected && (
        <div className="max-h-[45vh] overflow-y-auto border-t border-white/[0.07] bg-black/40 xl:hidden" aria-label="Step settings">
          <ConfigPanel node={selected} webhookPath={webhookPath} />
        </div>
      )}

      {runDialog && (
        <div className="fixed inset-0 z-20 grid place-items-center bg-black/60 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Run with a test request">
          <div className="glass w-full max-w-lg bg-[#0e1018] p-6">
            <h2 className="display text-2xl">Run with a test request</h2>
            <p className="mt-1 text-sm text-mute">This is what a webhook call would hand to the workflow. Steps read it as <code className="font-mono text-soft">trigger.body</code>.</p>
            <textarea className="field mt-4" rows={9} value={payload} onChange={(e) => setPayload(e.target.value)} spellCheck={false} aria-label="Test payload" />
            {payloadError && <p className="mt-1 text-xs text-red-ink">{payloadError}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button className="btn" onClick={() => setRunDialog(false)}>Cancel</button>
              <button className="btn btn-primary" disabled={!!payloadError || busy !== null} onClick={() => void run(JSON.parse(payload))} data-testid="run-confirm">Run</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
