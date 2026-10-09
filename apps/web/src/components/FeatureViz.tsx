import { useMemo } from 'react'
import type { CSSProperties } from 'react'

// Six small loops, one per feature card. Each is plain CSS on its own clock. Keyframes are written
// here, not in the stylesheet, because a keyframe percentage cannot read a CSS variable.

const pc = (s: number, t: number) => +((s / t) * 100).toFixed(2)

// opacity or width steps: [seconds, value] pairs, then a reset at the end of the loop
function frames(name: string, t: number, prop: string, stops: [number, string][]) {
  const body = stops.map(([s, v]) => `${pc(s, t)}% { ${prop}: ${v}; }`).join(' ')
  return `@keyframes ${name} { 0% { ${prop}: ${stops[0]![1]}; } ${body} 100% { ${prop}: ${stops[0]![1]}; } }`
}
const fadeIn = (name: string, t: number, at: number, hold: number) =>
  `@keyframes ${name} { 0%, ${pc(at, t)}% { opacity: 0; transform: translateY(5px) scale(0.96); } ${pc(at + 0.35, t)}%, ${pc(hold, t)}% { opacity: 1; transform: none; } ${pc(hold + 0.4, t)}%, 100% { opacity: 0; } }`

// 1. a queue of jobs, each claimed by a worker and finished
export function QueueViz() {
  const rows: [string, string][] = [['1041', 'w1'], ['1042', 'w3'], ['1043', 'w2'], ['1044', 'w4'], ['1045', 'w1']]
  return (
    <div className="viz" aria-hidden="true">
      {rows.map(([id, w], i) => (
        <div className="viz-row" key={id}>
          <span className="text-dim">job</span><span className="text-ink">{id}</span><span className="text-dim">{w}</span>
          <span className="viz-tag" style={{ '--d': `${-i * 1.4}s` } as CSSProperties}><span className="q">queued</span><span className="r">running</span><span className="d">done</span></span>
        </div>
      ))}
    </div>
  )
}

// 2. a wait that carries on across a restart
export function DelayViz() {
  return (
    <div className="viz flex flex-col justify-center gap-4" aria-hidden="true">
      <div className="flex justify-between text-mute"><span>wait · 3 days</span><span>run_at is a row in jobs</span></div>
      <div className="h-2 overflow-hidden rounded-full bg-white/[0.07]">
        <div className="v-cycle h-full rounded-full" style={{ background: 'var(--t-delay)', animationName: 'v-fill', '--t': '8s' } as CSSProperties} />
      </div>
      <div className="h-5">
        <span className="v-cycle inline-block rounded-full border border-[var(--s-failed)]/40 bg-[var(--s-failed)]/10 px-2.5 py-0.5 text-[var(--color-red-ink)]" style={{ animationName: 'v-blip', '--t': '8s', opacity: 0 } as CSSProperties}>process restarted, wait goes on</span>
      </div>
    </div>
  )
}

// 3. retries that wait twice as long each time
export function RetryViz() {
  const T = 7
  const css = useMemo(() => [
    frames('rt0', T, 'width', [[0.5, '0%'], [1.1, '24%'], [6.3, '24%'], [6.7, '0%']]),
    frames('rt1', T, 'width', [[1.8, '0%'], [2.9, '46%'], [6.3, '46%'], [6.7, '0%']]),
    frames('rt2', T, 'width', [[3.8, '0%'], [5.4, '92%'], [6.3, '92%'], [6.7, '0%']]),
    fadeIn('rs0', T, 1.1, 6.3), fadeIn('rs1', T, 2.9, 6.3), fadeIn('rs2', T, 5.4, 6.3),
  ].join('\n'), [])
  const rows: [string, string, string, string][] = [['try 1', '503', 'var(--s-failed)', 'wait 1x'], ['try 2', '503', 'var(--s-failed)', 'wait 2x'], ['try 3', '200', 'var(--s-success)', 'ok']]
  return (
    <div className="viz flex flex-col justify-center gap-3.5" aria-hidden="true">
      <style>{css}</style>
      {rows.map(([l, code, color, note], i) => (
        <div key={l} className="flex items-center gap-3">
          <span className="w-10 text-mute">{l}</span>
          <span className="relative h-2 flex-1 overflow-hidden rounded-full bg-white/[0.06]"><span className="block h-full rounded-full" style={{ background: color, width: 0, animation: `rt${i} ${T}s linear infinite` }} /></span>
          <span className="w-[104px] whitespace-nowrap text-right" style={{ color, opacity: 0, animation: `rs${i} ${T}s linear infinite` }}>{code} · {note}</span>
        </div>
      ))}
    </div>
  )
}

// 4. an expression that never ends is stopped, and the next one runs
export function SandboxViz() {
  const T = 7
  const css = useMemo(() => [
    `@keyframes sb-spin { 0%, ${pc(3.2, T)}% { opacity: 1; } ${pc(3.4, T)}%, 100% { opacity: 0; } }`,
    fadeIn('sb-kill', T, 3.4, 6.4), fadeIn('sb-next', T, 4.6, 6.4),
  ].join('\n'), [])
  return (
    <div className="viz flex flex-col justify-center gap-3" aria-hidden="true">
      <style>{css}</style>
      <div className="relative flex h-9 items-center gap-3 rounded-lg bg-white/[0.04] px-3">
        <span className="text-mute" style={{ animation: `sb-spin ${T}s linear infinite` }}>$f := function($n) {'{ $f($n+1) }'}</span>
        <span className="ml-auto grid size-4 place-items-center" style={{ animation: `sb-spin ${T}s linear infinite` }}><span className="block size-3.5 rounded-full border-2 border-[var(--s-running)] border-t-transparent" style={{ animation: 'v-spin 0.8s linear infinite' }} /></span>
        <span className="absolute right-3 rounded-full bg-[var(--s-failed)]/15 px-2 py-0.5 text-[var(--color-red-ink)]" style={{ opacity: 0, animation: `sb-kill ${T}s linear infinite` }}>terminated · 2.0 s</span>
      </div>
      <div className="flex h-9 items-center gap-3 rounded-lg bg-white/[0.04] px-3" style={{ opacity: 0, animation: `sb-next ${T}s linear infinite` }}>
        <span className="text-mute">$sum(items.price)</span>
        <span className="ml-auto text-[var(--s-success)]">ok · 3 ms</span>
      </div>
    </div>
  )
}

// 5. addresses the server refuses to call
export function NetViz() {
  const T = 8
  const rows: [string, boolean, number][] = [['127.0.0.1', false, 0.7], ['169.254.169.254', false, 1.7], ['10.0.4.7', false, 2.7], ['api.github.com', true, 3.9]]
  const css = useMemo(() => rows.map(([, , at], i) => fadeIn(`nv${i}`, T, at, 7.2)).join('\n'), []) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="viz" aria-hidden="true">
      <style>{css}</style>
      {rows.map(([addr, ok], i) => (
        <div className="viz-row" key={addr}>
          <span className="text-ink">{addr}</span>
          <span className="ml-auto rounded-full px-2 py-px" style={{ opacity: 0, animation: `nv${i} ${T}s linear infinite`, color: ok ? 'var(--s-success)' : 'var(--color-red-ink)', background: ok ? 'rgba(94,224,160,0.13)' : 'rgba(255,107,107,0.13)' }}>{ok ? 'allowed' : 'blocked'}</span>
        </div>
      ))}
    </div>
  )
}

// 6. a run, step by step
export function RunViz() {
  const T = 9
  const steps: [string, string, number, number, string][] = [
    ['start', 'var(--t-webhook)', 0.5, 4, '0 ms'], ['big_order', 'var(--t-filter)', 1.2, 10, '3 ms'],
    ['shape', 'var(--t-transform)', 1.9, 24, '12 ms'], ['notify', 'var(--t-http)', 2.6, 62, '142 ms'], ['wait', 'var(--t-delay)', 3.5, 34, '5 min'],
  ]
  const css = useMemo(() => [
    ...steps.map(([, , at, w], i) => frames(`rn${i}`, T, 'width', [[at, '0%'], [at + 1.1, `${w}%`], [8.2, `${w}%`], [8.6, '0%']])),
    fadeIn('rn-done', T, 5.4, 8.2),
  ].join('\n'), []) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="viz !h-[168px]" aria-hidden="true">
      <style>{css}</style>
      {steps.map(([k, color, , , ms], i) => (
        <div className="viz-row !h-[24px]" key={k}>
          <span className="w-[72px] text-ink">{k}</span>
          <span className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.06]"><span className="block h-full rounded-full" style={{ width: 0, background: color, boxShadow: `0 0 10px ${color}`, animation: `rn${i} ${T}s linear infinite` }} /></span>
          <span className="w-12 text-right text-dim">{ms}</span>
        </div>
      ))}
      <div className="absolute bottom-2.5 right-3 rounded-full border border-[var(--s-success)]/30 bg-[var(--s-success)]/12 px-2.5 py-0.5 text-[var(--s-success)]" style={{ opacity: 0, animation: `rn-done ${T}s linear infinite` }}>run success · 1.2 s</div>
    </div>
  )
}
