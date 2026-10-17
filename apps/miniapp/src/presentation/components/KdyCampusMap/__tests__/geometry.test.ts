import { describe, expect, it } from 'vitest'

import {
  centeredOffset,
  circleRect,
  clampOffset,
  fitWidth,
  layoutFor,
  offsetForPixel,
  renderedPoint,
  segmentRect,
  viewportCenterPixel,
  zoomBounds,
} from '../geometry'
import type { CampusImageSize, CampusViewport } from '../geometry'

/** 真实口径：底图 2816×2048、1 像素 = 0.5 米（见 packages/contracts/src/campus-map-data.json） */
const IMAGE: CampusImageSize = { width: 2816, height: 2048 }
const METERS_PER_PIXEL = 0.5
const VIEWPORT: CampusViewport = { width: 335, height: 420 }

const layout = (width: number) => layoutFor(width, IMAGE, METERS_PER_PIXEL)
const fitted = () => layout(fitWidth(VIEWPORT, IMAGE))

describe('campus map geometry', () => {
  it('fits the campus height into the viewport by default', () => {
    const width = fitWidth(VIEWPORT, IMAGE)
    expect(width).toBeGreaterThan(VIEWPORT.width)
    expect(fitted().renderedHeight).toBeCloseTo(VIEWPORT.height, 6)
  })

  it('never returns a width narrower than the viewport', () => {
    const wide: CampusViewport = { width: 900, height: 120 }
    expect(fitWidth(wide, IMAGE)).toBe(900)
  })

  it('survives degenerate image or viewport sizes', () => {
    expect(fitWidth({ width: 320, height: 0 }, { width: 0, height: 0 })).toBe(320)
    expect(layoutFor(0, IMAGE, METERS_PER_PIXEL).renderedWidth).toBe(1)
    expect(layoutFor(100, IMAGE, 0).pxPerMeter).toBe(0)
  })

  it('keeps zoom inside a sane range', () => {
    const bounds = zoomBounds(VIEWPORT, IMAGE)
    expect(bounds.min).toBeCloseTo(fitWidth(VIEWPORT, IMAGE), 6)
    expect(bounds.max).toBeGreaterThanOrEqual(bounds.min * 3)
    expect(bounds.max).toBeGreaterThanOrEqual(IMAGE.width)
  })

  it('converts meters to rendered pixels with the campus scale', () => {
    // 577.5 / 2816 / 0.5 ≈ 0.4102 渲染像素 / 米
    expect(fitted().pxPerMeter).toBeCloseTo(0.41016, 4)
  })

  it('centers the campus and clamps offsets inside the image', () => {
    const offset = centeredOffset(fitted(), VIEWPORT)
    expect(offset).toEqual({ left: 121.25, top: 0 })
    // 越界偏移会被夹回
    expect(clampOffset({ left: -50, top: -50 }, fitted(), VIEWPORT)).toEqual({ left: 0, top: 0 })
    const far = clampOffset({ left: 99999, top: 99999 }, fitted(), VIEWPORT)
    expect(far.left).toBeCloseTo(fitted().renderedWidth - VIEWPORT.width, 6)
    expect(far.top).toBeCloseTo(0, 6)
  })

  it('centers an image pixel without drifting', () => {
    const target = { x: IMAGE.width / 2, y: IMAGE.height / 2 }
    const offset = offsetForPixel(target, fitted(), VIEWPORT)
    expect(offset).toEqual(centeredOffset(fitted(), VIEWPORT))
    const back = viewportCenterPixel(offset, fitted(), VIEWPORT)
    expect(back.x).toBeCloseTo(target.x, 6)
    expect(back.y).toBeCloseTo(target.y, 6)
  })

  it('maps image pixels to rendered positions', () => {
    expect(renderedPoint({ x: 100, y: 50 }, layout(2816))).toEqual({ x: 100, y: 50 })
    expect(renderedPoint({ x: 1408, y: 1024 }, layout(1408))).toEqual({ x: 704, y: 512 })
  })

  it('turns a zone radius in meters into a pixel circle', () => {
    const circle = circleRect({ x: 1408, y: 1024 }, 100, fitted())
    expect(circle.size).toBeCloseTo(100 * fitted().pxPerMeter * 2, 6)
    const center = renderedPoint({ x: 1408, y: 1024 }, fitted())
    expect(circle.left + circle.size / 2).toBeCloseTo(center.x, 6)
    expect(circle.top + circle.size / 2).toBeCloseTo(center.y, 6)
  })

  it('keeps a zero or negative radius collapsed instead of inverted', () => {
    expect(circleRect({ x: 0, y: 0 }, 0, fitted()).size).toBe(0)
    expect(circleRect({ x: 0, y: 0 }, -30, fitted()).size).toBe(0)
  })

  it('computes rotated segments for the inferred-track polyline', () => {
    const east = segmentRect({ x: 10, y: 20 }, { x: 40, y: 20 })
    expect(east).toEqual({ left: 10, top: 20, length: 30, angle: 0 })
    const south = segmentRect({ x: 0, y: 0 }, { x: 0, y: 10 })
    expect(south.angle).toBeCloseTo(90, 6)
    const diagonal = segmentRect({ x: 0, y: 0 }, { x: 3, y: 4 })
    expect(diagonal.length).toBeCloseTo(5, 6)
    expect(diagonal.angle).toBeCloseTo(53.1301, 3)
  })
})
