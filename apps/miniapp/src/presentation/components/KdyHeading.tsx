import { Text, View } from '@tarojs/components'

/**
 * KdyHeading —— 页面标题。
 *
 * 只有标题，外加一行**可选**的说明。这里刻意没有「eyebrow / 小标签」：
 * 每一页顶上再挂一个「KEDAYA · xx」既占高度、又像开发者留下的占位符，
 * 用户从它身上拿不到任何信息 —— 标题自己已经说清这是哪一页了。
 *
 * `subtitle` 也做成可选：只有当一句话能帮用户做决定时才写，
 * 不为了"每页都有一行小字"而凑字数。
 */
export function KdyHeading({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <View className='kdy-page-heading'>
      <Text className='kdy-page-title'>{title}</Text>
      {subtitle !== undefined && subtitle !== '' && (
        <Text className='kdy-page-subtitle'>{subtitle}</Text>
      )}
    </View>
  )
}
