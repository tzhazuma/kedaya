import { Image, View } from '@tarojs/components'

import { KdyMascot } from '../KdyMascot'
import './index.scss'

/**
 * KdyAvatar —— 头像展示（没有头像时回退到吉祥物）。
 *
 * 只负责展示：**选择**头像必须由用户点击
 * `<KdyButton openType='chooseAvatar'>` 触发（微信的硬性要求，
 * 代码无法静默获取），所以选择逻辑留在页面里，避免这个组件背上平台耦合。
 *
 * 回退图案是可达鸭贴图而不是 `SmileOutlined` 图标：
 * 这个位置"没头像"的人比"有头像"的人多（新号都没头像），
 * 一张认得出的吉祥物比一个通用笑脸更像"这个产品的人"。
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
        <KdyMascot size={Math.max(28, Math.round(size * 0.84))} />
      )}
    </View>
  )
}

export default KdyAvatar
