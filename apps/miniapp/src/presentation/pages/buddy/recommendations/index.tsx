import { Text, View } from '@tarojs/components'
import { useDidShow } from '@tarojs/taro'
import { useState } from 'react'

import { getContainer } from '../../../../app/container'
import { buddyDetailPath, buddyProfilePath } from '../../../../app/routes'
import { BUDDY_SECTIONS, BUDDY_SECTION_LABELS } from '../../../../domain/models/buddy'
import type { BuddySection } from '../../../../domain/models/buddy'
import { navigateTo, toast } from '../../../../platform/navigation'
import { KdyBuddyPrivacyNotice, KdyButton, KdyCard, KdyEmpty, KdyTag } from '../../../components'
import { useStore } from '../../../hooks'
import './index.scss'

/**
 * 推荐页（规格 §3 / §5.7 / G3）—— **可解释性是本模块的硬要求**。
 *
 * 每条推荐都展示 `@kedaya/shared` 的 `explainMatch()` 给出的**结构化理由**
 * （「同一个院系」/「共同兴趣 3 项」/「时间能碰上」…），而**不是**只给一个分数。
 * 用同一套纯函数是刻意的：服务端排序与客户端理由必须来自同一份算法，
 * 否则用户会看到与服务端排序不一致的解释 —— 那比不给理由更糟。
 *
 * 诚实性要求：
 * - `matchMode` **原样展示**（规格 §5.7）：`rule` 模式下不会出现「智能推荐」这种话；
 * - 每条理由标注**来源**：`server`（服务端下发的结构化理由）或
 *   `client`（客户端用公开的帖子数据 + 我自己的资料算出来的那部分）。
 *   客户端**永远**不会凭空说出「同一个院系」—— 发起人的院系不对客户端公开
 *   （规格 §6.1），那句话只能来自服务端。
 *
 * 反馈：`like` / `dislike` / `skip`（`POST /buddy/items/:id/feedback`，契约 §11.2 的
 * `feedback` 动作）。反馈会改变排序（规格 §3.6），提交后立刻重拉。
 */

const MATCH_MODE_LABELS: Record<string, string> = {
  vector: '语义匹配',
  hash: '降级匹配（哈希向量，非语义）',
  rule: '规则匹配（无向量，按标签与时间）',
}

export default function BuddyRecommendationsPage() {
  const container = getContainer()
  const recommendations = container.useCases.buddyRecommendations
  const state = useStore(recommendations)
  const [section, setSection] = useState<BuddySection>('sport')

  useDidShow(() => {
    // 契约 §8 第 1 步（同步 hydrate）+ 第 3 步
    recommendations.hydrate(section)
    void recommendations.load(section)
  })

  function handleSelectSection(next: BuddySection): void {
    if (next === section) return
    setSection(next)
    recommendations.hydrate(next)
    void recommendations.load(next)
  }

  async function handleFeedback(postId: string, action: 'like' | 'dislike' | 'skip'): Promise<void> {
    const result = await recommendations.feedback(postId, action)
    if (result.feedbackError !== null) {
      toast(result.feedbackError, 'error')
      return
    }
    toast('已记录反馈，排序已更新')
  }

  return (
    <View className='kdy-page kdy-buddy-reco'>
      <View className='kdy-buddy-reco__tabs'>
        {BUDDY_SECTIONS.map((item) => (
          <View
            key={item}
            className={`kdy-buddy-reco__tab${
              item === section ? ' kdy-buddy-reco__tab--active' : ''
            }`}
            onClick={() => handleSelectSection(item)}
          >
            <Text className='kdy-buddy-reco__tab-text'>{BUDDY_SECTION_LABELS[item]}</Text>
          </View>
        ))}
      </View>

      {/* 匹配模式如实展示（规格 §5.7 硬要求） */}
      <View className='kdy-buddy-reco__mode'>
        <KdyTag tone={state.matchMode === 'rule' ? 'neutral' : 'info'}>
          {MATCH_MODE_LABELS[state.matchMode] ?? state.matchMode}
        </KdyTag>
        <Text className='kdy-buddy-reco__mode-note'>
          {state.matchEnabled
            ? '理由由 explainMatch() 生成，与服务端排序同源'
            : '你还没有开启匹配资料 —— 当前按活动时间排序'}
        </Text>
      </View>

      {!state.matchEnabled && (
        <View className='kdy-buddy-reco__cta'>
          <KdyButton size='sm' variant='secondary' onClick={() => void navigateTo(buddyProfilePath())}>
            去填写匹配资料
          </KdyButton>
        </View>
      )}

      {state.status === 'loading' && <KdyEmpty mode='loading' description='正在计算推荐' />}

      {state.status === 'error' && (
        <KdyEmpty
          mode='error'
          description={state.error ?? '推荐加载失败'}
          actionText='重试'
          onAction={() => void recommendations.load(section)}
        />
      )}

      {state.status === 'empty' && (
        <KdyEmpty
          mode='empty'
          description='这个板块暂时没有能推荐给你的活动（时间碰不上或都已满员）'
        />
      )}

      {state.status === 'ready' && (
        <View>
          {state.items.map((item) => (
            <KdyCard
              key={item.postId}
              elevated={false}
              onClick={() => void navigateTo(buddyDetailPath(item.postId))}
            >
              <View className='kdy-buddy-reco__card'>
                <View className='kdy-buddy-reco__head'>
                  <Text className='kdy-buddy-reco__title'>{item.post.title}</Text>
                  <Text className='kdy-buddy-reco__score'>{item.score.toFixed(3)}</Text>
                </View>

                {/* ⭐ 可解释性：结构化理由（不是只有一个分数） */}
                <View className='kdy-buddy-reco__reasons'>
                  {item.reasons.length === 0 ? (
                    <KdyTag tone='neutral'>{item.reason}</KdyTag>
                  ) : (
                    item.reasons.map((reason) => (
                      <KdyTag key={reason.code} tone='brand'>
                        {reason.label}
                      </KdyTag>
                    ))
                  )}
                </View>

                <Text className='kdy-buddy-reco__reason-line'>
                  {item.serverReason === null
                    ? `推荐理由：${item.reason}`
                    : `服务端排序理由：${item.serverReason}`}
                </Text>

                {/*
                  ⚠️ 诚实性：标题（服务端原文，排序依据）与标签（`explainMatch` 产出）
                  是两个不同的东西。服务端的字符串是用双方完整资料算的，
                  客户端拿不到（规格 §6.1），因此标签只能覆盖公开信息那部分。
                  这里显式说明，避免用户把「公开共同点」误当成完整排序依据。
                */}
                {item.reasonSource === 'client' && item.reasons.length > 0 && (
                  <Text className='kdy-buddy-reco__reason-note'>
                    上面的标签由客户端用 explainMatch() 按公开信息（活动标签 / 地点 / 时间）
                    与你自己的资料算出；服务端排序还会用到它独有的信息，因此两者不必完全相同。
                  </Text>
                )}

                {item.reasonSource === 'server' && (
                  <Text className='kdy-buddy-reco__reason-note'>
                    理由由服务端下发的结构化条目构成，与排序同源。
                  </Text>
                )}

                <View className='kdy-buddy-reco__meta'>
                  <Text className='kdy-buddy-reco__meta-text'>{item.post.startsAtLabel}</Text>
                  <Text className='kdy-buddy-reco__meta-text'>{item.post.location}</Text>
                  <Text className='kdy-buddy-reco__meta-text'>
                    {item.post.joinedCount}/{item.post.capacity} 人
                  </Text>
                </View>

                <View className='kdy-buddy-reco__actions'>
                  <KdyButton
                    size='sm'
                    variant={item.myFeedback === 'like' ? 'primary' : 'ghost'}
                    loading={state.feedbackPending === item.postId}
                    onClick={() => void handleFeedback(item.postId, 'like')}
                  >
                    感兴趣
                  </KdyButton>
                  <KdyButton
                    size='sm'
                    variant={item.myFeedback === 'dislike' ? 'danger' : 'ghost'}
                    loading={state.feedbackPending === item.postId}
                    onClick={() => void handleFeedback(item.postId, 'dislike')}
                  >
                    不感兴趣
                  </KdyButton>
                  <KdyButton
                    size='sm'
                    variant={item.myFeedback === 'skip' ? 'secondary' : 'ghost'}
                    loading={state.feedbackPending === item.postId}
                    onClick={() => void handleFeedback(item.postId, 'skip')}
                  >
                    跳过
                  </KdyButton>
                </View>
              </View>
            </KdyCard>
          ))}
        </View>
      )}

      {state.feedbackError !== null && (
        <Text className='kdy-buddy-reco__error'>{state.feedbackError}</Text>
      )}

      {/* 隐私提示（规格 §6，硬要求）：解释「为什么推荐给你」不等于公开资料 */}
      <KdyBuddyPrivacyNotice compact />

      <Text className='kdy-disclaimer'>
        可达鸭是第三方非官方校园服务平台，与上海科技大学官方系统无关。
      </Text>
    </View>
  )
}
