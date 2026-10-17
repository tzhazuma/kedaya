import { Text, View } from '@tarojs/components'
import Taro, { useDidShow, usePullDownRefresh, useReachBottom } from '@tarojs/taro'
import { useState } from 'react'

import { getContainer } from '../../../../app/container'
import { PAGE_PATHS, techpieDetailPath } from '../../../../app/routes'
import {
  TECHPIE_CATEGORIES,
  TECHPIE_DISCLAIMER,
  TECHPIE_KEYWORD_MAX,
  TECHPIE_NOTICE,
  categoryLabel,
} from '../../../../domain/models/techpie'
import type { TechpieLinkSummary } from '../../../../domain/models/techpie'
import { navigateTo } from '../../../../platform/navigation'
import {
  KdyButton,
  KdyCard,
  KdyChip,
  KdyEmpty,
  KdyField,
  KdyListSkeleton,
  KdyTag,
} from '../../../components'
import { KdyHeading } from '../../../components/KdyHeading'
import { useStore } from '../../../hooks'
import './index.scss'

/**
 * 校园技术服务目录（`techpie`）列表页。
 *
 * 契约 §8 启动时序在这里落地：`useDidShow` → `hydrate()`（同步、秒出缓存）
 * → `load()`（后台刷新，失败静默降级）。
 *
 * 筛选维度与后端一一对应：分类（`category` 精确）+ 关键词（`q` 模糊，
 * 命中名称与地址），由 `techpie.controller.ts` 的 `listQuerySchema` 白名单校验，
 * 排序固定**最新在前**。分类 chip 直接取自 `TECHPIE_CATEGORIES`（单一真相）。
 *
 * 页面顶部那一行 `TECHPIE_NOTICE` 是**硬要求**：这份目录是同学共建的，
 * 状态是人工核对结果，不是我们探测出来的，更不能被理解成学校官方信息。
 * 做成一行说明而不是醒目横幅 —— 它是常驻事实，不是告警。
 */

function TechpieCard({ link }: { link: TechpieLinkSummary }) {
  return (
    <KdyCard
      elevated={false}
      onClick={() => {
        void navigateTo(techpieDetailPath(link.id))
      }}
    >
      <View className='kdy-techpie-card'>
        <View className='kdy-techpie-card__head'>
          <Text className='kdy-techpie-card__name'>{link.name}</Text>
          <KdyTag tone={link.statusTone}>{link.statusLabel}</KdyTag>
        </View>
        <Text className='kdy-techpie-card__host'>{link.urlHost}</Text>
        <View className='kdy-techpie-card__foot'>
          <Text className='kdy-techpie-card__category'>{link.categoryLabel}</Text>
          <Text className='kdy-techpie-card__time'>最后核对 {link.lastCheckedLabel}</Text>
        </View>
      </View>
    </KdyCard>
  )
}

export default function TechpieListPage() {
  const container = getContainer()
  const techpie = container.useCases.techpie
  const state = useStore(techpie.list)
  const [keyword, setKeyword] = useState('')

  const filters = state.query as { category?: string; q?: string }

  function refresh(patch: Parameters<typeof techpie.list.load>[0] = {}): void {
    void techpie.list.load({ cursor: null, ...patch })
  }

  useDidShow(() => {
    techpie.list.hydrate()
    refresh()
  })

  /**
   * 下拉刷新：保留当前筛选条件，只把游标重置回第一页。
   * 转圈必须等请求真的结束再收 —— 早收会让用户以为刷完了，其实还没到。
   */
  usePullDownRefresh(() => {
    void techpie.list.load({ cursor: null }).then(() => Taro.stopPullDownRefresh())
  })

  useReachBottom(() => {
    void techpie.list.loadMore()
  })

  return (
    <View className='kdy-page kdy-techpie'>
      <KdyHeading
        title='校园技术服务'
        subtitle='同学们一起整理的校园系统与服务地址，复制到浏览器里打开。'
        eyebrow='KEDAYA · 技术服务目录'
      />

      <Text className='kdy-techpie__notice'>{TECHPIE_NOTICE}</Text>

      <View className='kdy-techpie__toolbar'>
        <View className='kdy-techpie__search'>
          <KdyField
            value={keyword}
            onChange={setKeyword}
            placeholder='搜索服务名称或网址'
            maxLength={TECHPIE_KEYWORD_MAX}
          />
        </View>
        <KdyButton
          size='sm'
          onClick={() => {
            refresh({ q: keyword.trim() === '' ? undefined : keyword.trim() })
          }}
        >
          搜索
        </KdyButton>
      </View>

      <View className='kdy-techpie__chips'>
        <KdyChip active={filters.category === undefined} onClick={() => refresh({ category: undefined })}>
          全部分类
        </KdyChip>
        {TECHPIE_CATEGORIES.map((category) => (
          <KdyChip
            key={category}
            active={filters.category === category}
            onClick={() => refresh({ category })}
          >
            {categoryLabel(category)}
          </KdyChip>
        ))}
      </View>

      {state.fromCache && state.status === 'ready' && (
        <Text className='kdy-techpie__cache-hint'>正在后台刷新…</Text>
      )}

      {state.status === 'loading' && <KdyListSkeleton />}

      {state.status === 'empty' && (
        <KdyEmpty
          mode='empty'
          title='还没有符合条件的服务'
          description='换个分类或关键词，或者把你常用的校园系统地址补充进来。'
          actionText='补充服务'
          onAction={() => {
            void navigateTo(PAGE_PATHS.techpieCreate)
          }}
        />
      )}

      {state.status === 'error' && (
        <KdyEmpty
          mode='error'
          title='没能拿到服务目录'
          description={state.error ?? '请稍后重试'}
          actionText='重试'
          onAction={() => refresh()}
        />
      )}

      {state.items.map((link) => (
        <TechpieCard key={link.id} link={link} />
      ))}

      {state.nextCursor !== null && state.status === 'ready' && (
        <View className='kdy-techpie__more'>
          <KdyButton
            size='sm'
            variant='ghost'
            loading={state.loadingMore}
            onClick={() => {
              void techpie.list.loadMore()
            }}
          >
            加载更多
          </KdyButton>
        </View>
      )}

      {state.error !== null && state.status === 'ready' && (
        <Text className='kdy-techpie__inline-error'>{state.error}</Text>
      )}

      <View className='kdy-techpie__fab'>
        <KdyButton
          onClick={() => {
            void navigateTo(PAGE_PATHS.techpieCreate)
          }}
        >
          补充服务
        </KdyButton>
      </View>

      <Text className='kdy-disclaimer'>{TECHPIE_DISCLAIMER}</Text>
    </View>
  )
}
