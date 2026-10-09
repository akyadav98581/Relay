import type { Graph } from '../src/index.js'
import { defaultConfig, type NodeType } from '../src/index.js'

let n = 0
export const node = (key: string, type: NodeType, config: Record<string, unknown> = {}) => ({
  id: `n_${key}`,
  key,
  type,
  position: { x: 0, y: n++ * 80 },
  config: { ...defaultConfig(type), ...config },
})

export const edge = (a: string, b: string) => ({ id: `e_${a}_${b}`, source: `n_${a}`, target: `n_${b}` })

export const graph = (nodes: ReturnType<typeof node>[], edges: [string, string][]): Graph => ({
  nodes,
  edges: edges.map(([a, b]) => edge(a, b)),
})
