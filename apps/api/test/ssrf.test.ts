import { describe, expect, it } from 'vitest'
import { isBlockedIp, safeFetch, type FetchOnce } from '../src/http-guard.js'
import { testServer } from './helpers.js'

const strict = { allowPrivate: false, timeoutMs: 3000 }
const blockedMsg = /blocked/

describe('isBlockedIp', () => {
  it.each([
    '127.0.0.1', '127.9.9.9', '10.0.0.1', '10.255.255.255', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254',
    '100.64.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255', '::1', '::', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:7f00:1', 'ff02::1',
  ])('blocks %s', (ip) => expect(isBlockedIp(ip)).toBe(true))

  it.each(['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.15.0.1', '172.32.0.1', '2606:4700:4700::1111'])('allows %s', (ip) =>
    expect(isBlockedIp(ip)).toBe(false))

  it('refuses things that are not addresses', () => {
    expect(isBlockedIp('example.com')).toBe(true)
    expect(isBlockedIp('')).toBe(true)
  })
})

describe('safeFetch refuses private targets', () => {
  it.each([
    'http://127.0.0.1/', 'http://127.0.0.1:8080/admin', 'http://10.1.2.3/', 'http://192.168.0.1/', 'http://172.20.0.5/',
    'http://169.254.169.254/latest/meta-data/', 'http://100.64.0.1/', 'http://0.0.0.0/', 'http://[::1]/', 'http://[fd00::1]/',
    'http://[::ffff:127.0.0.1]/',
  ])('%s', async (url) => {
    await expect(safeFetch(url, {}, strict)).rejects.toThrow(blockedMsg)
  })

  it('catches the odd spellings of 127.0.0.1', async () => {
    for (const url of ['http://2130706433/', 'http://0x7f.0.0.1/', 'http://127.1/', 'http://0177.0.0.1/']) {
      await expect(safeFetch(url, {}, strict)).rejects.toThrow(blockedMsg)
    }
  })

  it('catches a hostname that resolves to loopback (checked at connect time)', async () => {
    const srv = await testServer()
    try {
      const port = new URL(srv.url).port
      await expect(safeFetch(`http://localhost:${port}/`, {}, strict)).rejects.toThrow(blockedMsg)
      expect(srv.hits.length).toBe(0) // the connection was never made
    } finally {
      await srv.close()
    }
  })

  it('only allows http and https, without credentials in the URL', async () => {
    await expect(safeFetch('file:///etc/passwd', {}, strict)).rejects.toThrow('only http')
    await expect(safeFetch('ftp://example.com/', {}, strict)).rejects.toThrow('only http')
    await expect(safeFetch('http://user:pw@example.com/', {}, strict)).rejects.toThrow('username')
    await expect(safeFetch('not a url', {}, strict)).rejects.toThrow('not a valid URL')
  })
})

describe('redirects are checked on every hop', () => {
  const redirectTo = (location: string): FetchOnce => {
    let calls = 0
    const fn: FetchOnce = async () => {
      calls++
      return { status: 302, headers: new Headers({ location }), text: async () => ({ text: '', truncated: false }) }
    }
    ;(fn as unknown as { calls: () => number }).calls = () => calls
    return fn
  }

  it('does not follow a redirect to the metadata address', async () => {
    const fetchOnce = redirectTo('http://169.254.169.254/latest/meta-data/')
    await expect(safeFetch('http://example.com/', {}, { ...strict, fetchOnce })).rejects.toThrow(blockedMsg)
    expect((fetchOnce as unknown as { calls: () => number }).calls()).toBe(1) // the second request was never sent
  })

  it('does not follow a relative redirect into a private address either', async () => {
    const fetchOnce = redirectTo('//127.0.0.1:9000/x')
    await expect(safeFetch('http://example.com/', {}, { ...strict, fetchOnce })).rejects.toThrow(blockedMsg)
  })

  it('gives up after too many redirects', async () => {
    const fetchOnce = redirectTo('http://example.com/again')
    await expect(safeFetch('http://example.com/', {}, { ...strict, fetchOnce, maxRedirects: 3 })).rejects.toThrow('too many redirects')
    expect((fetchOnce as unknown as { calls: () => number }).calls()).toBe(4)
  })

  it('switches POST to GET on a 303 and drops the body', async () => {
    const seen: { method: string; body?: string }[] = []
    const fetchOnce: FetchOnce = async (url, init) => {
      seen.push({ method: init.method, body: init.body })
      return seen.length === 1
        ? { status: 303, headers: new Headers({ location: 'http://example.com/next' }), text: async () => ({ text: '', truncated: false }) }
        : { status: 200, headers: new Headers({ 'content-type': 'application/json' }), text: async () => ({ text: '{"ok":true}', truncated: false }) }
    }
    const res = await safeFetch('http://example.com/', { method: 'POST', body: 'x=1' }, { ...strict, fetchOnce })
    expect(seen).toEqual([{ method: 'POST', body: 'x=1' }, { method: 'GET', body: undefined }])
    expect(res.body).toEqual({ ok: true })
  })
})

describe('safeFetch with the guard off (tests and local development)', () => {
  it('reaches a local server, parses json, caps the body size', async () => {
    const srv = await testServer((hit, n, res) => {
      if (hit.url === '/big') { res.end('x'.repeat(5000)); return true }
    })
    try {
      const ok = await safeFetch(`${srv.url}/json`, {}, { allowPrivate: true })
      expect(ok).toMatchObject({ status: 200, ok: true })
      expect((ok.body as { ok: boolean }).ok).toBe(true)
      const big = await safeFetch(`${srv.url}/big`, {}, { allowPrivate: true, maxBytes: 1000 })
      expect(big.truncated).toBe(true)
      expect((big.body as string).length).toBe(1000)
    } finally {
      await srv.close()
    }
  })

  it('times out a slow server', async () => {
    const srv = await testServer((_h, _n, res) => { setTimeout(() => res.end('late'), 2000); return true })
    try {
      await expect(safeFetch(srv.url, {}, { allowPrivate: true, timeoutMs: 150 })).rejects.toThrow()
    } finally {
      await srv.close()
    }
  })
})
