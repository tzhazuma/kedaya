import { describe, expect, it } from 'vitest'
import type { WildlifeSighting } from '@kedaya/contracts/wildlife'
import { groupSightings } from './wildlife'
describe('偶遇标记聚合', () => {
  it('邻近的独立偶遇保留各自身份，远处记录单独显示', () => {
    const records = [
      { id: 'first', latitude: 31.17730, longitude: 121.59410, animalId: 'same-cat' },
      { id: 'second', latitude: 31.17731, longitude: 121.59411, animalId: 'same-cat' },
      { id: 'third', latitude: 31.18100, longitude: 121.59900, animalId: 'same-cat' },
    ] as WildlifeSighting[]
    const result = groupSightings(records)
    expect(result).toHaveLength(2)
    expect(result[0]?.map(r => r.id)).toEqual(['first', 'second'])
    expect(result[1]?.map(r => r.id)).toEqual(['third'])
    expect(records).toHaveLength(3)
  })
})
