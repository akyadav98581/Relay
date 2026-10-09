import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, NavLink, Navigate, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { SignOut } from '@phosphor-icons/react'
import { api, ApiError } from './api'
import Logo from './components/Logo'
import Auth from './pages/Auth'
import Editor from './pages/Editor'
import Landing from './pages/Landing'
import RunDetail from './pages/RunDetail'
import Runs from './pages/Runs'
import Workflows from './pages/Workflows'

function Shell() {
  const me = useQuery({ queryKey: ['me'], queryFn: api.me })
  const qc = useQueryClient()
  const nav = useNavigate()
  const { pathname } = useLocation()
  if (me.isPending) return <div className="grid h-full place-items-center text-sm text-mute">Loading</div>
  if (me.error instanceof ApiError && me.error.status === 401) return <Navigate to="/login" replace />
  if (!me.data) return <div className="grid h-full place-items-center text-sm text-mute">Could not reach the server.</div>
  return (
    <div className="flex h-full flex-col">
      <header className="relative z-10 flex items-center justify-between border-b border-white/[0.07] bg-[rgba(8,9,14,0.7)] px-4 py-2.5 backdrop-blur-xl sm:px-6">
        <div className="flex items-center gap-8">
          <Link to="/workflows" aria-label="Relay"><Logo /></Link>
          <nav className="hidden sm:block">
            <NavLink to="/workflows" className={({ isActive }) => `rounded-lg px-3 py-1.5 text-sm transition ${isActive ? 'bg-white/[0.08] text-ink' : 'text-mute hover:text-ink'}`}>Workflows</NavLink>
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 font-mono text-xs text-soft sm:inline" data-testid="me">{me.data.email}</span>
          <button className="btn" onClick={async () => { await api.logout(); qc.clear(); nav('/login') }}>
            <SignOut size={14} weight="bold" /> Sign out
          </button>
        </div>
      </header>
      <main className="min-h-0 flex-1 overflow-auto"><div key={pathname} className="page-in h-full"><Outlet /></div></main>
    </div>
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<Auth />} />
      <Route element={<Shell />}>
        <Route path="/workflows" element={<Workflows />} />
        <Route path="/workflows/:id" element={<Editor />} />
        <Route path="/workflows/:id/runs" element={<Runs />} />
        <Route path="/runs/:id" element={<RunDetail />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
