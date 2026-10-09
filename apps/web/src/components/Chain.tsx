import type { NodeType } from '@relay/shared'
import { ICONS } from '../lib/nodeMeta'

// A row of small coloured icons joined by lines: the shape of a workflow at a glance.
export default function Chain({ types }: { types: string[] }) {
  if (types.length === 0) return <span className="text-xs text-dim">empty</span>
  return (
    <div className="flex items-center" aria-label={types.join(', ')}>
      {types.map((t, i) => {
        const Icon = ICONS[t as NodeType]
        return (
          <div key={i} className="flex items-center">
            {i > 0 && <span className="h-px w-3.5 bg-white/15" />}
            <span className="step-icon" data-t={t} title={t} style={{ width: 24, height: 24, borderRadius: 7 }}>{Icon && <Icon size={13} weight="bold" />}</span>
          </div>
        )
      })}
    </div>
  )
}
