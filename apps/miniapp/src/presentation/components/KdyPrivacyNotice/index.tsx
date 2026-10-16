import { Text, View } from '@tarojs/components'

import {
  FUZZ_LEVEL_LABELS,
  WILDLIFE_AGGREGATION_NOTICE,
  WILDLIFE_PRIVACY_NOTICE,
  WILDLIFE_PRIVACY_NOTICE_SHORT,
} from '../../../domain/models/wildlife'
import type { FuzzLevel } from '../../../domain/models/wildlife'
import './index.scss'

/**
 * KdyPrivacyNotice —— 位置模糊化说明（规格 §9，**硬要求**）。
 *
 * 为什么必须显式告诉用户：不写清楚就是**误导性的隐私承诺**。
 * 用户会以为自己看到的是精确点位，进而以为自己上报的精确点位也公开了（或反之）。
 * 两句话都必须出现：
 *
 * 1. **「你看到的公开位置是模糊后的」** —— 避免用户误读地图精度；
 * 2. **「敏感区不公开坐标」** —— 让用户理解为什么有些点只有区域没有位置。
 *
 * 另外，地图页必须展示**聚合延迟**（规格 §8.1 E10）：
 * 热点至少延迟 24 小时，平台不做「围观召集工具」。
 *
 * 色值全部来自设计令牌（`$kdy-*`）。
 */
export interface KdyPrivacyNoticeProps {
  /** 当前对象的模糊层级；不传则只展示通用说明 */
  fuzzLevel?: FuzzLevel
  /** 该区域 / 物种的模糊半径（米） */
  fuzzRadiusM?: number
  /** 敏感区 → 完全不公开坐标 */
  isSensitive?: boolean
  /** 地图页展示聚合延迟说明（E10） */
  showAggregation?: boolean
  /** 紧凑版（列表卡片里用） */
  compact?: boolean
  title?: string
}

export function KdyPrivacyNotice({
  fuzzLevel,
  fuzzRadiusM,
  isSensitive = false,
  showAggregation = false,
  compact = false,
  title = '关于位置隐私',
}: KdyPrivacyNoticeProps) {
  return (
    <View className='kdy-privacy'>
      <View className='kdy-privacy__head'>
        <Text className='kdy-privacy__glyph'>🔒</Text>
        <Text className='kdy-privacy__title'>{title}</Text>
      </View>

      <Text className='kdy-privacy__body'>
        {compact ? WILDLIFE_PRIVACY_NOTICE_SHORT : WILDLIFE_PRIVACY_NOTICE}
      </Text>

      {fuzzLevel !== undefined && (
        <Text className='kdy-privacy__level'>
          本条的位置状态：{FUZZ_LEVEL_LABELS[fuzzLevel]}
          {fuzzRadiusM === undefined ? '' : `（模糊半径 ${fuzzRadiusM} 米）`}
        </Text>
      )}

      {isSensitive && (
        <Text className='kdy-privacy__sensitive'>
          该区域为敏感区（宿舍 / 保育 / 巢区），公开信息**不含任何坐标**，只显示所属区域。
        </Text>
      )}

      {showAggregation && (
        <Text className='kdy-privacy__aggregation'>{WILDLIFE_AGGREGATION_NOTICE}</Text>
      )}
    </View>
  )
}

export default KdyPrivacyNotice
