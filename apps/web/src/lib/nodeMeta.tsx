import { BracketsCurly, Clock, Funnel, Globe, HourglassMedium, WebhooksLogo } from '@phosphor-icons/react'
import type { Icon } from '@phosphor-icons/react'
import type { NodeType } from '@relay/shared'
import { humanSeconds } from './format'

export const ICONS: Record<NodeType, Icon> = {
  webhook: WebhooksLogo,
  schedule: Clock,
  http: Globe,
  filter: Funnel,
  transform: BracketsCurly,
  delay: HourglassMedium,
}

export const TYPE_COLOR: Record<NodeType, string> = {
  webhook: '#9d8cff',
  schedule: '#36d6e7',
  http: '#5aa2ff',
  filter: '#ffb74d',
  transform: '#ff7bc5',
  delay: '#8be37a',
}

// One line that says what a step is set to do, shown on the card.
export function summary(type: NodeType, config: Record<string, unknown>): string {
  switch (type) {
    case 'webhook': return 'When its URL is called'
    case 'schedule': return `cron ${config.cron ?? ''}`
    case 'http': return `${config.method ?? 'GET'} ${String(config.url ?? '').replace(/^https?:\/\//, '')}`
    case 'filter': return String(config.condition ?? '')
    case 'transform': return String(config.expression ?? '').replace(/\s+/g, ' ')
    case 'delay': return `wait ${humanSeconds(Number(config.seconds) || 0)}`
  }
}
