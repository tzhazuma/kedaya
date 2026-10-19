import { MODULES } from '@kedaya/contracts'
import { describe, expect, it } from 'vitest'

import {
  DEFAULT_HOME_ENTRY_IDS,
  HOME_ENTRIES,
  HOME_SECTIONS,
  LOCKED_HOME_ENTRY_IDS,
  MAX_HOME_ENTRY_IDS,
  addableHomeEntryIds,
  homeEntryById,
  isHomeEntryId,
  isLockedHomeEntry,
  normalizeHomeEntryIds,
  searchHomeEntryIds,
} from '../homeEntries'

/**
 * 入口目录的三个「静默出错」方向都要在这里拦住：
 *   1. 契约新增模块但没登记入口 → 新模块在首页/服务大厅凭空消失；
 *   2. 入口登记了但没进任何分组 → 服务大厅里看不到它；
 *   3. 分组里写了不存在的入口 id → 页面上出现一个点不动的空格子。
 */
describe('首页入口目录', () => {
  it('目录与契约双向一致：入口覆盖的模块恰好是契约模块，且不重复', () => {
    const contractIds = MODULES.map((module) => module.id).sort()
    const covered = HOME_ENTRIES.flatMap((entry) => [...entry.moduleIds]).sort()

    expect(covered).toEqual(contractIds)
    expect(new Set(covered).size).toBe(covered.length)
  })

  it('每个入口恰好属于一个分组，且分组里引用的入口都存在', () => {
    const grouped = HOME_SECTIONS.flatMap((section) => [...section.entryIds])

    expect(new Set(grouped).size).toBe(grouped.length)
    expect([...grouped].sort()).toEqual(HOME_ENTRIES.map((entry) => entry.id).sort())
    for (const id of grouped) expect(isHomeEntryId(id), `分组引用了不存在的入口 ${id}`).toBe(true)
  })

  it('聚合入口把被聚合的模块从目录里摘掉，避免两个格子进同一个页面', () => {
    const cou = homeEntryById('cou')

    expect(cou?.moduleIds).toEqual(['groupbuy', 'buddy'])
    expect(homeEntryById('groupbuy')).toBeUndefined()
    expect(homeEntryById('buddy')).toBeUndefined()
  })

  it('DDL 聚合有首页入口：在默认宫格里，也在服务大厅分组里', () => {
    // 新增契约模块时最容易漏掉的两处：默认首页（看不见）与分组（服务大厅里看不见）。
    expect(homeEntryById('deadlines')?.label).toBe('DDL 聚合')
    expect(DEFAULT_HOME_ENTRY_IDS).toContain('deadlines')
    const grouped = HOME_SECTIONS.flatMap((section) => [...section.entryIds])
    expect(grouped).toContain('deadlines')
  })

  it('默认值合法：都在目录里、不超过上限、含全部固定入口', () => {
    for (const id of DEFAULT_HOME_ENTRY_IDS) expect(isHomeEntryId(id)).toBe(true)
    expect(DEFAULT_HOME_ENTRY_IDS.length).toBeLessThanOrEqual(MAX_HOME_ENTRY_IDS)
    for (const id of LOCKED_HOME_ENTRY_IDS) expect(DEFAULT_HOME_ENTRY_IDS).toContain(id)
  })

  it('默认值本身是规范形式（否则一进首页顺序就会"自己变一次"）', () => {
    expect(normalizeHomeEntryIds(DEFAULT_HOME_ENTRY_IDS)).toEqual(DEFAULT_HOME_ENTRY_IDS)
  })

  it('凑凑与心理支持是固定入口（一级入口与安全出口都不能被自定义藏掉）', () => {
    expect(LOCKED_HOME_ENTRY_IDS).toEqual(['cou', 'wellbeing'])
    expect(isLockedHomeEntry('cou')).toBe(true)
    expect(isLockedHomeEntry('wellbeing')).toBe(true)
    expect(isLockedHomeEntry('flea-market')).toBe(false)
  })
})

describe('normalizeHomeEntryIds', () => {
  it('缓存不是数组时回落到默认值（读缓存失败不该把首页清空）', () => {
    expect(normalizeHomeEntryIds(null)).toEqual(DEFAULT_HOME_ENTRY_IDS)
    expect(normalizeHomeEntryIds('cou')).toEqual(DEFAULT_HOME_ENTRY_IDS)
    expect(normalizeHomeEntryIds({ ids: ['cou'] })).toEqual(DEFAULT_HOME_ENTRY_IDS)
  })

  it('丢掉不认识的 id 与非字符串项（旧缓存 / 手工改坏）', () => {
    expect(normalizeHomeEntryIds(['cou', 'groupbuy', 42, null, 'flea-market'])).toEqual([
      'cou',
      'wellbeing',
      'flea-market',
    ])
  })

  it('去重，且固定入口始终排在前面', () => {
    expect(normalizeHomeEntryIds(['cou', 'cou', 'wildlife'])).toEqual([
      'cou',
      'wellbeing',
      'wildlife',
    ])
  })

  it('用户把固定入口删掉也不会真的消失', () => {
    const result = normalizeHomeEntryIds(['flea-market'])

    expect(result).toContain('cou')
    expect(result).toContain('wellbeing')
  })

  it('超过上限时截断，但固定入口一定保住', () => {
    const all = HOME_ENTRIES.map((entry) => entry.id)
    const result = normalizeHomeEntryIds(all)

    expect(result.length).toBe(MAX_HOME_ENTRY_IDS)
    for (const id of LOCKED_HOME_ENTRY_IDS) expect(result).toContain(id)
  })

  it('允许只留固定入口（用户明确清空自己的选择）', () => {
    expect(normalizeHomeEntryIds([])).toEqual(['cou', 'wellbeing'])
  })
})

describe('addableHomeEntryIds', () => {
  it('只返回还没被选中的入口，顺序跟随目录', () => {
    const addable = addableHomeEntryIds(['wellbeing', 'cou'])

    expect(addable).not.toContain('cou')
    expect(addable).not.toContain('wellbeing')
    expect(addable).toEqual(
      HOME_ENTRIES.filter((entry) => entry.id !== 'cou' && entry.id !== 'wellbeing').map(
        (entry) => entry.id,
      ),
    )
  })
})

describe('searchHomeEntryIds', () => {
  it('空关键词返回全部入口', () => {
    expect(searchHomeEntryIds('   ')).toEqual(HOME_ENTRIES.map((entry) => entry.id))
  })

  it('按标签、说明与副标题匹配，且大小写不敏感', () => {
    expect(searchHomeEntryIds('凑凑')).toEqual(['cou'])
    expect(searchHomeEntryIds('techpie')).toEqual(['techpie'])
    expect(searchHomeEntryIds('TechPie')).toEqual(['techpie'])
    expect(searchHomeEntryIds('拼单')).toEqual(['cou'])
  })

  it('匹配不到时返回空数组（页面上给空态，而不是硬塞推荐）', () => {
    expect(searchHomeEntryIds('不存在的服务')).toEqual([])
  })
})
