import { useEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode, type RefObject } from 'react'

const reduced = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

// True once the element has scrolled into view. Stays true, so a reveal plays once.
export function useInView<T extends Element>(): [RefObject<T | null>, boolean] {
  const ref = useRef<T>(null)
  const [seen, setSeen] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (reduced() || typeof IntersectionObserver === 'undefined') { setSeen(true); return }
    const io = new IntersectionObserver(([e]) => { if (e?.isIntersecting) { setSeen(true); io.disconnect() } }, { threshold: 0.15, rootMargin: '0px 0px -5% 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [])
  return [ref, seen]
}

// Fades and lifts its children in when they scroll into view. `delay` is in milliseconds.
export function Reveal({ children, delay = 0, className = '' }: { children: ReactNode; delay?: number; className?: string }) {
  const [ref, seen] = useInView<HTMLDivElement>()
  return <div ref={ref} className={`reveal ${seen ? 'in' : ''} ${className}`} style={{ '--d': delay } as CSSProperties}>{children}</div>
}

// Counts up to a number, and from the old number to a new one when it changes.
export function useCountUp(target: number, ms = 900): number {
  const [value, setValue] = useState(0)
  const from = useRef(0)
  useEffect(() => {
    if (reduced()) { setValue(target); from.current = target; return }
    const start = performance.now()
    const a = from.current
    let raf = 0
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / ms)
      setValue(Math.round(a + (target - a) * (1 - Math.pow(1 - t, 3))))
      if (t < 1) raf = requestAnimationFrame(tick)
      else from.current = target
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, ms])
  return value
}

// A soft light that follows the pointer. Put these on an element that has the .spot class.
export const spotlight = {
  onPointerMove(e: PointerEvent<HTMLElement>) {
    const r = e.currentTarget.getBoundingClientRect()
    e.currentTarget.style.setProperty('--mx', `${e.clientX - r.left}px`)
    e.currentTarget.style.setProperty('--my', `${e.clientY - r.top}px`)
  },
}

export function useScrolled(px = 12): boolean {
  const [scrolled, set] = useState(false)
  useEffect(() => {
    const on = () => set(window.scrollY > px)
    on()
    window.addEventListener('scroll', on, { passive: true })
    return () => window.removeEventListener('scroll', on)
  }, [px])
  return scrolled
}
