import { Image, View } from '@tarojs/components'
import './index.scss'
export function KdyFeatureArtwork({ kind }: { kind: 'together' | 'wildlife' }) {
  return <View className={`kdy-feature-art kdy-feature-art--${kind}`} aria-hidden='true'><Image className='kdy-feature-art__image' src={`/assets/campus/${kind === 'together' ? 'bag' : 'paw'}.png`} mode='aspectFit' /></View>
}
