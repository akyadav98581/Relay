import { Handle, Position, type NodeProps } from '@xyflow/react'
import { isTrigger, NODE_INFO } from '@relay/shared'
import { ICONS, TYPE_COLOR, summary } from '../lib/nodeMeta'
import type { FlowNode } from '../lib/editorStore'
import Pill from './Pill'

export default function StepNode({ data }: NodeProps<FlowNode>) {
  const Icon = ICONS[data.type]
  const status = (data as { status?: string }).status
  const bad = (data as { hasProblem?: boolean }).hasProblem
  const hc = { ['--hc' as string]: TYPE_COLOR[data.type] }
  return (
    <div className="step" data-t={data.type} data-bad={bad ? 'true' : undefined} data-status={status}>
      {!isTrigger(data.type) && <Handle type="target" position={Position.Left} style={hc} />}
      <div className="flex items-center gap-2.5">
        <span className="step-icon"><Icon size={15} weight="bold" /></span>
        <div className="min-w-0 flex-1">
          <div className="text-[10.5px] font-medium uppercase tracking-[0.1em] text-mute">{NODE_INFO[data.type].label}</div>
          <div className="truncate font-mono text-[13px] text-ink">{data.key}</div>
        </div>
        {bad && !status && <span className="size-2 rounded-full bg-[var(--s-failed)] shadow-[0_0_8px_var(--s-failed)]" title="This step has a problem" />}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <div className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-dim" title={summary(data.type, data.config)}>{summary(data.type, data.config)}</div>
        {status && <Pill status={status} />}
      </div>
      <Handle type="source" position={Position.Right} style={hc} />
    </div>
  )
}
