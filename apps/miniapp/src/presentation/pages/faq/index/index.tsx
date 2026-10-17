import { Text, View } from '@tarojs/components'
import Taro, { useDidShow, usePullDownRefresh, useReachBottom } from '@tarojs/taro'
import { useState } from 'react'

import { getContainer } from '../../../../app/container'
import { PAGE_PATHS } from '../../../../app/routes'
import { FAQ_CATEGORY_ALL } from '../../../../domain/models/faq'
import { navigateTo, toast } from '../../../../platform/navigation'
import { KdyAccordion, KdyButton, KdyCard, KdyChip, KdyEmpty, KdySearchBar, KdyTag } from '../../../components'
import { useStore } from '../../../hooks'
import './index.scss'

/**
 * FAQ 页 —— 分类 + 搜索 + 手风琴列表 + 「有用」按钮。
 *
 * 「有用」按钮是**幂等**的：重复点击只算一次。
 * 幂等有两道保险（见 `application/faq/browseFaq.ts`）：
 * 1. 本地已投票记录命中 → 直接返回 `applied: false`，连请求都不发；
 * 2. 服务端按 `userId + articleId` 去重，真后端另有 `Idempotency-Key` 兜底。
 *
 * 小程序特性：`onPullDownRefresh` 刷新、`onReachBottom` 触底加载下一页。
 * 契约 §8：`useDidShow` 里先 `hydrate()` 再 `load()`。
 */

export default function FaqPage() {
  const container = getContainer()
  const faq = container.useCases.browseFaq
  const state = useStore(faq)

  const [keywordInput, setKeywordInput] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [voting, setVoting] = useState(false)

  function reload(query: { category?: string; keyword?: string } = {}): Promise<void> {
    return faq.load(query).then(() => undefined)
  }

  useDidShow(() => {
    faq.hydrate()
    void reload()
  })

  usePullDownRefresh(() => {
    void reload({ keyword: keywordInput }).then(() => Taro.stopPullDownRefresh())
  })

  useReachBottom(() => {
    void faq.loadMore()
  })

  function handleSelectCategory(category: string): void {
    faq.selectCategory(category)
    void reload({ category, keyword: keywordInput })
  }

  async function handleVote(articleId: string): Promise<void> {
    setVoting(true)
    try {
      const result = await faq.voteHelpful(articleId)
      if (!result.ok) {
        toast(result.error.message)
        return
      }
      toast(result.value.applied ? '感谢反馈' : '你已经点过「有用」了', result.value.applied ? 'success' : 'none')
    } finally {
      setVoting(false)
    }
  }

  function handleSimulateError(): void {
    const mock = container.mockFaqControls
    if (mock === null) {
      toast('当前是真实后端模式，无法模拟错误')
      return
    }
    mock.failNextRequests(1)
    void reload()
  }

  function handleSimulateEmpty(): void {
    const mock = container.mockFaqControls
    if (mock === null) {
      toast('当前是真实后端模式，无法清空数据')
      return
    }
    mock.clearAll()
    void reload()
  }

  function handleResetDemo(): void {
    container.mockFaqControls?.reset()
    void reload()
  }

  const categories = [FAQ_CATEGORY_ALL, ...state.categories]

  return (
    <View className='kdy-page kdy-faq'>
      <KdySearchBar
        value={keywordInput}
        placeholder='搜索问题关键词，例如「登录」「校园卡」'
        onChange={setKeywordInput}
        onConfirm={(value) => {
          void reload({ keyword: value })
        }}
        onClear={() => {
          setKeywordInput('')
          void reload({ keyword: '' })
        }}
      />

      <View className='kdy-faq__categories'>
        {categories.map((category) => (
          <View key={category} className='kdy-faq__category'>
            <KdyChip
              active={state.activeCategory === category}
              onClick={() => handleSelectCategory(category)}
            >
              {category === FAQ_CATEGORY_ALL ? '全部' : category}
            </KdyChip>
          </View>
        ))}
      </View>

      <View className='kdy-faq__actions'>
        <KdyButton
          size='sm'
          onClick={() => {
            void navigateTo(PAGE_PATHS.faqTickets)
          }}
        >
          我的工单
        </KdyButton>
        <KdyButton size='sm' variant='ghost' onClick={handleSimulateError}>
          模拟错误态
        </KdyButton>
        <KdyButton size='sm' variant='ghost' onClick={handleSimulateEmpty}>
          模拟空态
        </KdyButton>
        <KdyButton size='sm' variant='ghost' onClick={handleResetDemo}>
          重置演示数据
        </KdyButton>
      </View>

      {state.status === 'loading' && <KdyEmpty mode='loading' description='正在加载常见问题' />}

      {state.status === 'error' && (
        <KdyEmpty
          mode='error'
          description={state.error ?? '未知错误'}
          actionText='重试'
          onAction={() => {
            void reload()
          }}
        />
      )}

      {state.status === 'empty' && (
        <KdyEmpty
          mode='empty'
          description={
            keywordInput === ''
              ? '这个分类下还没有内容，去提个工单吧'
              : `没有找到与「${keywordInput}」相关的问题，去提个工单吧`
          }
          actionText='提工单'
          onAction={() => {
            void navigateTo(PAGE_PATHS.faqTickets)
          }}
        />
      )}

      {state.status === 'ready' && (
        <View>
          <KdyCard elevated={false}>
            {state.articles.map((article) => (
              <KdyAccordion
                key={article.id}
                title={article.question}
                expanded={expandedId === article.id}
                onToggle={() => setExpandedId(expandedId === article.id ? null : article.id)}
                meta={<KdyTag tone='neutral'>{article.category}</KdyTag>}
              >
                <Text className='kdy-faq__answer'>{article.excerpt}</Text>

                <View className='kdy-faq__vote'>
                  <KdyButton
                    size='sm'
                    variant={article.voted ? 'secondary' : 'ghost'}
                    loading={voting}
                    onClick={() => {
                      void handleVote(article.id)
                    }}
                  >
                    {article.voted ? '已标记有用' : '有用'}（{article.helpfulCount}）
                  </KdyButton>
                  {article.voted && <Text className='kdy-faq__voted'>同一账号只计一次</Text>}
                </View>
              </KdyAccordion>
            ))}
          </KdyCard>

          {state.loadingMore && <Text className='kdy-faq__more'>正在加载更多…</Text>}
          {!state.loadingMore && state.nextCursor === null && state.articles.length > 0 && (
            <Text className='kdy-faq__more'>没有更多了</Text>
          )}
        </View>
      )}

      {state.error !== null && state.status === 'ready' && (
        <Text className='kdy-faq__soft-error'>
          刷新失败：{state.error}
        </Text>
      )}

      <Text className='kdy-disclaimer'>
        第三方非官方平台 · 与上海科技大学官方系统无关。
      </Text>
    </View>
  )
}
