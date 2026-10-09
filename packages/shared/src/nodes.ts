import { z } from 'zod'
import { isValidCron } from './cron.js'

export const NODE_TYPES = ['webhook', 'schedule', 'http', 'filter', 'transform', 'delay'] as const
export type NodeType = (typeof NODE_TYPES)[number]

export const TRIGGER_TYPES: readonly NodeType[] = ['webhook', 'schedule']
export const isTrigger = (t: NodeType) => TRIGGER_TYPES.includes(t)

export const MAX_DELAY_SECONDS = 7 * 24 * 3600

export const configSchemas = {
  webhook: z.object({}),
  schedule: z.object({
    cron: z.string().min(1).refine(isValidCron, 'not a valid cron expression'),
  }),
  http: z.object({
    method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).default('GET'),
    url: z.string().min(1),
    headers: z.record(z.string(), z.string()).default({}),
    body: z.string().default(''),
    timeoutMs: z.number().int().min(100).max(30_000).default(10_000),
    retries: z.number().int().min(0).max(5).default(2),
  }),
  filter: z.object({ condition: z.string().min(1) }),
  transform: z.object({ expression: z.string().min(1) }),
  delay: z.object({ seconds: z.number().min(1).max(MAX_DELAY_SECONDS) }),
} satisfies Record<NodeType, z.ZodType>

export type NodeConfig<T extends NodeType> = z.infer<(typeof configSchemas)[T]>

export const NODE_INFO: Record<NodeType, { label: string; blurb: string }> = {
  webhook: { label: 'Webhook', blurb: 'Starts the workflow when a URL is called.' },
  schedule: { label: 'Schedule', blurb: 'Starts the workflow on a cron schedule (UTC).' },
  http: { label: 'HTTP request', blurb: 'Calls a URL and keeps the response.' },
  filter: { label: 'Filter', blurb: 'Lets the run continue only if a condition is true.' },
  transform: { label: 'Transform', blurb: 'Reshapes data with a JSONata expression.' },
  delay: { label: 'Delay', blurb: 'Waits before the next step.' },
}

export const defaultConfig = (t: NodeType): Record<string, unknown> => {
  switch (t) {
    case 'webhook': return {}
    case 'schedule': return { cron: '*/10 * * * *' }
    case 'http': return { method: 'GET', url: 'https://', headers: {}, body: '', timeoutMs: 10000, retries: 2 }
    case 'filter': return { condition: 'true' }
    case 'transform': return { expression: '{}' }
    case 'delay': return { seconds: 60 }
  }
}
