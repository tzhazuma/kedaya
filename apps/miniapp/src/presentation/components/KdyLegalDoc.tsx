import { Text, View } from '@tarojs/components'
import type { ReactNode } from 'react'

import './KdyLegalDoc.scss'

/**
 * KdyLegalDoc —— 法务长文排版（用户协议 / 隐私政策共用）。
 *
 * 为什么单独做组件：两份文档的结构完全一样（标题 → 版本日期 → 分节 → 声明），
 * 复制两遍最容易出现"改了一份忘了另一份"。内容本身在
 * `presentation/content/legal.ts`，这里只负责排版。
 *
 * 注意：小程序 `<Text>` 对 `\n` 的支持不稳定（不同基础库表现不同），
 * 因此段落**逐条渲染**，不把整篇塞进一个 `<Text>`。
 */
export interface KdyLegalSection {
  title: string
  paragraphs: readonly string[]
}

export interface KdyLegalDocProps {
  title: string
  subtitle: string
  updatedAt: string
  sections: readonly KdyLegalSection[]
  /** 文末附加内容（例如"回到隐私设置"的入口） */
  footer?: ReactNode
}

export function KdyLegalDoc({ title, subtitle, updatedAt, sections, footer }: KdyLegalDocProps) {
  return (
    <View className='kdy-page kdy-legal'>
      <View className='kdy-legal__head'>
        <Text className='kdy-legal__title'>{title}</Text>
        <Text className='kdy-legal__subtitle'>{subtitle}</Text>
        <Text className='kdy-legal__updated'>版本日期：{updatedAt}</Text>
      </View>

      {sections.map((section) => (
        <View key={section.title} className='kdy-legal__section'>
          <Text className='kdy-legal__section-title'>{section.title}</Text>
          {section.paragraphs.map((paragraph, index) => (
            <Text key={`${section.title}-${index}`} className='kdy-legal__paragraph'>
              {paragraph}
            </Text>
          ))}
        </View>
      ))}

      {footer}

      <Text className='kdy-disclaimer'>
        可达鸭是第三方非官方校园服务平台，与上海科技大学官方系统无关。
      </Text>
    </View>
  )
}
