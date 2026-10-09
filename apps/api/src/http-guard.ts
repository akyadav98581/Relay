import dns from 'node:dns'
import net from 'node:net'
import { Agent, fetch as undiciFetch } from 'undici'

// The http node calls URLs that users type in. Without a guard that is a way to reach
// things only the server can reach: its own localhost, the cloud metadata address,
// the private network. We refuse those at the connection, so a hostname that resolves
// to a private address and a redirect to one are both caught.

const blocked = new net.BlockList()
const V4: [string, number][] = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
  ['224.0.0.0', 4], ['240.0.0.0', 4],
]
const V6: [string, number][] = [
  ['::', 128], ['::1', 128], ['64:ff9b::', 96], ['100::', 64], ['2001::', 32], ['2001:db8::', 32],
  ['2002::', 16], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8],
]
for (const [a, p] of V4) blocked.addSubnet(a, p, 'ipv4')
for (const [a, p] of V6) blocked.addSubnet(a, p, 'ipv6')

// "::ffff:7f00:1" is 127.0.0.1 wearing an IPv6 coat. Unwrap it and check the IPv4 inside.
// (Putting ::ffff:0:0/96 in the block list would block every IPv4 address, because
// BlockList compares IPv4 against IPv6 ranges as mapped addresses.)
function unwrapMapped(ip: string): string | null {
  const host = new URL(`http://[${ip}]/`).hostname // canonical form, e.g. [::ffff:7f00:1]
  const m = host.match(/^\[::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})\]$/)
  if (!m) return null
  const hi = parseInt(m[1]!, 16)
  const lo = parseInt(m[2]!, 16)
  return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`
}

export function isBlockedIp(ip: string): boolean {
  const v = net.isIP(ip)
  if (!v) return true // not an address at all, do not guess
  if (v === 6) {
    const inner = unwrapMapped(ip)
    if (inner) return isBlockedIp(inner)
  }
  return blocked.check(ip, v === 4 ? 'ipv4' : 'ipv6')
}

export class BlockedError extends Error {
  constructor(what: string) {
    super(`blocked: ${what} is not a public address`)
    this.name = 'BlockedError'
  }
}

type LookupCb = (err: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void

const guardedLookup = (hostname: string, options: dns.LookupOptions, cb: LookupCb) => {
  dns.lookup(hostname, { ...options, all: true }, (err, addrs) => {
    if (err) return cb(err, '')
    const list = addrs as dns.LookupAddress[]
    if (list.length === 0 || list.some((a) => isBlockedIp(a.address))) return cb(new BlockedError(hostname) as NodeJS.ErrnoException, '')
    if (options.all) return cb(null, list)
    cb(null, list[0]!.address, list[0]!.family)
  })
}

const guardedAgent = new Agent({ connect: { lookup: guardedLookup as never } })
const plainAgent = new Agent()

export type SafeResponse = {
  status: number
  ok: boolean
  headers: Record<string, string>
  body: unknown
  truncated: boolean
  url: string
}

export type FetchOnce = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal: AbortSignal; allowPrivate: boolean }) => Promise<{
  status: number
  headers: Headers
  text: (maxBytes: number) => Promise<{ text: string; truncated: boolean }>
}>

// undici hides the real reason inside `cause`. Dig the guard's error back out.
function findBlocked(err: unknown): BlockedError | null {
  for (let e = err as { cause?: unknown; errors?: unknown[] } | undefined, depth = 0; e && depth < 5; e = e.cause as typeof e, depth++) {
    if (e instanceof BlockedError) return e
    for (const inner of e.errors ?? []) if (inner instanceof BlockedError) return inner
  }
  return null
}

const realFetchOnce: FetchOnce = async (url, init) => {
  const res = await undiciFetch(url, {
    method: init.method,
    headers: init.headers,
    body: init.body,
    signal: init.signal,
    redirect: 'manual',
    dispatcher: init.allowPrivate ? plainAgent : guardedAgent,
  }).catch((err) => { throw findBlocked(err) ?? err })
  return {
    status: res.status,
    headers: res.headers as unknown as Headers,
    async text(maxBytes) {
      if (!res.body) return { text: '', truncated: false }
      const reader = res.body.getReader()
      const chunks: Uint8Array[] = []
      let size = 0
      let truncated = false
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.byteLength
        chunks.push(value)
        if (size > maxBytes) { truncated = true; await reader.cancel(); break }
      }
      const buf = Buffer.concat(chunks).subarray(0, maxBytes)
      return { text: buf.toString('utf8'), truncated }
    },
  }
}

function checkUrl(raw: string, allowPrivate: boolean): URL {
  let u: URL
  try { u = new URL(raw) } catch { throw new Error(`not a valid URL: ${raw.slice(0, 80)}`) }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('only http and https URLs are allowed')
  if (u.username || u.password) throw new Error('URLs with a username or password are not allowed')
  if (!allowPrivate) {
    // The URL parser has already turned 2130706433, 0x7f.1 and 127.1 into 127.0.0.1.
    const host = u.hostname.replace(/^\[|\]$/g, '')
    if (net.isIP(host) && isBlockedIp(host)) throw new BlockedError(host)
  }
  return u
}

export type SafeFetchOpts = {
  allowPrivate?: boolean
  timeoutMs?: number
  maxBytes?: number
  maxRedirects?: number
  fetchOnce?: FetchOnce // a seam for tests
}

export async function safeFetch(
  rawUrl: string,
  init: { method?: string; headers?: Record<string, string>; body?: string } = {},
  opts: SafeFetchOpts = {},
): Promise<SafeResponse> {
  const allowPrivate = opts.allowPrivate ?? false
  const maxBytes = opts.maxBytes ?? 1_000_000
  const maxRedirects = opts.maxRedirects ?? 3
  const fetchOnce = opts.fetchOnce ?? realFetchOnce
  const signal = AbortSignal.timeout(opts.timeoutMs ?? 10_000)

  let method = init.method ?? 'GET'
  let body = init.body || undefined
  let url = checkUrl(rawUrl, allowPrivate)

  for (let hop = 0; ; hop++) {
    const res = await fetchOnce(url.toString(), { method, headers: init.headers ?? {}, body: method === 'GET' ? undefined : body, signal, allowPrivate })
    const location = res.headers.get('location')
    if ([301, 302, 303, 307, 308].includes(res.status) && location) {
      if (hop >= maxRedirects) throw new Error('too many redirects')
      url = checkUrl(new URL(location, url).toString(), allowPrivate) // every hop is checked again
      if (res.status === 303 || ((res.status === 301 || res.status === 302) && method === 'POST')) { method = 'GET'; body = undefined }
      continue
    }
    const { text, truncated } = await res.text(maxBytes)
    const type = res.headers.get('content-type') ?? ''
    let parsed: unknown = text
    if (type.includes('json') && !truncated) { try { parsed = JSON.parse(text) } catch { /* keep text */ } }
    const headers: Record<string, string> = {}
    let n = 0
    res.headers.forEach((v, k) => { if (n++ < 40) headers[k] = v })
    return { status: res.status, ok: res.status >= 200 && res.status < 300, headers, body: parsed, truncated, url: url.toString() }
  }
}
