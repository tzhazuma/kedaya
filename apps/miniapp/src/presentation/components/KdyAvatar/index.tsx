import { Image, View } from '@tarojs/components'
import { SmileOutlined } from '@taroify/icons'

import './index.scss'

/**
 * KdyAvatar —— 头像展示（没有头像时回退到吉祥物图标）。
 *
 * 只负责展示：**选择**头像必须由用户点击
 * `<KdyButton openType='chooseAvatar'>` 触发（微信的硬性要求，
 * 代码无法静默获取），所以选择逻辑留在页面里，避免这个组件背上平台耦合。
 */
export interface KdyAvatarProps {
  src?: string | null
  /** 直径（px），默认 72 */
  size?: number
  className?: string
}

export function KdyAvatar({ src, size = 72, className }: KdyAvatarProps) {
  const style = { width: `${size}px`, height: `${size}px` }
  const hasImage = typeof src === 'string' && src.length > 0

  return (
    <View
      className={['kdy-avatar', className ?? ''].filter((item) => item !== '').join(' ')}
      style={style}
    >
      {hasImage ? (
        <Image className='kdy-avatar__image' src={src} mode='aspectFill' style={style} />
      ) : (
        <SmileOutlined className='kdy-avatar__fallback' />
      )}
    </View>
  )
}

export default KdyAvatar
