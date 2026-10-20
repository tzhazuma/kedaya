import type { CampusPoiSupplement, PoiTimeSlot } from '@kedaya/contracts'
import { describe, expect, it, vi } from 'vitest'

/**
 * 仓储默认参数会 import `data/storage/taroStorage`（它又 import `@tarojs/taro`）。
 * 单测只验证纯逻辑，不加载 Taro 运行时；这里把那个 adapter 换成空实现，
 * 所有用例都显式注入自己的 `CachePort`。
 */
vi.mock('../../storage/taroStorage', () => ({
  createTaroStorage: () => ({
    read: () => null,
    write: () => undefined,
    remove: () => undefined,
  }),
}))

import type { CachePort } from '../../../domain/ports/cachePort'
import {
  CAMPUS_POI_LOCAL_STORAGE_KEY,
  CAMPUS_POI_SLOT_STORAGE_KEY,
  createCampusPoiLocalRepository,
} from '../campusPoiLocalRepository'

/** 内存 CachePort：测试不碰 Taro / wx storage */
function createMemoryCache(): CachePort & { dump(): Record<string, unknown> } {
  const values = new Map<string, unknown>()
  return {
    read<T>(key: string): T | null {
      return (values.get(key) as T | undefined) ?? null
    },
    write<T>(key: string, value: T): void {
      values.set(key, value)
    },
    remove(key: string): void {
      values.delete(key)
    },
    dump(): Record<string, unknown> {
      return Object.fromEntries(values)
    },
  }
}

const VALID_POI: CampusPoiSupplement = {
  id: 'poi-express-station-test',
  category: 'express-station',
  name: '【演示】快递驿站',
  lat: 31.1764,
  lng: 121.5898,
  floor: 0,
  description: null,
  openingHours: '09:00-20:00',
  photoUrls: [],
  photoCredit: null,
  verifiedAt: null,
  source: 'unknown',
}

describe('校园 POI · 本机仓储', () => {
  it('写入后能原样读回；clear 会清掉两个 key', () => {
    const cache = createMemoryCache()
    const repository = createCampusPoiLocalRepository(cache)

    const slots: PoiTimeSlot[] = [
      {
        poiId: VALID_POI.id,
        startsAt: '2026-10-19T06:30:00.000Z',
        endsAt: '2026-10-19T07:00:00.000Z',
        kind: 'personal',
        title: '取演示包裹',
        sourceRef: null,
      },
    ]

    repository.writePois([VALID_POI])
    repository.writeSlots(slots)

    expect(repository.readPois()).toEqual([VALID_POI])
    expect(repository.readSlots()).toEqual(slots)
    expect(Object.keys(cache.dump())).toEqual([
      CAMPUS_POI_LOCAL_STORAGE_KEY,
      CAMPUS_POI_SLOT_STORAGE_KEY,
    ])

    repository.clear()
    // ⚠️ 语义变化：`clear()` 现在表示「清掉我写入的内容，回到**初始状态**」。
    // 初始状态是 **OpenStreetMap 的 7 个真实 POI**，不是空列表 ——
    // 因为本机没数据时 `readPois()` 会回退到 OSM（见仓储里的注释）。
    //
    // 这条断言刻意写成「等于 OSM 种子」而不是「非空」：
    // 如果哪天有人把回退改成返回演示数据，这里会红。
    expect(repository.readPois()).toHaveLength(7)
    expect(repository.readPois().every((poi) => poi.source === 'osm')).toBe(true)
    // 但 storage 里的两个 key 必须真的被清掉（回退是读时行为，不落盘）
    expect(Object.keys(cache.dump())).toEqual([])
    expect(repository.readSlots()).toEqual([])
  })

  /**
   * 版权红线：即使有人把另一参赛组手拍照片的地址写进 storage，
   * 读取时也必须被契约的 `forbiddenOrigins` 拒收（整条丢弃）。
   */
  /**
   * ⚠️ 策略在 2026-10-20 变了 —— 这条测试跟着改，不是"放宽标准"。
   *
   * **变更前**：`map.niyiwei.com` 在 `forbiddenOrigins` 里，任何该域名的照片
   * 整条丢弃（因为照片著作权归拍摄者、我们没授权）。
   *
   * **变更后**：项目负责人已获得对方参赛组**口头**授权，允许合并其地库与
   * 食堂菜单照片。于是策略从「禁止该域名」改为「**允许，但必须有署名**」。
   *
   * 所以现在真正要守的规则变了：不再是"拒收某个域名"，
   * 而是"**没有署名的照片一律不许进**" —— 无论它来自哪个域名。
   */
  it('⚠️ 有署名的授权照片可以保留（含 map.niyiwei.com）', () => {
    const cache = createMemoryCache()
    const repository = createCampusPoiLocalRepository(cache)

    const authorized = {
      ...VALID_POI,
      id: 'poi-authorized-photo',
      photoUrls: ['https://map.niyiwei.com/garage/b1.jpg'],
      photoCredit: '一图通参赛组（授权合并，2026-10-20）',
    }

    repository.writePois([VALID_POI, authorized])
    expect(repository.readPois().map((poi) => poi.id)).toEqual([VALID_POI.id, authorized.id])
  })

  it('⚠️ 没有署名的照片一律拒收（任何域名）', () => {
    const cache = createMemoryCache()
    const repository = createCampusPoiLocalRepository(cache)

    repository.writePois([
      VALID_POI,
      {
        ...VALID_POI,
        id: 'poi-photo-without-credit',
        photoUrls: ['https://example.com/authorized.jpg'],
        // 故意不给 photoCredit
      },
    ])

    // 只有无照片的那条活下来
    expect(repository.readPois().map((poi) => poi.id)).toEqual([VALID_POI.id])
  })

  it('拒收越界坐标、未知分类与非法楼层，坏条目不影响好条目', () => {
    const cache = createMemoryCache()
    const repository = createCampusPoiLocalRepository(cache)

    repository.writePois([
      VALID_POI,
      { ...VALID_POI, id: 'poi-outside', lat: 0, lng: 0 },
      { ...VALID_POI, id: 'poi-negative-floor', floor: -1 },
    ])
    // 未知分类在类型上就进不来，用底层 storage 模拟"上一版遗留的脏数据"
    cache.write(CAMPUS_POI_LOCAL_STORAGE_KEY, [
      VALID_POI,
      { ...VALID_POI, id: 'poi-unknown-category', category: 'not-a-category' },
    ])

    expect(repository.readPois().map((poi) => poi.id)).toEqual([VALID_POI.id])
  })

  it('时间串必须带显式时区偏移，且结束要晚于开始', () => {
    const cache = createMemoryCache()
    const repository = createCampusPoiLocalRepository(cache)

    const valid: PoiTimeSlot = {
      poiId: VALID_POI.id,
      startsAt: '2026-10-19T14:30:00+08:00',
      endsAt: '2026-10-19T15:00:00+08:00',
      kind: 'course',
      title: '演示课程',
      sourceRef: null,
    }

    repository.writeSlots([valid])
    cache.write(CAMPUS_POI_SLOT_STORAGE_KEY, [
      valid,
      { ...valid, startsAt: '2026-10-19 14:30', endsAt: '2026-10-19 15:00' },
      { ...valid, endsAt: valid.startsAt },
      { ...valid, sourceRef: 42 },
    ])

    expect(repository.readSlots()).toEqual([valid])
  })
})
