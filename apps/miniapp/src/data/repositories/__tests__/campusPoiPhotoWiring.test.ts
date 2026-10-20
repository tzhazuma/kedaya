import { describe, expect, it, vi } from 'vitest'

vi.mock('../../storage/taroStorage', () => ({
  createTaroStorage: () => ({ read: () => null, write: () => undefined, remove: () => undefined }),
}))

import { createCampusPoiLocalRepository } from '../campusPoiLocalRepository'

describe('一图通照片挂接', () => {
  it('食堂摊位带上了照片与署名', () => {
    const repo = createCampusPoiLocalRepository({
      read: () => null, write: () => undefined, remove: () => undefined,
    })
    const pois = repo.readPois()
    const withPhoto = pois.filter((p) => p.photoUrls.length > 0)
    expect(withPhoto.length).toBeGreaterThan(0)
    for (const poi of withPhoto) {
      expect(poi.photoCredit, `${poi.id} 缺署名`).toBeTruthy()
      expect(poi.photoUrls.every((u) => u.startsWith('https://map.niyiwei.com/'))).toBe(true)
    }
  })

  it('OSM 的 POI 不带照片（我们没拿它们的图）', () => {
    const repo = createCampusPoiLocalRepository({
      read: () => null, write: () => undefined, remove: () => undefined,
    })
    for (const poi of repo.readPois().filter((p) => p.source === 'osm')) {
      expect(poi.photoUrls).toEqual([])
      expect(poi.photoCredit).toBeNull()
    }
  })
})
