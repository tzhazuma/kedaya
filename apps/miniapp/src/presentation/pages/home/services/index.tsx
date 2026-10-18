import { Text, View } from '@tarojs/components'
import { ArrowRight } from '@taroify/icons'
import { useDidShow } from '@tarojs/taro'
import { useState } from 'react'

import { getContainer } from '../../../../app/container'
import { homeEntryPath, profileHomePath } from '../../../../app/routes'
import { HOME_SECTIONS, homeEntryById, searchHomeEntryIds } from '../../../../domain/models/homeEntries'
import type { HomeEntry } from '../../../../domain/models/homeEntries'
import { navigateTo, toast } from '../../../../platform/navigation'
import { KdyCard, KdyEmpty, KdySearchBar } from '../../../components'
import type { KdyCardTone } from '../../../components/KdyCard'
import { KdyHeading } from '../../../components/KdyHeading'
import { KdyModuleIcon } from '../../../components/KdyModuleIcon'
import './index.scss'

/**
 * 服务大厅 —— 「全部服务」的家。
 *
 * 20 个模块全铺在首页就等于没有首页，所以首页只留用户挑的几个，
 * 其余都收在这里：按使用场景分组 + 搜索。分组是这里唯一"新增"的结构 ——
 * 契约只声明了 `business` / `core`，对用户没意义（谁会按"业务模块"找食堂？）。
 *
 * 没上线的入口（当前只有「场馆预约」）照实列在「尚未上线」一组里，
 * 点开给一句说明。藏起来会让用户以为没这个需求。
 */

/**
 * 分组卡面档位：分组卡是这一页的"一眼看去是什么"的功能卡，
 * 所以给一整块淡色面。三档色相（粉/黄/奶白）对应分组语义，
 * 不是装饰 —— 淡绿留给"校园自然"，这里没有自然类分组。
 */
const SECTION_TONES: Readonly<Record<string, KdyCardTone>> = {
  daily: 'milk',
  community: 'pink',
  care: 'yellow',
  account: 'milk',
}

export default function HomeServicesPage() {
  const container = getContainer()
  const layout = container.useCases.homeLayout
  const [keyword, setKeyword] = useState('')

  useDidShow(() => {
    layout.hydrate()
  })

  const matched = searchHomeEntryIds(keyword)
  const searching = keyword.trim() !== ''

  function toEntries(ids: readonly string[]): HomeEntry[] {
    return ids
      .map((id) => homeEntryById(id))
      .filter((entry): entry is HomeEntry => entry !== undefined)
  }

  function openEntry(entry: HomeEntry): void {
    const path = homeEntryPath(entry.id)
    if (path !== null) {
      void navigateTo(path)
      return
    }
    toast(`${entry.label}还在开发中`)
  }

  function renderGrid(entries: readonly HomeEntry[]) {
    return (
      <View className='kdy-hall__grid'>
        {entries.map((entry) => (
          <View key={entry.id} className='kdy-hall__grid-item' onClick={() => openEntry(entry)}>
            <KdyModuleIcon id={entry.icon} />
            <Text className='kdy-hall__grid-name'>{entry.label}</Text>
          </View>
        ))}
      </View>
    )
  }

  return (
    <View className='kdy-page kdy-hall'>
      <KdyHeading title='服务大厅' />

      <View className='kdy-hall__search'>
        <KdySearchBar
          value={keyword}
          placeholder='搜索服务'
          onChange={setKeyword}
          onClear={() => setKeyword('')}
        />
      </View>

      {searching && (
        <KdyCard
          title={`搜索「${keyword}」`}
          extra={`${matched.length} 个`}
          elevated={false}
        >
          {matched.length === 0 ? (
            <KdyEmpty
              mode='empty'
              description='没有匹配的服务，换个说法试试。'
              actionText='清空搜索'
              onAction={() => setKeyword('')}
            />
          ) : (
            renderGrid(toEntries(matched))
          )}
        </KdyCard>
      )}

      {!searching &&
        HOME_SECTIONS.map((section) => (
          <KdyCard
            key={section.id}
            title={section.title}
            tone={SECTION_TONES[section.id] ?? 'plain'}
            elevated={false}
          >
            {renderGrid(toEntries(section.entryIds))}
          </KdyCard>
        ))}

      <View className='kdy-hall__manage' onClick={() => void navigateTo(profileHomePath())}>
        <View className='kdy-hall__manage-body'>
          <Text className='kdy-hall__manage-title'>首页管理</Text>
          <Text className='kdy-hall__manage-sub'>选择首页显示哪些服务</Text>
        </View>
        <ArrowRight />
      </View>

      <Text className='kdy-disclaimer'>
        第三方非官方平台 · 与上海科技大学官方系统无关。
      </Text>
    </View>
  )
}
