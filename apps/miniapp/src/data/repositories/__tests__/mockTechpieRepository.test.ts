import { describe, expect, it } from 'vitest'

import { createMockTechpieRepository } from '../mockTechpieRepository'
import { createMemoryStorage } from '../../storage/memoryStorage'
import { STORAGE_PREFIX } from '../../storage/keys'
import { validateDraft } from '../../../application/techpie/techpieUseCases'
import {
  TECHPIE_CATEGORIES,
  TECHPIE_NOTICE,
  categoryHint,
  categoryLabel,
  isHttpUrl,
  isTechpieCategory,
  isReviewed,
  nameProblem,
  statusLabel,
  statusTone,
  summarize,
  urlHost,
  urlProblem,
} from '../../../domain/models/techpie'
import type { TechpieLink } from '../../../domain/models/techpie'

/**
 * 服务目录「领域规则 + Mock 仓储」的可执行规格。
 *
 * Mock 仓储的价值在于**规则一致** —— 分类精确筛选、关键词命中名称与地址、
 * 最新在前（含 id 兜底）、sync 改状态且幂等、创建边界，都要和后端一样。
 * 所以这里既测纯函数，也测 mock 真的执行了同样的规则（而不是"看起来像"）。
 */

const NOW = new Date('2026-05-01T12:00:00.000Z')

function link(overrides: Partial<TechpieLink> = {}): TechpieLink {
  return {
    id: 'tp-1',
    key: 'techpie-jwc',
    name: '教务系统',
    category: 'academic',
    url: 'https://jwc.shanghaitech.edu.cn/',
    status: 'active',
    createdAt: '2026-05-01T10:00:00.000Z',
    updatedAt: '2026-05-01T10:00:00.000Z',
    ...overrides,
  }
}

function repo(links: TechpieLink[] = [link()]) {
  const repository = createMockTechpieRepository({
    cache: createMemoryStorage(),
    latencyMs: 0,
    now: () => NOW,
  })
  repository.seed(links)
  return repository
}

describe('分类白名单与展示标签', () => {
  it('白名单覆盖后端种子用到的四种分类，且只认登记过的值', () => {
    for (const value of ['portal', 'academic', 'community', 'service']) {
      expect(TECHPIE_CATEGORIES).toContain(value)
    }
    expect(isTechpieCategory('library')).toBe(true)
    expect(isTechpieCategory('not-a-category')).toBe(false)
    expect(isTechpieCategory(undefined)).toBe(false)
  })

  it('白名单外的分类降级显示为「其他」，说明不留空', () => {
    expect(categoryLabel('academic')).toBe('教务与选课')
    expect(categoryLabel('legacy-category')).toBe('其他')
    expect(categoryHint('legacy-category')).toBe(categoryHint('other'))
    expect(categoryHint('network').length).toBeGreaterThan(0)
  })

  it('固定说明就是「共建 + 人工核对、非官方」这一句', () => {
    expect(TECHPIE_NOTICE).toContain('共建')
    expect(TECHPIE_NOTICE).toContain('人工核对')
    expect(TECHPIE_NOTICE).toContain('不代表学校官方')
  })
})

describe('状态：只认服务端真实会写的值', () => {
  it('active → 可用、synced → 已核对、其余 → 待核对', () => {
    expect(statusLabel('active')).toBe('可用')
    expect(statusLabel('synced')).toBe('已核对')
    expect(statusLabel('pending')).toBe('待核对')
    expect(statusLabel('whatever')).toBe('待核对')
  })

  it('tone 与状态一一对应，且只有 synced 算「已核对」', () => {
    expect(statusTone('active')).toBe('success')
    expect(statusTone('synced')).toBe('info')
    expect(statusTone('whatever')).toBe('neutral')

    expect(isReviewed('synced')).toBe(true)
    expect(isReviewed('active')).toBe(false)
  })
})

describe('地址解析与校验', () => {
  it('urlHost 去掉协议与端口，取域名', () => {
    expect(urlHost('https://jwc.shanghaitech.edu.cn/portal/index')).toBe(
      'jwc.shanghaitech.edu.cn',
    )
    expect(urlHost('http://127.0.0.1:3000/x')).toBe('127.0.0.1')
    expect(urlHost('不是网址')).toBe('不是网址')
  })

  it('只放行 http(s) 且必须有域名，挡住 javascript: / data: 这类诱饵', () => {
    expect(isHttpUrl('https://vpn.shanghaitech.edu.cn/')).toBe(true)
    expect(isHttpUrl('http://localhost:4000')).toBe(true)
    expect(isHttpUrl('javascript:alert(1)')).toBe(false)
    expect(isHttpUrl('data:text/html,<h1>x</h1>')).toBe(false)
    expect(isHttpUrl('https://')).toBe(false)
    expect(isHttpUrl('https://has space.com')).toBe(false)
  })

  it('地址校验给出可读文案', () => {
    expect(urlProblem('https://library.shanghaitech.edu.cn/')).toBeNull()
    expect(urlProblem('   ')).toBe('请填写服务地址')
    expect(urlProblem('library.shanghaitech.edu.cn')).toBe(
      '请填写以 http:// 或 https:// 开头的完整网址',
    )
    expect(urlProblem(`https://x.com/${'a'.repeat(300)}`)).toContain('最多')
  })

  it('名称必填且有长度上限', () => {
    expect(nameProblem('教务系统')).toBeNull()
    expect(nameProblem('   ')).toBe('请填写服务名称')
    expect(nameProblem('x'.repeat(61))).not.toBeNull()
  })
})

describe('Mock 仓储 · 种子数据', () => {
  it('种子 ≥ 8 条，分类都在白名单内、地址是 https、状态覆盖「可用 / 待核对」之类', async () => {
    const r = createMockTechpieRepository({
      cache: createMemoryStorage(),
      latencyMs: 0,
      now: () => NOW,
    })

    const result = await r.list({ cursor: null, limit: 50, filters: {} })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value.items.length).toBeGreaterThanOrEqual(8)
    for (const item of result.value.items) {
      expect(isTechpieCategory(item.category)).toBe(true)
      expect(isHttpUrl(item.url)).toBe(true)
      expect(item.url.startsWith('https://')).toBe(true)
      expect(item.name.trim().length).toBeGreaterThan(0)
    }

    const labels = new Set(result.value.items.map((item) => statusLabel(item.status)))
    expect(labels.has('可用')).toBe(true)
    expect(labels.has('待核对')).toBe(true)
    // 至少有一条被点过「我核对过了」，好让详情页的已核对态在演示里可见
    expect(labels.has('已核对')).toBe(true)
  })
})

describe('Mock 仓储 · 列表筛选与排序', () => {
  const seed: TechpieLink[] = [
    link({ id: 'a', category: 'academic', name: '教务系统', createdAt: '2026-05-01T09:00:00.000Z' }),
    link({
      id: 'b',
      category: 'network',
      name: '校园 VPN',
      url: 'https://vpn.shanghaitech.edu.cn/',
      createdAt: '2026-05-01T11:00:00.000Z',
    }),
    link({
      id: 'c',
      category: 'network',
      name: '网络信息中心',
      url: 'https://it.shanghaitech.edu.cn/',
      createdAt: '2026-05-01T08:00:00.000Z',
    }),
    link({
      id: 'd',
      category: 'library',
      name: 'Library',
      url: 'https://library.shanghaitech.edu.cn/',
      createdAt: '2026-05-01T10:00:00.000Z',
    }),
  ]

  it('无筛选时按 createdAt 倒序（最新在前）', async () => {
    const r = repo(seed)
    const result = await r.list({ cursor: null, filters: {} })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.items.map((i) => i.id)).toEqual(['b', 'd', 'a', 'c'])
  })

  it('同一毫秒落库时用 id 倒序兜底（避免翻页跳项）', async () => {
    const r = repo([
      link({ id: 'x', createdAt: '2026-05-01T10:00:00.000Z' }),
      link({ id: 'y', createdAt: '2026-05-01T10:00:00.000Z' }),
    ])
    const result = await r.list({ cursor: null, filters: {} })
    if (result.ok) expect(result.value.items.map((i) => i.id)).toEqual(['y', 'x'])
  })

  it('分类精确筛选：只返回该分类，未知分类返回空', async () => {
    const r = repo(seed)
    const network = await r.list({ cursor: null, filters: { category: 'network' } })
    if (network.ok) expect(network.value.items.map((i) => i.id).sort()).toEqual(['b', 'c'])

    const unknown = await r.list({ cursor: null, filters: { category: 'no-such' } })
    if (unknown.ok) expect(unknown.value.items).toHaveLength(0)
  })

  it('关键词同时命中名称与地址，且不区分大小写', async () => {
    const r = repo(seed)
    // 命中名称「校园 VPN」与地址里的 vpn
    const vpn = await r.list({ cursor: null, filters: { q: 'VPN' } })
    if (vpn.ok) expect(vpn.value.items.map((i) => i.id)).toEqual(['b'])

    // 命中地址域名里的 library（名称也是 Library）
    const library = await r.list({ cursor: null, filters: { q: 'library' } })
    if (library.ok) expect(library.value.items.map((i) => i.id)).toEqual(['d'])

    // 只出现在地址里的片段（it.shanghaitech）也要搜得到
    const byHost = await r.list({ cursor: null, filters: { q: 'it.shanghaitech' } })
    if (byHost.ok) expect(byHost.value.items.map((i) => i.id)).toEqual(['c'])
  })

  it('分类与关键词是两个独立条件，可以叠加', async () => {
    const r = repo(seed)
    const both = await r.list({ cursor: null, filters: { category: 'network', q: '信息' } })
    if (both.ok) expect(both.value.items.map((i) => i.id)).toEqual(['c'])

    const conflict = await r.list({ cursor: null, filters: { category: 'academic', q: 'vpn' } })
    if (conflict.ok) expect(conflict.value.items).toHaveLength(0)
  })

  it('空的分类 / 关键词被忽略，不会变成"搜空字符串"', async () => {
    const r = repo(seed)
    const result = await r.list({ cursor: null, filters: { category: '   ', q: '  ' } })
    if (result.ok) expect(result.value.items).toHaveLength(4)
  })

  it('游标分页只返回下一页，并给出正确的 nextCursor', async () => {
    const r = repo(seed)
    const first = await r.list({ cursor: null, limit: 3, filters: {} })
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(first.value.items.map((i) => i.id)).toEqual(['b', 'd', 'a'])
    expect(first.value.nextCursor).toBe('a')
    // 后端不返回 total（Page.total 是可选字段）
    expect(first.value.total).toBeUndefined()

    const second = await r.list({ cursor: 'a', limit: 3, filters: {} })
    if (second.ok) {
      expect(second.value.items.map((i) => i.id)).toEqual(['c'])
      expect(second.value.nextCursor).toBeNull()
    }
  })
})

describe('Mock 仓储 · 详情 / 创建 / 核对', () => {
  it('详情存在即可读，不存在统一 NOT_FOUND', async () => {
    const r = repo()
    expect((await r.detail('tp-1')).ok).toBe(true)

    const missing = await r.detail('ghost')
    expect(missing.ok).toBe(false)
    if (!missing.ok) expect(missing.error.code).toBe('NOT_FOUND')
  })

  it('创建：落库并出现在列表最前（默认状态是 active）', async () => {
    const r = repo([])
    const created = await r.create({
      key: 'tp-test-1',
      name: '  正版软件中心  ',
      category: 'software',
      url: 'https://software.shanghaitech.edu.cn/',
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return
    expect(created.value.name).toBe('正版软件中心')
    expect(created.value.status).toBe('active')
    expect(created.value.createdAt).toBe(NOW.toISOString())

    const listed = await r.list({ cursor: null, filters: {} })
    if (listed.ok) expect(listed.value.items.map((i) => i.id)).toContain(created.value.id)
  })

  it('创建的边界校验：key / 名称 / 分类 / 地址统一 VALIDATION_FAILED', async () => {
    const r = repo([])
    const base = {
      key: 'tp-test-1',
      name: '校园 VPN',
      category: 'network',
      url: 'https://vpn.shanghaitech.edu.cn/',
    }

    const cases = [
      { ...base, key: '   ' },
      { ...base, name: '   ' },
      { ...base, name: 'x'.repeat(61) },
      { ...base, category: '第八分类' },
      { ...base, category: '' },
      { ...base, url: 'javascript:alert(1)' },
      { ...base, url: 'vpn.shanghaitech.edu.cn' },
      { ...base, url: '   ' },
    ]

    for (const input of cases) {
      const result = await r.create(input)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.code).toBe('VALIDATION_FAILED')
    }
  })

  it('sync 把状态改成已核对并推进 updatedAt；重复调用幂等、不报冲突', async () => {
    const r = repo([link()])

    const first = await r.sync('tp-1')
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(first.value.status).toBe('synced')
    expect(isReviewed(first.value.status)).toBe(true)
    expect(first.value.updatedAt).toBe(NOW.toISOString())

    // 幂等：再点一次仍然成功，状态不变
    const again = await r.sync('tp-1')
    expect(again.ok).toBe(true)
    if (again.ok) expect(again.value.status).toBe('synced')
  })

  it('sync 不存在的 id → NOT_FOUND', async () => {
    const r = repo()
    const result = await r.sync('ghost')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('NOT_FOUND')
  })
})

describe('Mock 仓储 · 持久化与演示控制', () => {
  it('数据落在 CachePort：新实例读到同一份数据（刷新页面不丢）', async () => {
    const cache = createMemoryStorage()
    const options = { cache, latencyMs: 0, now: () => NOW }

    const first = createMockTechpieRepository(options)
    const created = await first.create({
      key: 'tp-persist-1',
      name: '图书馆',
      category: 'library',
      url: 'https://library.shanghaitech.edu.cn/',
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return

    const second = createMockTechpieRepository(options)
    const listed = await second.list({ cursor: null, filters: {} })
    if (listed.ok) expect(listed.value.items.map((i) => i.id)).toContain(created.value.id)
  })

  it('数据集与列表缓存使用不同的 key：写缓存不会覆盖数据集', async () => {
    const cache = createMemoryStorage()
    const r = createMockTechpieRepository({ cache, latencyMs: 0, now: () => NOW })
    r.seed([link()])

    // 模拟 listUseCase 往列表缓存 key 写一页载荷（key 由装配层注入）
    cache.write(`${STORAGE_PREFIX}cache:techpie:list`, {
      items: [],
      nextCursor: null,
      updatedAt: NOW.toISOString(),
    })

    const listed = await r.list({ cursor: null, filters: {} })
    if (listed.ok) expect(listed.value.items.map((i) => i.id)).toEqual(['tp-1'])
  })

  it('failNextRequests 只影响接下来 N 次请求', async () => {
    const r = repo()
    r.failNextRequests(1)
    const failed = await r.list({ cursor: null, filters: {} })
    expect(failed.ok).toBe(false)
    if (!failed.ok) expect(failed.error.code).toBe('UPSTREAM_UNAVAILABLE')

    expect((await r.list({ cursor: null, filters: {} })).ok).toBe(true)
  })

  it('clearAll 之后是真的空列表；reset 后种子恢复', async () => {
    const r = repo()
    r.clearAll()
    const empty = await r.list({ cursor: null, filters: {} })
    if (empty.ok) expect(empty.value.items).toHaveLength(0)

    r.reset()
    const restored = await r.list({ cursor: null, filters: {} })
    if (restored.ok) expect(restored.value.items.length).toBeGreaterThanOrEqual(8)
  })
})

describe('派生视图与用例校验', () => {
  it('summarize 给出卡片直接可用的字段', () => {
    const summary = summarize(link({ status: 'synced' }), NOW)
    expect(summary.categoryLabel).toBe('教务与选课')
    expect(summary.urlHost).toBe('jwc.shanghaitech.edu.cn')
    expect(summary.statusLabel).toBe('已核对')
    expect(summary.reviewed).toBe(true)
    expect(summary.lastCheckedLabel).toBe('2 小时前')
  })

  it('空表单逐项给出提示', () => {
    const problems = validateDraft({ name: '', category: '', url: '' })
    expect(problems).toContain('请填写服务名称')
    expect(problems).toContain('请选择一个分类')
    expect(problems).toContain('请填写服务地址')
  })

  it('分类必须在白名单内；地址必须是 http(s)', () => {
    const problems = validateDraft({
      name: '某个服务',
      category: 'invented',
      url: 'ftp://x.com',
    })
    expect(problems).toContain('请选择一个分类')
    expect(problems).toContain('请填写以 http:// 或 https:// 开头的完整网址')
  })

  it('合法草稿没有任何问题', () => {
    expect(
      validateDraft({
        name: '校园 VPN',
        category: 'network',
        url: 'https://vpn.shanghaitech.edu.cn/',
      }),
    ).toEqual([])
  })
})
