import { describe, expect, it } from 'vitest'
import { CAMPUS_BOUNDARY, CAMPUS_BOUNDS, CAMPUS_FEATURED, CAMPUS_MAP, CAMPUS_PLACES, blurredCampusPoint, campusCoordinate, campusPixel, isOnCampus } from './campus-map'
import { WILDLIFE_CAMPUS } from './wildlife'

describe('shared campus map', () => {
  it('uses a detailed local campus plan and named landmarks', () => {
    expect(CAMPUS_MAP.width).toBeGreaterThan(2000)
    expect(CAMPUS_PLACES.length).toBeGreaterThanOrEqual(65)
    expect(CAMPUS_FEATURED.some(p => p.name === '物质塔')).toBe(true)
    expect(CAMPUS_FEATURED.some(p => p.kind === 'bridge')).toBe(true)
  })
  it('converts map pixels and GCJ02 coordinates without meaningful drift', () => {
    for (const place of CAMPUS_PLACES) {
      const pixel = campusPixel(place), point = campusCoordinate(pixel.x, pixel.y)
      expect(Math.abs(point.latitude - place.latitude)).toBeLessThan(.000002)
      expect(Math.abs(point.longitude - place.longitude)).toBeLessThan(.000002)
    }
  })
  it('accepts the campus center and rejects other locations', () => {
    expect(isOnCampus(WILDLIFE_CAMPUS)).toBe(true)
    expect(isOnCampus({ latitude: 31.2304, longitude: 121.4737 })).toBe(false)
    expect(isOnCampus({ latitude: NaN, longitude: Infinity })).toBe(false)
  })
  it('keeps every coarse location inside the actual campus polygon', () => {
    for (const point of [WILDLIFE_CAMPUS, ...CAMPUS_BOUNDARY, { latitude: 31.1734, longitude: 121.5932 }]) {
      const blurred = blurredCampusPoint(point)
      expect(isOnCampus(blurred)).toBe(true)
      expect(blurred.latitude).toBe(Number(blurred.latitude.toFixed(3)))
      expect(blurred.longitude).toBe(Number(blurred.longitude.toFixed(3)))
      expect(blurredCampusPoint(blurred)).toEqual(blurred)
      expect(blurred.latitude).toBeGreaterThanOrEqual(CAMPUS_BOUNDS.south)
      expect(blurred.latitude).toBeLessThanOrEqual(CAMPUS_BOUNDS.north)
    }
  })
})
