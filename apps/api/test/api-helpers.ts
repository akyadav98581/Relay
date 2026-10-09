import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import jwt from 'jsonwebtoken'
import { createApp } from '../src/app.js'
import type { Config } from '../src/config.js'
import type { Db } from '../src/db/index.js'

export function listen(db: Db, config: Config, limits?: { auth?: number; hooks?: number }) {
  const server: Server = createApp({ db, config, limits: { auth: 10_000, hooks: 10_000, ...limits }, webDir: '/nonexistent' }).listen(0)
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  return { base, close: () => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()) }) }
}

// A tiny browser: keeps cookies between calls.
export function browser(base: string) {
  const jar = new Map<string, string>()
  const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ')
    const res = await fetch(base + path, {
      method,
      redirect: 'manual',
      headers: { ...(body !== undefined && typeof body !== 'string' ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...headers },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    })
    for (const line of res.headers.getSetCookie()) {
      const [kv] = line.split(';')
      const i = kv!.indexOf('=')
      const [k, v] = [kv!.slice(0, i), kv!.slice(i + 1)]
      if (v) jar.set(k, v)
      else jar.delete(k)
    }
    const text = await res.text()
    let json: any
    try { json = JSON.parse(text) } catch { /* not json */ }
    return { status: res.status, json, text, headers: res.headers }
  }
  return {
    jar,
    get: (p: string) => call('GET', p),
    post: (p: string, b?: unknown, h?: Record<string, string>) => call('POST', p, b ?? {}, h),
    put: (p: string, b?: unknown) => call('PUT', p, b ?? {}),
    del: (p: string) => call('DELETE', p),
    raw: call,
  }
}

export const forgeToken = (secret: string, sub: string) => jwt.sign({ sub }, secret)
