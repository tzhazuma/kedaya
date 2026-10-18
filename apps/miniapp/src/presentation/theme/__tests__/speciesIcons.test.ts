import { describe, expect, it } from 'vitest'

import { MOCK_WILDLIFE_SPECIES } from '../../../data/mock/wildlifeFixtures'
import { speciesIconPath } from '../speciesIcons'

/**
 * 这张表最容易出的错是「服务端加了物种、端上忘了配图」——
 * 那不会报错，只会让档案页某一行悄悄退化成首字占位。这里守住内置物种。
 */
describe('speciesIconPath', () => {
  it('内置物种都有头像', () => {
    for (const species of MOCK_WILDLIFE_SPECIES) {
      expect(speciesIconPath(species.id), `${species.id} 没有配头像`).not.toBeNull()
    }
  })

  it('未知物种返回 null（页面用首字占位，而不是硬塞一张错图）', () => {
    expect(speciesIconPath('sp-unknown')).toBeNull()
    expect(speciesIconPath('')).toBeNull()
  })

  it('头像路径指向随包发布的资源（`config/index.ts` 的 copy 规则）', () => {
    for (const species of MOCK_WILDLIFE_SPECIES) {
      expect(speciesIconPath(species.id)).toMatch(/^\/assets\/wildlife\/species-[a-z]+\.png$/)
    }
  })
})
