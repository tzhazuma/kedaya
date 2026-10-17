import { Image, View } from '@tarojs/components'

import { DUCK_MASCOT_SRC } from '../../theme/mascot'
import './index.scss'

/**
 * KdyMascot —— 可达鸭吉祥物。
 *
 * 它替代了之前的 `🦆` emoji：emoji 在不同微信版本 / 机型上会被渲染成
 * 各家自己的字形（在 34px 的头像里几乎认不出是鸭子），而且颜色不受控、
 * 与品牌黄体系对不上。换成一张固定贴图后，头像、悬浮球、登录页主视觉
 * 用的是同一张图，视觉是连贯的。
 *
 * `plate` 变体是**白色圆盘**而不是品牌黄：鸭子本身是黄的，
 * 直接压在品牌黄渐变上会糊成一片黄，反而看不出图案。
 */
export interface KdyMascotProps {
  /** 直径（px），默认 40 */
  size?: number
  /** 加一圈白色圆盘底（压在渐变 / 深色上时必须开） */
  plate?: boolean
  className?: string
}

export function KdyMascot({ size = 40, plate = false, className }: KdyMascotProps) {
  const classes = ['kdy-mascot', plate ? 'kdy-mascot--plate' : '', className ?? '']
    .filter((item) => item !== '')
    .join(' ')
  const imageSize = plate ? Math.max(16, Math.round(size * 0.76)) : size

  return (
    <View className={classes} style={{ width: `${size}px`, height: `${size}px` }}>
      <Image
        className='kdy-mascot__image'
        src={DUCK_MASCOT_SRC}
        mode='aspectFit'
        style={{ width: `${imageSize}px`, height: `${imageSize}px` }}
      />
    </View>
  )
}

export default KdyMascot
