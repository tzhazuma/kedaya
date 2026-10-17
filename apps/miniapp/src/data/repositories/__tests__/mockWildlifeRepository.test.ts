import { describe, expect, it } from 'vitest'

import { validateDraft } from '../../../application/wildlife/wildlifeUseCases'
import {
  WILDLIFE_CAMPUS_CENTER,
  WILDLIFE_SPECIES_OPTION_LIMIT,
  WILDLIFE_SPECIES_SUGGESTIONS,
  coordinateProblem,
  formatCoordinate,
  isConfirmed,
  mergeSpeciesOptions,
  noteProblem,
  parseCoordinate,
  placeProblem,
  resolveCoordinate,
  speciesProblem,
  statusLabel,
  summarize,
} from '../../../domain/models/wildlife'
import type { WildlifeSpot } from '../../../domain/models/wildlife'
import { createMemoryStorage } from '../../storage/memoryStorage'
import { STORAGE_PREFIX } from '../../storage/keys'
import { createMockWildlifeRepository } from '../mockWildlifeRepository'

/**
 * 观察点「领域规则 + Mock 仓储」的可执行规格。
 *
 * Mock 仓储的价值在于**规则一致** —— 排序键、筛选语义、游标分页、
 * confirm 的幂等性都必须和后端一样，否则"离线能跑通"只是巧合。
 * 所以这里既测纯函数，也测 mock 真的执行了同样的规则。
 */

const NOW = new Date('2026-10-01T08:00:00.000Z')

/**
 * 列表缓存的 key。
 *
 * 装配层会往 `StorageKeys` 里加同名的 `wildlifeListCache`；
 * 这里按同一个字面量构造，用来验证"数据集"与"列表缓存"确实落在不同的 key 上。
 */
const LIST_CACHE_KEY = `${STORAGE_PREFIX}cache:wildlife:list`

function spot(overrides: Partial<WildlifeSpot> = {}): WildlifeSpot {
  return {
    id: 'ws-1',
    species: '黑天鹅',
    place: '湖畔东侧',
    lat: 31.180_215,
    lng: 121.593_118,
    note: '一对，常在上午出现。',
    reportedBy: null,
    status: 'active',
    createdAt: '2026-10-01T07:00:00.000Z',
    updatedAt: '2026-10-01T07:00:00.000Z',
    ...overrides,
  }
}

function repo(spots: WildlifeSpot[] = [spot()]) {
  const repository = createMockWildlifeRepository({
    cache: createMemoryStorage(),
    latencyMs: 0,
    now: () => NOW,
  })
  repository.seed(spots)
  return repository
}

describe('状态与派生视图', () => {
  it('只把 confirmed 认成已确认，其它值一律按待确认展示（不编造后端状态表）', () => {
    expect(isConfirmed('confirmed')).toBe(true)
    expect(statusLabel('confirmed')).toBe('已确认')
    expect(isConfirmed('active')).toBe(false)
    expect(statusLabel('active')).toBe('待确认')
    // 后端将来加了别的新状态，客户端不认识时应该"降级为待确认"而不是崩 / 显示空白
    expect(statusLabel('verified-by-teacher')).toBe('待确认')
  })

  it('坐标格式化成可读文本；非法坐标降级为占位而不是让整页崩掉', () => {
    expect(formatCoordinate(31.180_215, 121.593_118)).toBe('31.18022, 121.59312')
    expect(formatCoordinate(Number.NaN, 121.5)).toBe('—')
  })

  it('summarize 给出卡片直接可用的字段', () => {
    const summary = summarize(spot({ status: 'confirmed' }), NOW)

    expect(summary.species).toBe('黑天鹅')
    expect(summary.place).toBe('湖畔东侧')
    expect(summary.confirmed).toBe(true)
    expect(summary.statusLabel).toBe('已确认')
    expect(summary.coordinateLabel).toBe('31.18022, 121.59312')
    expect(summary.latitude).toBe(31.180_215)
    expect(summary.createdLabel).toBe('1 小时前')
  })

  it('summarize 对空备注给出空预览（不会渲染出 "null"）', () => {
    expect(summarize(spot({ note: null }), NOW).notePreview).toBe('')
  })
})

describe('物种筛选候选（已加载数据去重 + 建议选项）', () => {
  it('当前选中的值排在最前：否则用户选中它就再也点不回去', () => {
    const options = mergeSpeciesOptions(['橘猫', '白鹭'], '黑天鹅')
    expect(options[0]).toBe('黑天鹅')
  })

  it('已加载数据里出现过的物种优先于通用建议，并按 trim 去重', () => {
    const options = mergeSpeciesOptions([' 橘猫 ', '白鹭', '橘猫'])
    expect(options.slice(0, 2)).toEqual(['橘猫', '白鹭'])
    // 建议里已有的不再重复出现
    expect(options.filter((item) => item === '橘猫')).toHaveLength(1)
  })

  it('列表为空时也有兜底候选（建议选项）', () => {
    const options = mergeSpeciesOptions([])
    expect(options).toEqual([...WILDLIFE_SPECIES_SUGGESTIONS].slice(0, WILDLIFE_SPECIES_OPTION_LIMIT))
  })

  it('候选数量有上限，不会把筛选区撑成一堵墙', () => {
    const loaded = Array.from({ length: 40 }, (_, index) => `物种-${String(index)}`)
    expect(mergeSpeciesOptions(loaded)).toHaveLength(WILDLIFE_SPECIES_OPTION_LIMIT)
  })
})

describe('草稿校验与坐标兜底', () => {
  it('parseCoordinate：空串是"没填"，不是 0', () => {
    expect(parseCoordinate('')).toBeNull()
    expect(parseCoordinate('   ')).toBeNull()
    expect(parseCoordinate('31.17943')).toBe(31.179_43)
    expect(parseCoordinate('-0.5')).toBe(-0.5)
    expect(parseCoordinate('东经一百度')).toBeNull()
  })

  it('坐标要么都填、要么都留空；只填一个是无效的', () => {
    expect(coordinateProblem('', '')).toBeNull()
    expect(coordinateProblem('31.18', '')).toContain('要么都填')
    expect(coordinateProblem('', '121.59')).toContain('要么都填')
  })

  it('坐标范围与格式都会被拦下', () => {
    expect(coordinateProblem('31.18', '121.59')).toBeNull()
    expect(coordinateProblem('91', '121.59')).toContain('纬度')
    expect(coordinateProblem('31.18', '181')).toContain('经度')
    expect(coordinateProblem('lat', '121.59')).toContain('数字')
  })

  it('留空 → 兜底校园中心；填了 → 用填的值，绝不写 NaN', () => {
    expect(resolveCoordinate('', '')).toEqual({
      latitude: WILDLIFE_CAMPUS_CENTER.latitude,
      longitude: WILDLIFE_CAMPUS_CENTER.longitude,
    })
    expect(resolveCoordinate('31.1', '121.2')).toEqual({ latitude: 31.1, longitude: 121.2 })
    // 即使调用方漏了校验，也不会把 NaN 落库
    expect(resolveCoordinate('乱填', '121.2').latitude).toBe(WILDLIFE_CAMPUS_CENTER.latitude)
  })

  it('文本长度规则与后端 createSchema 一致（500）', () => {
    expect(speciesProblem('   ')).toBe('请填写动物种类')
    expect(speciesProblem('x'.repeat(501))).toContain('最多 500')
    expect(placeProblem('')).toBe('请填写观察地点')
    expect(noteProblem('x'.repeat(501))).toContain('最多 500')
    expect(noteProblem('')).toBeNull()
  })

  it('validateDraft 逐项提示，合法草稿没有问题', () => {
    const empty = validateDraft({
      species: '',
      place: '',
      note: '',
      latitudeText: '',
      longitudeText: '',
    })
    expect(empty).toContain('请填写动物种类')
    expect(empty).toContain('请填写观察地点')

    expect(
      validateDraft({
        species: '橘猫',
        place: '生活区 5 号楼门口',
        note: '左耳有缺口',
        latitudeText: '31.178902',
        longitudeText: '121.591764',
      }),
    ).toEqual([])
  })
})

describe('Mock 仓储 · 上报', () => {
  it('匿名也能上报：默认 status 为 active，reportedBy 保持为空', async () => {
    const r = repo([])
    const created = await r.create({
      species: '  橘猫  ',
      place: '  生活区 5 号楼门口  ',
      lat: 31.178_902,
      lng: 121.591_764,
      note: '   ',
    })

    expect(created.ok).toBe(true)
    if (!created.ok) return
    expect(created.value.species).toBe('橘猫')
    expect(created.value.place).toBe('生活区 5 号楼门口')
    // 与后端 normalizeText 一致：空串归一成 null
    expect(created.value.note).toBeNull()
    expect(created.value.status).toBe('active')
    expect(created.value.reportedBy).toBeNull()
  })

  it('新上报的观察点排在列表最前面（最新在前）', async () => {
    const r = repo([spot({ id: 'ws-old', createdAt: '2026-09-01T00:00:00.000Z' })])
    const created = await r.create({
      species: '喜鹊',
      place: '第一食堂后侧',
      lat: 31.178_566,
      lng: 121.592_233,
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return

    const listed = await r.list({ cursor: null, filters: {} })
    expect(listed.ok).toBe(true)
    if (listed.ok) expect(listed.value.items[0]?.id).toBe(created.value.id)
  })

  it('空物种 / 空地点 / 超长备注 / 非数字坐标统一 VALIDATION_FAILED', async () => {
    const r = repo([])
    const base = { species: '橘猫', place: '图书馆后门', lat: 31.179_64, lng: 121.592_41 }

    const cases = [
      { ...base, species: '   ' },
      { ...base, species: 'x'.repeat(501) },
      { ...base, place: '' },
      { ...base, note: 'x'.repeat(501) },
      { ...base, lat: Number.NaN },
      { ...base, lng: Number.POSITIVE_INFINITY },
    ]

    for (const input of cases) {
      const result = await r.create(input)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.code).toBe('VALIDATION_FAILED')
    }
  })
})

describe('Mock 仓储 · confirm（改共享状态，不是个人计数）', () => {
  it('把状态改成 confirmed，并推进 updatedAt', async () => {
    const r = repo([spot({ status: 'active' })])
    const confirmed = await r.confirm('ws-1')

    expect(confirmed.ok).toBe(true)
    if (!confirmed.ok) return
    expect(confirmed.value.status).toBe('confirmed')
    expect(confirmed.value.updatedAt).toBe(NOW.toISOString())
  })

  it('幂等：重复确认仍然成功（后端只是一次 update，没有"重复确认"的冲突）', async () => {
    const r = repo([spot({ status: 'confirmed' })])
    const again = await r.confirm('ws-1')

    expect(again.ok).toBe(true)
    if (again.ok) expect(again.value.status).toBe('confirmed')
  })

  it('不存在统一 NOT_FOUND', async () => {
    const r = repo([])
    const result = await r.confirm('ghost')

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('NOT_FOUND')
  })

  it('详情页据此进入已确认态（confirm 之后 detail 读到的就是 confirmed）', async () => {
    const r = repo([spot()])
    await r.confirm('ws-1')

    const detail = await r.detail('ws-1')
    expect(detail.ok).toBe(true)
    if (detail.ok) expect(isConfirmed(detail.value.status)).toBe(true)
  })
})

describe('Mock 仓储 · 筛选、排序与分页', () => {
  const seed: WildlifeSpot[] = [
    spot({
      id: 'a',
      species: '橘猫',
      place: '生活区 5 号楼门口',
      createdAt: '2026-10-01T07:00:00.000Z',
    }),
    spot({
      id: 'b',
      species: 'Little Egret',
      place: '人工湿地',
      createdAt: '2026-10-01T09:00:00.000Z',
    }),
    spot({
      id: 'c',
      species: '黑天鹅',
      place: '湖畔东侧',
      status: 'confirmed',
      createdAt: '2026-10-01T05:00:00.000Z',
    }),
  ]

  it('物种是包含匹配且忽略大小写（与后端 contains + insensitive 一致）', async () => {
    const r = repo(seed)

    const fuzzy = await r.list({ cursor: null, filters: { species: '猫' } })
    if (fuzzy.ok) expect(fuzzy.value.items.map((item) => item.id)).toEqual(['a'])

    const lower = await r.list({ cursor: null, filters: { species: 'little egret' } })
    if (lower.ok) expect(lower.value.items.map((item) => item.id)).toEqual(['b'])

    const blank = await r.list({ cursor: null, filters: { species: '   ' } })
    if (blank.ok) expect(blank.value.items).toHaveLength(3)
  })

  it('最新在前（createdAt desc，id desc 兜底）', async () => {
    const r = repo(seed)
    const listed = await r.list({ cursor: null, filters: {} })

    expect(listed.ok).toBe(true)
    if (listed.ok) expect(listed.value.items.map((item) => item.id)).toEqual(['b', 'a', 'c'])
  })

  it('createdAt 相同也用 id 兜底，保证翻页不漏读', async () => {
    const same = '2026-10-01T07:00:00.000Z'
    const r = repo([
      spot({ id: 'ws-1', createdAt: same }),
      spot({ id: 'ws-3', createdAt: same }),
      spot({ id: 'ws-2', createdAt: same }),
    ])

    const listed = await r.list({ cursor: null, filters: {} })
    expect(listed.ok).toBe(true)
    if (listed.ok) expect(listed.value.items.map((item) => item.id)).toEqual(['ws-3', 'ws-2', 'ws-1'])
  })

  it('游标分页只返回下一页，并给出正确的 nextCursor', async () => {
    const r = repo(seed)

    const first = await r.list({ cursor: null, limit: 2, filters: {} })
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(first.value.items.map((item) => item.id)).toEqual(['b', 'a'])
    expect(first.value.nextCursor).toBe('a')
    // 后端不返回 total（Page.total 是可选字段）
    expect(first.value.total).toBeUndefined()

    const second = await r.list({ cursor: 'a', limit: 2, filters: {} })
    if (second.ok) {
      expect(second.value.items.map((item) => item.id)).toEqual(['c'])
      expect(second.value.nextCursor).toBeNull()
    }
  })

  it('筛选会跨页保持（第二页仍然是筛选后的结果）', async () => {
    const r = repo([
      spot({ id: 'x1', species: '橘猫', createdAt: '2026-10-01T07:00:00.000Z' }),
      spot({ id: 'x2', species: '喜鹊', createdAt: '2026-10-01T06:00:00.000Z' }),
      spot({ id: 'x3', species: '橘猫', createdAt: '2026-10-01T05:00:00.000Z' }),
    ])

    const first = await r.list({ cursor: null, limit: 1, filters: { species: '橘猫' } })
    if (first.ok) {
      expect(first.value.items.map((item) => item.id)).toEqual(['x1'])
      expect(first.value.nextCursor).toBe('x1')
    }

    const second = await r.list({ cursor: 'x1', limit: 1, filters: { species: '橘猫' } })
    if (second.ok) expect(second.value.items.map((item) => item.id)).toEqual(['x3'])
  })
})

describe('Mock 仓储 · 持久化与演示控制', () => {
  it('数据落在 CachePort：新实例读到同一份数据（刷新页面不丢自己上报的观察点）', async () => {
    const cache = createMemoryStorage()
    const options = { cache, latencyMs: 0, now: () => NOW }

    const first = createMockWildlifeRepository(options)
    const created = await first.create({
      species: '松鼠',
      place: '教学楼 A 座后草坪',
      lat: 31.179_188,
      lng: 121.593_502,
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return

    const second = createMockWildlifeRepository(options)
    const listed = await second.list({ cursor: null, filters: {} })
    expect(listed.ok).toBe(true)
    if (listed.ok) expect(listed.value.items.map((item) => item.id)).toContain(created.value.id)
  })

  it('数据集与列表缓存使用不同的 key：写列表缓存不会覆盖数据集', async () => {
    const cache = createMemoryStorage()
    const r = createMockWildlifeRepository({ cache, latencyMs: 0, now: () => NOW })
    r.seed([spot()])

    // 模拟 listUseCase.writeCache 往列表缓存 key 写一页载荷
    cache.write(LIST_CACHE_KEY, { items: [], nextCursor: null, updatedAt: NOW.toISOString() })

    const listed = await r.list({ cursor: null, filters: {} })
    expect(listed.ok).toBe(true)
    if (listed.ok) expect(listed.value.items.map((item) => item.id)).toEqual(['ws-1'])
  })

  it('首次读取会铺种子数据（≥6 条真实感的观察点）', async () => {
    const r = createMockWildlifeRepository({ cache: createMemoryStorage(), latencyMs: 0, now: () => NOW })
    const listed = await r.list({ cursor: null, limit: 20, filters: {} })

    expect(listed.ok).toBe(true)
    if (!listed.ok) return
    expect(listed.value.items.length).toBeGreaterThanOrEqual(6)
    // 种子里的坐标必须落在校园一带，否则"在地图上查看"会把人指到别的城市
    for (const item of listed.value.items) {
      expect(item.lat).toBeGreaterThan(31)
      expect(item.lat).toBeLessThan(32)
      expect(item.lng).toBeGreaterThan(121)
      expect(item.lng).toBeLessThan(122)
    }
    expect(listed.value.items.some((item) => isConfirmed(item.status))).toBe(true)
  })

  it('failNextRequests 只影响接下来 N 次请求', async () => {
    const r = repo([spot()])
    r.failNextRequests(1)

    const failed = await r.list({ cursor: null, filters: {} })
    expect(failed.ok).toBe(false)
    if (!failed.ok) expect(failed.error.code).toBe('UPSTREAM_UNAVAILABLE')

    const okAgain = await r.list({ cursor: null, filters: {} })
    expect(okAgain.ok).toBe(true)
  })

  it('clearAll 之后是真的空列表；reset 之后种子回来', async () => {
    const r = repo([spot()])
    r.clearAll()
    const empty = await r.list({ cursor: null, filters: {} })
    expect(empty.ok).toBe(true)
    if (empty.ok) expect(empty.value.items).toHaveLength(0)

    r.reset()
    const seeded = await r.list({ cursor: null, filters: {} })
    if (seeded.ok) expect(seeded.value.items.length).toBeGreaterThan(0)
  })

  it('不存在的记录统一 NOT_FOUND', async () => {
    const r = repo([])
    const results = await Promise.all([r.detail('ghost'), r.confirm('ghost')])

    for (const result of results) {
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.code).toBe('NOT_FOUND')
    }
  })
})
