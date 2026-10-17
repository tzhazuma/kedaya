import { View } from '@tarojs/components'
import type { ReactNode } from 'react'

import './index.scss'

/**
 * KdyRing —— 圆环进度（营养管家的热量主视觉）。
 *
 * **为什么不用 SVG**：Taro 4 的 `@tarojs/components` 不导出 `Svg` / `Circle`，
 * 微信小程序也没有原生 SVG 组件。这里用「双半盘旋转 + 中心镂空」实现：
 *   · 右半盘旋转 `min(φ,180)−180`°，覆盖 [0, φ] 中落在右半平面的部分
 *   · 左半盘旋转 `max(−180, φ−360)`°，覆盖 [180, φ]（仅 φ>180 时可见）
 *   · 中心镂空用 surface 色 → **环必须放在卡片（surface 背景）上使用**
 *
 * 颜色一律走 SCSS 类 → 设计令牌（契约 §6.2 禁止手写色值），
 * 因此这里只传 `tone`，不传具体色值。
 *
 * `percent` 允许超过 100（超限）：环最多画满，文案由调用方决定
 * （例如「已超 120%」），组件不替业务藏状态。
 */
export type KdyRingTone = 'brand' | 'success' | 'warning' | 'danger'

export interface KdyRingProps {
  /** 0-100+，超过 100 按满环绘制 */
  percent: number
  size?: number
  strokeWidth?: number
  tone?: KdyRingTone
  /** 环中心内容（通常是大号数字 + 单位） */
  children?: ReactNode
}

export function KdyRing({
  percent,
  size = 128,
  strokeWidth = 10,
  tone = 'brand',
  children,
}: KdyRingProps) {
  const clamped = Math.max(0, Math.min(percent, 100))
  /** 顺时针从 12 点起扫过的角度（0-360） */
  const sweep = (clamped / 100) * 360
  /** 右半盘：静止时覆盖右半（0°→180°）；负角逆时针退让出已扫部分 */
  const rightDeg = Math.min(sweep, 180) - 180
  /** 左半盘：φ≤180 时整体退出左半平面（-180°），φ>180 时露出 [180°, φ] */
  const leftDeg = Math.max(-180, sweep - 360)

  const half = size / 2
  const holeSize = Math.max(0, size - strokeWidth * 2)

  return (
    <View className='kdy-ring' style={`width: ${size}px; height: ${size}px`}>
      {/* 轨道环（整圆描边，无需遮罩） */}
      <View
        className='kdy-ring__track'
        style={`width: ${size}px; height: ${size}px; border-width: ${strokeWidth}px`}
      />

      {/* 进度右半盘：transform-origin 落在环心（左边缘中点） */}
      <View className='kdy-ring__clip kdy-ring__clip--right'>
        <View
          className={`kdy-ring__pie kdy-ring__pie--${tone}`}
          style={`width: ${half}px; height: ${size}px; border-radius: 0 ${half}px ${half}px 0; transform-origin: 0% 50%; transform: rotate(${rightDeg}deg)`}
        />
      </View>

      {/* 进度左半盘：transform-origin 落在环心（右边缘中点） */}
      <View className='kdy-ring__clip kdy-ring__clip--left'>
        <View
          className={`kdy-ring__pie kdy-ring__pie--${tone}`}
          style={`width: ${half}px; height: ${size}px; border-radius: ${half}px 0 0 ${half}px; transform-origin: 100% 50%; transform: rotate(${leftDeg}deg)`}
        />
      </View>

      {/* 中心镂空（surface 色，与卡片背景一致） */}
      <View
        className='kdy-ring__hole'
        style={`width: ${holeSize}px; height: ${holeSize}px; left: ${strokeWidth}px; top: ${strokeWidth}px`}
      />

      <View className='kdy-ring__center'>{children}</View>
    </View>
  )
}

/**
 * KdyBar —— 条形进度（六项营养逐项展示）。
 * 与 KdyRing 共用 tone 体系；超限时由调用方选 danger。
 */
export interface KdyBarProps {
  percent: number
  tone?: KdyRingTone
  height?: number
}

export function KdyBar({ percent, tone = 'brand', height = 8 }: KdyBarProps) {
  const clamped = Math.max(0, Math.min(percent, 100))
  return (
    <View className='kdy-bar' style={`height: ${height}px`}>
      <View
        className={`kdy-bar__inner kdy-bar__inner--${tone}`}
        style={`width: ${clamped}%`}
      />
    </View>
  )
}

export default KdyRing
