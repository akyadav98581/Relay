export function ago(iso: string | null | undefined): string {
  if (!iso) return 'never'
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 5) return 'just now'
  if (s < 60) return `${s}s ago`
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} h ago`
  return `${Math.round(h / 24)} d ago`
}

export function duration(from: string | null, to: string | null): string {
  if (!from) return ''
  const ms = (to ? new Date(to).getTime() : Date.now()) - new Date(from).getTime()
  if (ms < 1000) return `${Math.max(ms, 0)} ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`
  return `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s`
}

export const clock = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' })

export function humanSeconds(s: number): string {
  if (s < 60) return `${s} s`
  if (s < 3600) return `${Math.round(s / 60)} min`
  if (s < 86400) return `${+(s / 3600).toFixed(1)} h`
  return `${+(s / 86400).toFixed(1)} d`
}
