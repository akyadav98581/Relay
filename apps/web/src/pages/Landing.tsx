import type { CSSProperties } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { ArrowRight, GithubLogo, Play } from '@phosphor-icons/react'
import { api } from '../api'
import { DelayViz, NetViz, QueueViz, RetryViz, RunViz, SandboxViz } from '../components/FeatureViz'
import FlowDemo from '../components/FlowDemo'
import Logo from '../components/Logo'
import { Reveal, spotlight, useInView, useScrolled } from '../lib/motion'

const MARQUEE = ['webhook', 'schedule', 'http request', 'filter', 'transform', 'delay', 'retry with backoff', 'SKIP LOCKED', 'jsonata', 'run history', 'live run view']

type Feature = { span: string; viz: React.ReactNode; title: string; body: string }
const FEATURES: Feature[] = [
  { span: 'lg:col-span-4', viz: <QueueViz />, title: 'Postgres is the queue', body: 'Every step is a row. Workers claim rows with SKIP LOCKED, so they never wait on each other and never take the same one. The tests run eight workers and check nothing runs twice.' },
  { span: 'lg:col-span-2', viz: <DelayViz />, title: 'Waits survive restarts', body: 'A delay is a job with a time in the future. Restart the server in the middle of it and the wait carries on.' },
  { span: 'lg:col-span-2', viz: <RetryViz />, title: 'Retries that back off', body: 'Network errors and 5xx wait 1x, 2x, 4x. A 4xx is an answer, so a filter can read it.' },
  { span: 'lg:col-span-2', viz: <SandboxViz />, title: 'Expressions can not hang it', body: 'JSONata runs in worker threads. One that runs too long is killed and replaced.' },
  { span: 'lg:col-span-2', viz: <NetViz />, title: 'Private stays private', body: 'The HTTP step refuses loopback, private and metadata addresses, even behind DNS and redirects.' },
]

const STEPS: [string, string, string, string][] = [
  ['1', 'Draw it', 'Drop a trigger and a few steps on the canvas, connect them, and use earlier data in {{ }}.', '{{ trigger.body.amount }}'],
  ['2', 'Turn it on', 'Call its webhook, or give it a cron. The server takes it from there.', 'POST /hooks/9f3c…  ->  202'],
  ['3', 'Read the run', 'Each run keeps its steps, requests, answers, retries and errors.', 'notify  HTTP 200  142 ms'],
]

export default function Landing() {
  const me = useQuery({ queryKey: ['me'], queryFn: api.me, retry: false })
  const signedIn = !!me.data
  const scrolled = useScrolled()
  const [stepsRef, stepsSeen] = useInView<HTMLOListElement>()


  return (
    <div className="min-h-full overflow-x-clip">
      <header className={`sticky top-0 z-30 transition-colors duration-300 ${scrolled ? 'border-b border-white/[0.07] bg-[rgba(11,11,9,0.72)] backdrop-blur-xl' : 'border-b border-transparent'}`}>
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4 sm:px-8">
          <Link to="/" aria-label="Relay home"><Logo /></Link>
          <nav className="hidden items-center gap-8 text-sm text-mute md:flex">
            <a href="#features" className="transition hover:text-ink">What is under it</a>
            <a href="#how" className="transition hover:text-ink">How it works</a>
          </nav>
          <div className="flex items-center gap-2">
            {signedIn ? (
              <Link to="/workflows" className="btn btn-primary">Open app <ArrowRight size={14} weight="bold" className="nudge" /></Link>
            ) : (
              <>
                <Link to="/login" className="btn">Sign in</Link>
                <Link to="/login?mode=register" className="btn btn-primary hidden sm:inline-flex">Get started</Link>
              </>
            )}
          </div>
        </div>
      </header>

      <main>
        <section className="relative flex min-h-[calc(100svh-73px)] flex-col overflow-hidden">
          <div className="relative order-2 mt-12 px-5 sm:px-8 lg:absolute lg:inset-y-0 lg:right-0 lg:order-none lg:mt-0 lg:flex lg:w-[60%] lg:items-center lg:px-0 lg:pr-8">
            <div className="rise w-full" style={{ '--i': 5 } as CSSProperties}><FlowDemo /></div>
          </div>
          <div className="pointer-events-none absolute inset-0 hidden bg-gradient-to-r from-bone via-bone/85 to-transparent lg:block" style={{ right: '38%' }} />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-bone to-transparent" />

          <div className="relative z-10 px-5 pt-14 sm:px-8 lg:pl-16 lg:pt-[14vh]">
            <h1 className="rise text-[clamp(2.6rem,5.2vw,4.6rem)]" style={{ '--i': 1, fontFamily: 'var(--font-display)', fontWeight: 500, lineHeight: 1.06, letterSpacing: '-0.03em' } as CSSProperties}>
              Automations<br />you can<br />watch run.
            </h1>
            <p className="rise mt-5 max-w-sm text-[15px] leading-relaxed text-mute" style={{ '--i': 3 } as CSSProperties}>
              Draw a few steps, point a webhook or a schedule at them, and read what every step sent and what came back.
            </p>
            <div className="rise mt-8 flex items-center gap-3.5" style={{ '--i': 4 } as CSSProperties}>
              <Link to={signedIn ? '/workflows' : '/login?mode=register'} className="btn btn-primary btn-lg !rounded-full" data-testid="cta">
                {signedIn ? 'Open your workflows' : 'Start building'} <ArrowRight size={16} weight="bold" className="nudge" />
              </Link>
              <a href="#how" aria-label="See how it works" className="grid size-11 place-items-center rounded-full border border-white/25 bg-white/10 backdrop-blur transition hover:scale-110 active:scale-95">
                <Play size={14} weight="fill" />
              </a>
            </div>
          </div>

          <a href="https://github.com/amitkhairwal/Relay" aria-label="Relay on GitHub" className="absolute bottom-8 left-5 z-10 hidden size-9 lg:grid place-items-center rounded-full border border-white/20 text-soft transition hover:text-ink lg:left-16">
            <GithubLogo size={16} weight="fill" />
          </a>
        </section>

        <div className="border-y border-white/[0.07] bg-white/[0.015] py-4" aria-hidden="true">
          <div className="overflow-hidden">
            <div className="marquee">
              {[...MARQUEE, ...MARQUEE].map((m, i) => (
                <span key={i} className="mono flex items-center whitespace-nowrap text-xs uppercase tracking-[0.16em] text-mute">
                  {m}<span className="mx-6 text-[var(--accent)]">/</span>
                </span>
              ))}
            </div>
          </div>
        </div>

        <section id="features" className="mx-auto max-w-7xl scroll-mt-20 px-5 py-28 sm:px-8">
          <Reveal>
            <p className="mono text-xs uppercase tracking-[0.16em] text-mute">What is under it</p>
            <h2 className="display mt-4 max-w-3xl text-balance text-4xl sm:text-6xl">Built so a crash is <span className="serif-i text-[1.1em]">boring.</span></h2>
          </Reveal>
          <div className="mt-14 grid gap-4 lg:grid-cols-6">
            {FEATURES.map((f, i) => (
              <Reveal key={f.title} delay={(i % 3) * 110} className={f.span}>
                <article className="glass spot h-full p-5 sm:p-6" onPointerMove={spotlight.onPointerMove}>
                  {f.viz}
                  <h3 className="mt-6 text-xl font-semibold tracking-tight">{f.title}</h3>
                  <p className="mt-2 max-w-md text-[0.92rem] leading-relaxed text-mute">{f.body}</p>
                </article>
              </Reveal>
            ))}
            <Reveal className="lg:col-span-6">
              <article className="glass spot grid items-center gap-8 p-5 sm:p-6 lg:grid-cols-[1fr_1.2fr]" onPointerMove={spotlight.onPointerMove}>
                <div className="lg:pl-4">
                  <h3 className="text-xl font-semibold tracking-tight">Open a run and watch it</h3>
                  <p className="mt-2 max-w-md text-[0.92rem] leading-relaxed text-mute">Every step lights up as it happens, with the request it sent and the answer it got back. A failed step stays open with its error. A skipped branch is drawn dashed.</p>
                </div>
                <RunViz />
              </article>
            </Reveal>
          </div>
        </section>

        <section id="how" className="mx-auto max-w-7xl scroll-mt-20 px-5 pb-28 sm:px-8">
          <Reveal>
            <p className="mono text-xs uppercase tracking-[0.16em] text-mute">How it works</p>
            <h2 className="display mt-4 text-balance text-4xl sm:text-6xl">Three steps, <span className="serif-i text-[1.1em]">no glue code.</span></h2>
          </Reveal>
          <ol ref={stepsRef} className="relative mt-16 grid gap-10 md:grid-cols-3 md:gap-8">
            <div className="pointer-events-none absolute left-11 right-0 top-[22px] hidden origin-left border-t border-dashed border-[var(--accent)]/45 transition-transform duration-[1400ms] ease-out md:block" style={{ transform: stepsSeen ? 'scaleX(1)' : 'scaleX(0)' }} aria-hidden="true" />
            {STEPS.map(([n, t, b, code], i) => (
              <li key={n} className="relative">
                <Reveal delay={i * 160}>
                  <span className="relative z-10 grid size-11 place-items-center rounded-full border border-[var(--accent)]/50 bg-[var(--color-bone)] font-mono text-sm text-[var(--accent)]">{n}</span>
                  <h3 className="display mt-6 text-3xl">{t}</h3>
                  <p className="mt-3 max-w-xs text-[0.95rem] leading-relaxed text-mute">{b}</p>
                  <code className="mt-5 block w-fit rounded-lg border border-white/[0.08] bg-black/30 px-3 py-2 font-mono text-xs text-soft">{code}</code>
                </Reveal>
              </li>
            ))}
          </ol>
        </section>

        <section className="relative overflow-hidden border-t border-white/[0.07]">
          <div className="dots-bg pointer-events-none absolute inset-0 opacity-70 [mask-image:radial-gradient(60%_80%_at_20%_50%,black,transparent)]" />
          <div className="relative mx-auto flex max-w-7xl flex-col items-start justify-between gap-10 px-5 py-28 sm:px-8 lg:flex-row lg:items-end">
            <Reveal>
              <h2 className="display text-5xl sm:text-7xl"><span className="block">Draw one. Break it.</span><span className="serif-i block text-[1.1em]">Watch it recover.</span></h2>
            </Reveal>
            <Reveal delay={150}>
              <Link to={signedIn ? '/workflows' : '/login?mode=register'} className="btn btn-primary btn-lg whitespace-nowrap">{signedIn ? 'Open app' : 'Create an account'} <ArrowRight size={16} weight="bold" className="nudge" /></Link>
            </Reveal>
          </div>
        </section>
      </main>

      <footer className="border-t border-white/[0.07]">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-5 py-8 sm:px-8">
          <Logo />
          <p className="mono text-xs text-mute">React, TypeScript, Express, PostgreSQL</p>
        </div>
      </footer>
    </div>
  )
}
