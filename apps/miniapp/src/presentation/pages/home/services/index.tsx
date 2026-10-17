import { Text, View } from '@tarojs/components'
import { useDidShow } from '@tarojs/taro'
import { useState } from 'react'

import { getContainer } from '../../../../app/container'
import { homeEntryPath, profileHomePath } from '../../../../app/routes'
import {
  HOME_SECTIONS,
  homeEntryById,
  searchHomeEntryIds,
} from '../../../../domain/models/homeEntries'
import type { HomeEntry } from '../../../../domain/models/homeEntries'
import { toast, navigateTo } from '../../../../platform/navigation'
import { KdyButton, KdyCard, KdyEmpty, KdySearchBar, KdyTag } from '../../../components'
import { KdyHeading } from '../../../components/KdyHeading'
import { KdyModuleIcon } from '../../../components/KdyModuleIcon'
import { useStore } from '../../../hooks'
import { homeEntryState } from '../entryState'
import './index.scss'

/**
 * 服务大厅 —— 「全部服务」的家。
 *
 * 为什么要有这一页：模块长到 20 个之后，把它们全铺在首页就等于没有首页 ——
 * 用户每次都要在一屏目录里**找**。于是分工变成：
 *
 *   · 首页 = 用户挑好的常用（最多 12 个，见 `domain/models/homeEntries`）；
 *   · 服务大厅 = 全部，按**使用场景**分组 + 搜索。
 *
 * 分组是这里唯一"新增"的结构：契约只声明了 `business` / `core` 两类，
 * 那对用户没有意义（谁会按"业务模块 / 基础模块"找食堂？）。
 *
 * 未上线的入口（当前只有「场馆预约」）也**照实列出来**并标「开发中」：
 * 藏起来会让用户以为没有这个需求，点开才说明白更好。
 */

export default function HomeServicesPage() {
  const container = getContainer()
  const layout = container.useCases.homeLayout
  useStore(layout)
  const [keyword, setKeyword] = useState('')

  // 同步读一次本机布局：这里只用它显示「首页当前有几个服务」，
  // 真正的读盘由首页触发；直接用 getSnapshot 读渲染期状态，避免在 render 里写 state。
  useDidShow(() => {
    layout.hydrate()
  })

  const selectedCount = layout.getSnapshot().ids.length
  const matched = searchHomeEntryIds(keyword)
  const searching = keyword.trim() !== ''

  function openEntry(entry: HomeEntry): void {
    const path = homeEntryPath(entry.id)
    if (path !== null) {
      void navigateTo(path)
      return
    }
    toast(`${entry.label}：契约已登记，页面尚未实现`)
  }

  function renderGrid(entries: readonly HomeEntry[]) {
    return (
      <View className='kdy-hall__grid'>
        {entries.map((entry) => {
          const state = homeEntryState(entry)
          return (
            <View key={entry.id} className='kdy-hall__grid-item' onClick={() => openEntry(entry)}>
              <KdyModuleIcon id={entry.icon} />
              <Text className='kdy-hall__grid-name'>{entry.label}</Text>
              {state.label !== null && (
                <Text className={`kdy-hall__state kdy-hall__state--${state.tone}`}>{state.label}</Text>
              )}
            </View>
          )
        })}
      </View>
    )
  }

  return (
    <View className='kdy-page kdy-hall'>
      <KdyHeading
        title='服务大厅'
        subtitle='全部校园服务都在这里；常用的那几个放到首页。'
        eyebrow='KEDAYA · 全部服务'
      />

      <View className='kdy-hall__search'>
        <KdySearchBar
          value={keyword}
          placeholder='搜索服务（例如：拼单、失物、心理）'
          onChange={setKeyword}
          onClear={() => setKeyword('')}
        />
      </View>

      <KdyCard
        title='首页显示哪几个？'
        extra={
          <KdyButton size='sm' variant='ghost' onClick={() => void navigateTo(profileHomePath())}>
            首页管理
          </KdyButton>
        }
        elevated={false}
      >
        <Text className='kdy-hall__hint'>
          首页只放你挑的服务（当前 {selectedCount} / 12）。这里点开就能用，
          想把它搬到首页就去「首页管理」加一格。
        </Text>
      </KdyCard>

      {searching && (
        <KdyCard title={`搜索结果 · ${matched.length} 个`} elevated={false}>
          {matched.length === 0 ? (
            <KdyEmpty
              mode='empty'
              description={`没有匹配「${keyword}」的服务。换个说法试试，或清空搜索看全部。`}
              actionText='清空搜索'
              onAction={() => setKeyword('')}
            />
          ) : (
            renderGrid(
              matched
                .map((id) => homeEntryById(id))
                .filter((entry): entry is HomeEntry => entry !== undefined),
            )
          )}
        </KdyCard>
      )}

      {!searching &&
        HOME_SECTIONS.map((section) => (
          <KdyCard key={section.id} title={section.title} elevated={false}>
            <Text className='kdy-hall__section-hint'>{section.hint}</Text>
            {renderGrid(
              section.entryIds
                .map((id) => homeEntryById(id))
                .filter((entry): entry is HomeEntry => entry !== undefined),
            )}
          </KdyCard>
        ))}

      <KdyCard title='还没做的部分' elevated={false}>
        <Text className='kdy-hall__hint'>
          标着「开发中」的服务，契约里已经登记、但页面还没做完，点开会如实告诉你，
          不会给你一个白屏。标着「需二次同意」的模块进去前会先问一次，
          你可以随时在「我的 → 隐私与数据」撤回。
        </Text>
        <View className='kdy-hall__tags'>
          <KdyTag tone='neutral'>开发中 = 还没做</KdyTag>
          <KdyTag tone='danger'>需二次同意</KdyTag>
          <KdyTag tone='warning'>高敏感</KdyTag>
        </View>
      </KdyCard>

      <Text className='kdy-disclaimer'>
        可达鸭是第三方非官方校园服务平台，与上海科技大学官方系统无关。
      </Text>
    </View>
  )
}
