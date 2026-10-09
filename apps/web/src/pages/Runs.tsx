import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft } from '@phosphor-icons/react'
import { api } from '../api'
import Pill from '../components/Pill'
import { ago, clock, duration } from '../lib/format'

export default function Runs() {
  const { id = '' } = useParams()
  const wf = useQuery({ queryKey: ['workflow', id], queryFn: () => api.workflow(id), staleTime: 60_000 })
  const runs = useQuery({
    queryKey: ['runs', id],
    queryFn: () => api.runs(id),
    refetchInterval: (q) => (q.state.data?.some((r) => r.status === 'running') ? 1500 : 5000),
  })

  const ms = (r: { startedAt: string; finishedAt: string | null }) => (r.finishedAt ? new Date(r.finishedAt).getTime() - new Date(r.startedAt).getTime() : 0)
  const longest = Math.max(1, ...(runs.data ?? []).map(ms))

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <Link to={`/workflows/${id}`} className="inline-flex items-center gap-1.5 text-sm text-mute transition hover:text-ink"><ArrowLeft size={14} weight="bold" /> {wf.data?.name ?? 'Workflow'}</Link>
      <h1 className="display mt-4 text-4xl sm:text-5xl">Runs</h1>

      {runs.data && runs.data.length === 0 && (
        <div className="glass mt-8 px-6 py-12 text-center text-mute">No runs yet. Use Run now in the editor, or call the webhook.</div>
      )}
      {runs.data && runs.data.length > 0 && (
        <ul className="glass mt-8 divide-y divide-white/[0.07] overflow-hidden" data-testid="run-list">
          {runs.data.map((r) => (
            <li key={r.id}>
              <Link to={`/runs/${r.id}`} className="grid grid-cols-[auto_1fr_auto] items-center gap-x-5 gap-y-1 px-5 py-3.5 transition hover:bg-white/[0.04]">
                <Pill status={r.status} />
                <div className="min-w-0">
                  <p className="text-sm" title={clock(r.startedAt)}>{ago(r.startedAt)} <span className="ml-2 font-mono text-xs text-mute">{r.trigger}</span></p>
                  {r.error && <p className="mt-0.5 truncate text-xs text-red-ink">{r.error}</p>}
                </div>
                <div className="w-28 text-right">
                  <p className="font-mono text-xs text-mute">{duration(r.startedAt, r.finishedAt)}</p>
                  <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/[0.07]">
                    <div className="h-full rounded-full" style={{ width: `${Math.max(6, (ms(r) / longest) * 100)}%`, background: r.status === 'failed' ? 'var(--s-failed)' : 'var(--s-success)' }} />
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
