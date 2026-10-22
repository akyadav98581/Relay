import { createClient } from 'redis'

// Idle workers sleep until enqueue() pings them. With REDIS_URL the ping goes through
// pub/sub so other instances hear it too. Without it only this process does.

const CHANNEL = 'relay:jobs'
const COMMIT_GRACE_MS = 20 // let the inserting transaction commit

const sleepers = new Set<() => void>()
const connect = (url: string) => createClient({ url }).on('error', (err: Error) => console.error('redis:', err.message))
let pub: ReturnType<typeof connect> | undefined
let sub: ReturnType<typeof connect> | undefined

export function wakeAll() {
  for (const wake of [...sleepers]) wake()
}

const wakeSoon = () => void setTimeout(wakeAll, COMMIT_GRACE_MS).unref()

export async function startWake(url: string) {
  // a subscribed connection can't publish, so use two
  const [p, s] = [connect(url), connect(url)]
  await Promise.all([p.connect(), s.connect()])
  await s.subscribe(CHANNEL, wakeSoon)
  pub = p
  sub = s
}

export async function stopWake() {
  await Promise.all([pub?.quit(), sub?.quit()].map((p) => p?.catch(() => {})))
  pub = sub = undefined
}

// Redis down: wake our own workers, the rest catch up on their next poll.
export function notifyJobs() {
  if (pub?.isReady) pub.publish(CHANNEL, '1').catch(wakeSoon)
  else wakeSoon()
}

// Resolves on a ping or after ms.
export function sleepUntilWoken(ms: number) {
  return new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer)
      sleepers.delete(done)
      resolve()
    }
    const timer = setTimeout(done, ms)
    sleepers.add(done)
  })
}
