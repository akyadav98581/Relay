import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft } from '@phosphor-icons/react'
import { api, ApiError } from '../api'
import FlowDemo from '../components/FlowDemo'
import Logo from '../components/Logo'

export default function Auth() {
  const [params] = useSearchParams()
  const [mode, setMode] = useState<'login' | 'register'>(params.get('mode') === 'register' ? 'register' : 'login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const nav = useNavigate()
  const qc = useQueryClient()

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const user = await (mode === 'login' ? api.login : api.register)(email, password)
      qc.setQueryData(['me'], user)
      nav('/workflows')
    } catch (err) {
      setError(err instanceof ApiError ? (err.details?.[0] ?? err.message) : 'Could not reach the server.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid min-h-full lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <section className="flex flex-col justify-between px-6 py-8 sm:px-14 sm:py-10">
        <div className="flex items-center justify-between">
          <Link to="/" aria-label="Relay home"><Logo /></Link>
          <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-mute hover:text-ink"><ArrowLeft size={14} weight="bold" /> Back</Link>
        </div>

        <div className="mx-auto w-full max-w-md py-10">
          <h1 className="rise display text-4xl sm:text-5xl" style={{ '--i': 0 } as React.CSSProperties}>
            {mode === 'login' ? 'Welcome back.' : 'Make an account.'}
          </h1>
          <p className="rise mt-3 text-mute" style={{ '--i': 1 } as React.CSSProperties}>
            {mode === 'login' ? 'Sign in to see your workflows and their runs.' : 'It takes a few seconds, and there is nothing to set up.'}
          </p>

          <form onSubmit={submit} className="rise glass mt-8 space-y-4 p-6" style={{ '--i': 2 } as React.CSSProperties}>
            <div>
              <label className="label" htmlFor="email">Email</label>
              <input id="email" className="field" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
            </div>
            <div>
              <label className="label" htmlFor="password">Password</label>
              <input id="password" className="field" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
              {mode === 'register' && <p className="mt-1.5 text-xs text-mute">At least 8 characters.</p>}
            </div>
            {error && <p role="alert" className="rounded-lg border border-red-ink/20 bg-red-wash px-3 py-2 text-sm text-red-ink">{error}</p>}
            <button className="btn btn-primary btn-lg w-full" disabled={busy} type="submit">{mode === 'login' ? 'Sign in' : 'Create account'}</button>
          </form>
          <p className="mt-5 text-center text-sm text-mute">
            {mode === 'login' ? 'New here? ' : 'Already have one? '}
            <button type="button" className="text-ink underline decoration-white/30 underline-offset-4 hover:decoration-white" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(null) }}>
              {mode === 'login' ? 'I need an account' : 'I already have one'}
            </button>
          </p>
        </div>

        <p className="text-xs text-dim">Webhooks and schedules run on the server. Calls to private addresses are refused.</p>
      </section>

      <section className="relative hidden items-center justify-center border-l border-white/[0.07] p-10 lg:flex" aria-hidden="true">
        <div className="w-full max-w-xl"><FlowDemo /></div>
      </section>
    </div>
  )
}
