import type { WildlifeSighting } from '@kedaya/contracts/wildlife'
export type MapBounds = { south: number; north: number; west: number; east: number }
export function groupSightings(items: WildlifeSighting[]) {
  const groups = new Map<string, WildlifeSighting[]>()
  for (const item of items) {
    const key = `${Math.round(item.latitude * 3000)},${Math.round(item.longitude * 3000)}`
    const group = groups.get(key) ?? []; group.push(item); groups.set(key, group)
  }
  return [...groups.values()]
}
export function requestId() { return `wildlife-${Date.now()}-${Math.random().toString(36).slice(2, 12)}` }
export function observedTime(value: string) { return new Date(value).toLocaleString('zh-CN') }
