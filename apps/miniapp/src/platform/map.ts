import Taro from '@tarojs/taro'
import { err, ok } from '@kedaya/shared'

import { isH5, isWeapp } from './env'
import type { PlatformResult } from './failure'

/**
 * 地图 / 导航。
 *
 * - **微信小程序**：`wx.openLocation` 打开微信内置地图，用户可直接点「导航」。
 *   注意：坐标必须用 **gcj02**（微信与国内地图通用坐标系），
 *   后端若存 wgs84（GPS 原始）必须先转换，否则会有几十米偏移。
 * - **H5 降级**：浏览器无法唤起微信内置地图 →
 *   先尝试高德 Web URI（`window.open`），再降级为复制坐标。
 */

export type GeoCoordinateSystem = 'gcj02' | 'wgs84'

export interface GeoPoint {
  latitude: number
  longitude: number
  name: string
  address?: string
  /** 默认 gcj02（微信要求）；wgs84 需先转换 */
  coordinateSystem?: GeoCoordinateSystem
}

export type MapChannel = 'native' | 'web-uri' | 'clipboard'

/** 高德 Web URI（H5 降级用） */
export function buildAmapUri(point: GeoPoint): string {
  const position = `${point.longitude},${point.latitude}`
  const name = encodeURIComponent(point.name)
  return `https://uri.amap.com/marker?position=${position}&name=${name}&coordinate=gaode&callnative=1`
}

export async function openLocation(point: GeoPoint): Promise<PlatformResult<MapChannel>> {
  if (isWeapp()) {
    try {
      await Taro.openLocation({
        latitude: point.latitude,
        longitude: point.longitude,
        name: point.name,
        address: point.address ?? '',
        scale: 18,
      })
      return ok('native')
    } catch (error) {
      return err({
        code: 'FAILED',
        message: error instanceof Error ? error.message : '打开地图失败',
      })
    }
  }

  if (isH5() && typeof window !== 'undefined') {
    try {
      window.open(buildAmapUri(point), '_blank')
      return ok('web-uri')
    } catch {
      // 弹窗被拦截 → 走剪贴板降级
    }
  }

  try {
    await Taro.setClipboardData({
      data: `${point.name} ${point.latitude},${point.longitude}`,
    })
    return ok('clipboard')
  } catch (error) {
    return err({
      code: 'FAILED',
      message: error instanceof Error ? error.message : '复制坐标失败',
    })
  }
}
