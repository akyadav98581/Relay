import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { BracketsCurly, Funnel, Globe, HourglassMedium, WebhooksLogo } from '@phosphor-icons/react'
import type { Icon } from '@phosphor-icons/react'
import { TYPE_COLOR } from '../lib/nodeMeta'
import type { NodeType } from '@relay/shared'

// A looping picture of one request. A curl line types itself, the webhook lights up, dots travel
// down the edges, and each step lights up when its dot arrives. Everything is CSS, timed from one clock.
const W = 640
const H = 262
const NODE_W = 188
const CYCLE = 10
const CURL = `curl -X POST relay.app/hooks/order-alert -d '{"amount":300}'`

type N = { x: number; y: number; type: NodeType; key: string; line: string; icon: Icon; lit: number }
const NODES: N[] = [
  { x: 0, y: 90, type: 'webhook', key: 'start', line: 'When its URL is called', icon: WebhooksLogo, lit: 3.0 },
  { x: 226, y: 6, type: 'filter', key: 'big_order', line: 'amount > 100', icon: Funnel, lit: 4.3 },
  { x: 226, y: 174, type: 'transform', key: 'shape', line: '{ "who": name }', icon: BracketsCurly, lit: 4.3 },
  { x: 452, y: 6, type: 'http', key: 'notify', line: 'POST hooks.example/alert', icon: Globe, lit: 5.6 },
  { x: 452, y: 174, type: 'delay', key: 'wait', line: 'wait 5 min', icon: HourglassMedium, lit: 5.6 },
]
const EDGES: { a: number; b: number; start: number }[] = [
  { a: 0, b: 1, start: 3.2 }, { a: 0, b: 2, start: 3.2 }, { a: 1, b: 3, start: 4.5 }, { a: 2, b: 4, start: 4.5 },
]
const TRAVEL = 1.0
const TICKS: [string, string, string, number][] = [
  ['start', 'received', '0 ms', 3.1],
  ['big_order', 'pass: true', '3 ms', 4.4],
  ['notify', 'HTTP 200', '142 ms', 5.8],
]

const mid = (n: N) => n.y + 40
const curve = (a: N, b: N) => {
  const x1 = a.x + NODE_W, y1 = mid(a), x2 = b.x, y2 = mid(b)
  const c = (x2 - x1) / 2
  return `M ${x1} ${y1} C ${x1 + c} ${y1}, ${x2 - c} ${y2}, ${x2} ${y2}`
}
const pct = (s: number) => +((s / CYCLE) * 100).toFixed(2)

export default function FlowDemo() {
  const box = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)
  useEffect(() => {
    const el = box.current
    if (!el) return
    const fit = () => setScale(Math.min(1, el.clientWidth / W))
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // keyframes are generated from the timings above, so changing a time changes everything that depends on it
  const css = useMemo(() => {
    const out: string[] = []
    NODES.forEach((n, i) => {
      const c = TYPE_COLOR[n.type]
      out.push(`@keyframes dn-${i} { 0%, ${pct(n.lit) - 0.1}% { filter: brightness(0.7); box-shadow: 0 14px 34px -18px transparent; } ${pct(n.lit) + 2}%, ${pct(n.lit) + 30}% { filter: brightness(1.18); box-shadow: 0 0 34px -6px ${c}; } ${pct(n.lit) + 36}%, 100% { filter: brightness(0.7); } }`)
    })
    EDGES.forEach((e, i) => {
      const s = pct(e.start), f = pct(e.start + TRAVEL)
      out.push(`@keyframes dd-${i} { 0%, ${s}% { offset-distance: 0%; opacity: 0; } ${s + 0.6}% { opacity: 1; } ${f}% { offset-distance: 100%; opacity: 1; } ${f + 0.5}%, 100% { offset-distance: 100%; opacity: 0; } }`)
      const col = TYPE_COLOR[NODES[e.b]!.type]
      out.push(`@keyframes de-${i} { 0%, ${s}% { stroke: rgba(255,246,225,0.18); } ${s + 1}%, ${f + 12}% { stroke: ${col}; } ${f + 24}%, 100% { stroke: rgba(255,246,225,0.18); } }`)
    })
    TICKS.forEach(([, , , t], i) => out.push(`@keyframes dt-${i} { 0%, ${pct(t)}% { opacity: 0; transform: translateY(6px); } ${pct(t) + 2}%, 90% { opacity: 1; transform: none; } 96%, 100% { opacity: 0; } }`))
    out.push(`@keyframes d-resp { 0%, ${pct(2.9)}% { opacity: 0; } ${pct(2.9) + 1.5}%, 92% { opacity: 1; } 97%, 100% { opacity: 0; } }`)
    return out.join('\n')
  }, [])

  return (
    <div className="glass overflow-hidden" aria-hidden="true">
      <style>{css}</style>
      <div className="border-b border-white/[0.07] bg-black/30 px-4 py-3 font-mono text-[11.5px] leading-relaxed sm:px-5">
        <div className="flex items-center gap-2 text-soft">
          <span className="text-[var(--accent)]">$</span>
          <span className="typed" style={{ '--n': CURL.length, '--cycle': `${CYCLE}s` } as CSSProperties}>{CURL}</span>
          <span className="caret" />
        </div>
        <div className="mt-1 text-[var(--s-success)]" style={{ animation: `d-resp ${CYCLE}s linear infinite` }}>{'<-'} 202 {'{ "runId": "9f3c…" }'}</div>
      </div>
      <div className="p-4 sm:p-5">
        <div ref={box} className="dots-bg rounded-xl border border-white/[0.06]" style={{ height: H * scale }}>
          <div style={{ width: W, height: H, transform: `scale(${scale})`, transformOrigin: 'top left', position: 'relative' }}>
            <svg width={W} height={H} className="absolute inset-0 overflow-visible">
              {EDGES.map((e, i) => (
                <path key={i} d={curve(NODES[e.a]!, NODES[e.b]!)} fill="none" strokeWidth="1.8" style={{ animation: `de-${i} ${CYCLE}s linear infinite`, stroke: 'rgba(255,246,225,0.18)' }} />
              ))}
            </svg>
            {EDGES.map((e, i) => {
              const color = TYPE_COLOR[NODES[e.b]!.type]
              return (
                <span
                  key={i}
                  className="absolute left-0 top-0 block size-3 rounded-full"
                  style={{ offsetPath: `path('${curve(NODES[e.a]!, NODES[e.b]!)}')`, offsetRotate: '0deg', marginLeft: -6, marginTop: -6, background: color, boxShadow: `0 0 14px 2px ${color}`, animation: `dd-${i} ${CYCLE}s linear infinite`, opacity: 0 }}
                />
              )
            })}
            {NODES.map((n, i) => {
              const Icon = n.icon
              return (
                <div key={n.key} className="step absolute" data-t={n.type} style={{ left: n.x, top: n.y, width: NODE_W, animation: `dn-${i} ${CYCLE}s linear infinite` } as CSSProperties}>
                  <div className="flex items-center gap-2.5">
                    <span className="step-icon"><Icon size={15} weight="bold" /></span>
                    <div className="min-w-0">
                      <div className="font-mono text-[9.5px] uppercase tracking-[0.1em] text-mute">{n.type}</div>
                      <div className="truncate font-mono text-[12.5px]">{n.key}</div>
                    </div>
                  </div>
                  <div className="mt-1.5 truncate font-mono text-[10.5px] text-dim">{n.line}</div>
                </div>
              )
            })}
          </div>
        </div>
        <ul className="mt-3 space-y-1.5 font-mono text-[11.5px]">
          {TICKS.map(([k, v, t], i) => (
            <li key={k} className="flex items-center gap-3 rounded-lg bg-white/[0.035] px-3 py-1.5" style={{ animation: `dt-${i} ${CYCLE}s linear infinite`, opacity: 0 }}>
              <span className="size-1.5 rounded-full bg-[var(--s-success)] shadow-[0_0_8px_var(--s-success)]" />
              <span className="text-ink">{k}</span>
              <span className="text-mute">{v}</span>
              <span className="ml-auto text-dim">{t}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
