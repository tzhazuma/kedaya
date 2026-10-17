import { Text, View } from '@tarojs/components'

export function KdyHeading({
  title,
  subtitle,
  eyebrow = 'KEDAYA · CAMPUS LIFE',
}: {
  title: string
  subtitle: string
  eyebrow?: string
}) {
  return (
    <View className='kdy-page-heading'>
      <Text className='kdy-eyebrow'>{eyebrow}</Text>
      <Text className='kdy-page-title'>{title}</Text>
      <Text className='kdy-page-subtitle'>{subtitle}</Text>
    </View>
  )
}
