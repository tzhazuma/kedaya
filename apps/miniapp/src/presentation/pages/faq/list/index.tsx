import { Text, View } from '@tarojs/components'
import Taro, { useDidShow, usePullDownRefresh, useReachBottom } from '@tarojs/taro'
import { useState } from 'react'

import { getContainer } from '../../../../app/container'
import { PAGE_PATHS, faqDetailPath } from '../../../../app/routes'
import { FAQ_CATEGORIES, FAQ_CATEGORY_LABELS } from '../../../../domain/models/faq'
import type { FaqCategory, FaqEntryFilters, FaqEntrySummary } from '../../../../domain/models/faq'
import { navigateTo } from '../../../../platform/navigation'
import { KdyButton, KdyCard, KdyChip, KdyEmpty, KdyField, KdyListSkeleton, KdyTag } from '../../../components'
import { KdyHeading } from '../../../components/KdyHeading'
import { useStore } from '../../../hooks'
import './index.scss'

/**
 * 常见问题列表页。
 *
 * 机制复用 `application/common/listUseCase`（契约 §8 启动时序）：
 * `useDidShow` → `hydrate()`（同步、秒出缓存）→ `load()`（后台刷新，失败静默降级）。
 * 页面只管两件事：把筛选条件喂给 `load()`，以及把 `status` 映射成
 * 骨架 / 空 / 错 / 列表四种画面。
 *
 * 筛选维度只有后端 `listQuerySchema` 支持的两个：
 *   · 分类 chip —— `filters.category`，精确匹配（取值来自领域白名单，页面不另写一份）；
 *   · 搜索框   —— `filters.keyword`，后端翻译成 `q`，对 question + answer 模糊匹配。
 */

/** 分类 chip 的取值：`null` 表示「全部」（不透传 category 参数） */
const ALL_CATEGORIES: readonly (FaqCategory | null)[] = [null, ...FAQ_CATEGORIES]

function FaqCard({ item }: { item: FaqEntrySummary }) {
  return (
    <KdyCard
      elevated={false}
      onClick={() => {
        void navigateTo(faqDetailPath(item.id))
      }}
    >
      <View className='kdy-faq-card'>
        <View className='kdy-faq-card__head'>
          <KdyTag tone='brand'>{item.categoryLabel}</KdyTag>
          {/*
            「有帮助」是热度计数、不是一人一票（后端是 `{ increment: 1 }`），
            所以这里写「有帮助 N」而不是「N 人觉得有用」—— 后者是在撒谎。
          */}
          <Text className='kdy-faq-card__helpful'>有帮助 {item.helpfulCount}</Text>
        </View>
        <Text className='kdy-faq-card__question'>{item.question}</Text>
        {item.answerPreview === '' ? null : (
          <Text className='kdy-faq-card__preview'>{item.answerPreview}</Text>
        )}
        <Text className='kdy-faq-card__time'>{item.createdLabel}</Text>
      </View>
    </KdyCard>
  )
}

export default function FaqListPage() {
  const container = getContainer()
  const faq = container.useCases.faq
  const state = useStore(faq.list)
  const [keyword, setKeyword] = useState('')

  // `state.query` 就是当前生效的筛选条件，用它回显 chip 的选中态
  const filters = state.query as FaqEntryFilters

  function refresh(patch: Partial<FaqEntryFilters> = {}): void {
    void faq.list.load({ ...patch })
  }

  useDidShow(() => {
    faq.list.hydrate()
    refresh()
  })

  /**
   * 下拉刷新：保留当前筛选、只回到第一页。
   * 和「重试」走同一条 `load()` 路径，因此不存在「下拉刷新和按钮行为不一致」；
   * 转圈要等请求真的结束再收，否则用户以为刷完了、其实还在跑。
   */
  usePullDownRefresh(() => {
    void faq.list.load().then(() => Taro.stopPullDownRefresh())
  })

  useReachBottom(() => {
    void faq.list.loadMore()
  })

  return (
    <View className='kdy-page kdy-faq'>
      <KdyHeading
        title='常见问题'
        subtitle='选课、宿舍、校园卡、校园网……同学们反复问到的，都在这里整理好了。'
        eyebrow='KEDAYA · 常见问题'
      />

      <View className='kdy-faq__toolbar'>
        <View className='kdy-faq__search'>
          <KdyField
            value={keyword}
            onChange={setKeyword}
            placeholder='搜索问题或答案关键词'
            maxLength={60}
          />
        </View>
        <KdyButton
          size='sm'
          onClick={() => {
            refresh({ keyword: keyword.trim() === '' ? undefined : keyword.trim() })
          }}
        >
          搜索
        </KdyButton>
      </View>

      <View className='kdy-faq__chips'>
        {ALL_CATEGORIES.map((category) => (
          <KdyChip
            key={category ?? 'all'}
            active={(filters.category ?? null) === category}
            onClick={() => {
              refresh({ category: category === null ? undefined : category })
            }}
          >
            {category === null ? '全部' : FAQ_CATEGORY_LABELS[category]}
          </KdyChip>
        ))}
      </View>

      {state.fromCache && state.status === 'ready' && (
        <Text className='kdy-faq__cache-hint'>正在后台刷新…</Text>
      )}

      {state.status === 'loading' && <KdyListSkeleton />}

      {state.status === 'empty' && (
        <KdyEmpty
          mode='empty'
          title='没有找到相关的问答'
          description='换个关键词或分类试试，也可以把你知道的答案补充进来。'
          actionText='去补充一条'
          onAction={() => {
            void navigateTo(PAGE_PATHS.faqCreate)
          }}
        />
      )}

      {state.status === 'error' && (
        <KdyEmpty
          mode='error'
          title='没能拿到常见问题'
          description={state.error ?? '请稍后重试'}
          actionText='重试'
          onAction={() => refresh()}
        />
      )}

      {state.items.map((item) => (
        <FaqCard key={item.id} item={item} />
      ))}

      {state.nextCursor !== null && state.status === 'ready' && (
        <View className='kdy-faq__more'>
          <KdyButton
            size='sm'
            variant='ghost'
            loading={state.loadingMore}
            onClick={() => {
              void faq.list.loadMore()
            }}
          >
            加载更多
          </KdyButton>
        </View>
      )}

      {state.error !== null && state.status === 'ready' && (
        <Text className='kdy-faq__inline-error'>{state.error}</Text>
      )}

      <View className='kdy-faq__fab'>
        <KdyButton
          onClick={() => {
            void navigateTo(PAGE_PATHS.faqCreate)
          }}
        >
          补充问答
        </KdyButton>
      </View>

      {/*
        Mock 数据必须显式标注：这里的内存问答重启后重置，
        用户新建的条目也不会留在「服务端」—— 不标出来就是误导。
      */}
      {container.env.useMock && (
        <Text className='kdy-faq__demo'>
          当前为本地演示模式：问答来自内存 Mock，你补充的条目在重开小程序后不会保留。
        </Text>
      )}

      <Text className='kdy-disclaimer'>
        可达鸭是第三方非官方校园服务平台，与上海科技大学官方系统无关。问答由同学共建整理，涉及教务、财务等以学校官方通知为准。
      </Text>
    </View>
  )
}
