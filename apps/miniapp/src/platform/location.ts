import Taro from '@tarojs/taro'
import { err, ok } from '@kedaya/shared'

import { toMapPoint } from '../domain/models/wildlife'
import { isWeapp } from './env'
import type { PlatformResult } from './failure'
import { openLocation } from './map'

/**
 * 定位与「在地图中打开」（规格 §3.2 的**两个坐标系消费点**都在这里收口）。
 *
 * - **消费点 A（采集）**：`wx.getLocation({ type: 'wgs84' })`。
 *   ⚠️ `type` **必须显式写 `'wgs84'`** —— 绝不依赖默认值（默认值可能随基础库版本变化，
 *   规格 §3.2 硬要求 2）。返回的坐标就是 WGS84，**不需要转换**，直接可以上传。
 * - **消费点 B（打开地图）**：`wx.openLocation` **要求 GCJ-02**。
 *   本函数刻意接收 **WGS84**，在内部调用 `toMapPoint()` 转换 ——
 *   这样调用方**没有机会**忘记转换（类型上就传不进去 GCJ-02 的语义）。
 *
 * 与之相对，**用户在 `<map>` 上点选**得到的是 GCJ-02，那条路径的转换入口是
 * `domain/models/wildlife` 的 `toApiPoint(point, 'gcj02')`（见上报页）。
 *
 * H5 降级：`wx.getLocation` 无对应能力 → `UNSUPPORTED`，UI 引导用户在地图上点选。
 */

export interface LocatedPoint {
  /** **WGS84** */
  lat: number
  /** **WGS84** */
  lng: number
  /** GPS 精度（米）。`wx.getLocation` 的 `accuracy`，可能为 0（未知） */
  accuracyM: number
  /** 恒为 `wgs84` —— 显式标注，防止下游误以为是 GCJ-02 */
  coordinateSystem: 'wgs84'
}

export async function getCurrentLocation(): Promise<PlatformResult<LocatedPoint>> {
  if (!isWeapp()) {
    return err({
      code: 'UNSUPPORTED',
      message: '当前端不支持原生定位，请在地图上点选位置',
    })
  }

  try {
    // ⚠️ type 必须显式指定（规格 §3.2 硬要求 2）
    const result = await Taro.getLocation({ type: 'wgs84' })
    return ok({
      lat: result.latitude,
      lng: result.longitude,
      accuracyM: result.accuracy ?? 0,
      coordinateSystem: 'wgs84',
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    // 用户拒绝授权 / 系统未开启定位
    if (/auth deny|authorize|deny|permission/i.test(message)) {
      return err({ code: 'REJECTED', message: '未获得定位权限，请在地图上手动点选位置' })
    }
    return err({ code: 'FAILED', message })
  }
}

/**
 * 在微信内置地图中打开某个观测点（消费点 B）。
 *
 * ⚠️ 入参是 **WGS84**（我们全链路的唯一真相）；`wx.openLocation` 要求 GCJ-02，
 * 因此这里必须转换 —— 直接传 WGS84 会有约 470 米偏移。
 */
export async function openWildlifePointInMap(
  point: { lat: number; lng: number },
  name: string,
  address?: string,
): Promise<PlatformResult<'native' | 'web-uri' | 'clipboard'>> {
  const gcj = toMapPoint(point)
  return openLocation({
    latitude: gcj.lat,
    longitude: gcj.lng,
    name,
    ...(address === undefined ? {} : { address }),
    coordinateSystem: 'gcj02',
  })
}
