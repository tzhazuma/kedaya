import { Image, Text, View } from '@tarojs/components'
import './index.scss'
export function CampusArrow({ back = false }: { back?: boolean }) {
  return <Image className={`campus-arrow${back ? ' campus-arrow--back' : ''}`} src='/assets/campus/arrow.svg' mode='aspectFit' aria-hidden='true' />
}
export function CampusBrand() {
  return <View className='campus-brand'><Text className='campus-brand__mark'>鸭</Text><Text>可达鸭</Text></View>
}
export function CampusThemeToggle({ mode, onClick }: { mode: 'light' | 'dark'; onClick: () => void }) {
  return <View className='campus-theme kdy-welcome__theme-toggle' aria-label={`切换为${mode === 'dark' ? '浅色' : '深色'}模式`} onClick={onClick}><Image className='campus-theme__icon' src={`/assets/campus/${mode === 'dark' ? 'moon' : 'sun'}.svg`} /></View>
}
