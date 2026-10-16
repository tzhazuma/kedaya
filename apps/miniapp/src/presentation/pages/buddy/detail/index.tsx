import { Text, Textarea, View } from '@tarojs/components'
import { useDidShow, useRouter } from '@tarojs/taro'
import { useState } from 'react'

import { getContainer } from '../../../../app/container'
import { readIdParam } from '../../../../app/routes'
import {
  BUDDY_APPLICATION_STATUS_LABELS,
  BUDDY_SKILL_LEVEL_LABELS,
} from '../../../../domain/models/buddy'
import type { BuddyApplication } from '../../../../domain/models/buddy'
import { navigateBack, toast } from '../../../../platform/navigation'
import { KdyBuddyPrivacyNotice, KdyButton, KdyCard, KdyEmpty, KdyTag } from '../../../components'
import type { KdyTagTone } from '../../../components'
import { useStore } from '../../../hooks'
import './index.scss'

/**
 * 搭子详情页 —— 申请（`join`）/ 撤回（`leave`）/ 审批（`decide`）/ 关闭（`close`）。
 *
 * ⚠️ **`join` 是「申请」不是「入队」**（规格 §5.5 的重要语义澄清）：
 * 提交申请**不占名额**，只有发起人 `decide(ACCEPTED)` 才 `joinedCount += 1`。
 * 页面文案必须与此一致，否则用户会以为申请成功就加入了。
 *
 * ⚠️ **申请列表仅发起人可见**（规格 §6.1）：非发起人看不到 `applications`，
 * 这是权限边界而不是故障，因此不显示为错误。
 *
 * ⚠️ **拒绝不给理由**（规格 §5.6）：`REJECTED` 不展示任何解释输入框 ——
 * 理由文本会成为骚扰面，发起人也没有解释义务。
 *
 * 三态齐全：`loading` / `error`（找不到或加载失败）/ `ready`。
 */

function applicationTone(status: BuddyApplication['status']): KdyTagTone {
  if (status === 'ACCEPTED') return 'success'
  if (status === 'PENDING') return 'brand'
  if (status === 'REJECTED') return 'danger'
  return 'neutral'
}

export default function BuddyDetailPage() {
  const router = useRouter()
  const id = readIdParam(router.params)
  const container = getContainer()
  const detail = container.useCases.buddyPostDetail
  const state = useStore(detail)
  const [message, setMessage] = useState('')

  useDidShow(() => {
    if (id === null) return
    // 契约 §8 第 1 步（幂等）+ 第 3 步
    detail.hydrate(id)
    void detail.load(id)
  })

  if (id === null) {
    return (
      <View className='kdy-page kdy-buddy-detail'>
        <KdyEmpty mode='error' description='缺少搭子 id，无法打开详情' />
      </View>
    )
  }

  const post = state.post
  const summary = state.summary

  async function handleJoin(): Promise<void> {
    const result = await detail.join(id as string, message.trim() === '' ? null : message.trim())
    if (result.actionError !== null) {
      toast(result.actionError, 'error')
      return
    }
    setMessage('')
    toast('申请已提交，等待发起人审批')
  }

  async function handleLeave(): Promise<void> {
    const result = await detail.leave(id as string)
    if (result.actionError !== null) {
      toast(result.actionError, 'error')
      return
    }
    toast('已撤回申请')
  }

  async function handleDecide(applicationId: string, decision: 'ACCEPTED' | 'REJECTED'): Promise<void> {
    const result = await detail.decide(id as string, applicationId, decision)
    if (result.actionError !== null) {
      toast(result.actionError, 'error')
      return
    }
    toast(decision === 'ACCEPTED' ? '已接受该申请' : '已拒绝该申请')
  }

  async function handleClose(): Promise<void> {
    const result = await detail.close(id as string)
    if (result.actionError !== null) {
      toast(result.actionError, 'error')
      return
    }
    toast('已关闭招募')
  }

  async function handleFeedback(action: 'like' | 'dislike' | 'skip'): Promise<void> {
    const result = await detail.feedback(id as string, action)
    if (result.actionError !== null) {
      toast(result.actionError, 'error')
      return
    }
    toast('已记录你的反馈')
  }

  return (
    <View className='kdy-page kdy-buddy-detail'>
      {state.status === 'loading' && <KdyEmpty mode='loading' description='正在加载搭子详情' />}

      {state.status === 'error' && (
        <KdyEmpty
          mode='error'
          description={state.error ?? '加载失败'}
          actionText='重试'
          onAction={() => void detail.load(id as string)}
        />
      )}

      {post !== null && summary !== null && (
        <View>
          {state.fromCache && <Text className='kdy-buddy-detail__hint'>当前展示本地缓存，正在后台刷新…</Text>}

          <KdyCard elevated={false}>
            <View className='kdy-buddy-detail__head'>
              <Text className='kdy-buddy-detail__title'>{post.title}</Text>
              <KdyTag tone={summary.status === 'OPEN' ? 'brand' : 'neutral'}>
                {summary.statusLabel}
              </KdyTag>
            </View>

            <View className='kdy-buddy-detail__meta'>
              <KdyTag tone='info'>{summary.sectionLabel}</KdyTag>
              <KdyTag tone='neutral'>{summary.activityLabel}</KdyTag>
              <KdyTag tone='neutral'>{summary.genderPreferenceLabel}</KdyTag>
              {post.minSkillLevel !== null && (
                <KdyTag tone='warning'>
                  要求 {BUDDY_SKILL_LEVEL_LABELS[post.minSkillLevel]}
                </KdyTag>
              )}
            </View>

            <View className='kdy-buddy-detail__rows'>
              <Text className='kdy-buddy-detail__row'>时间：{summary.startsAtLabel}</Text>
              <Text className='kdy-buddy-detail__row'>时长：{summary.durationMin} 分钟</Text>
              <Text className='kdy-buddy-detail__row'>地点：{post.location}</Text>
              <Text className='kdy-buddy-detail__row'>
                人数：{post.joinedCount}/{post.capacity}（含发起人，还差 {summary.remainingSlots} 人）
              </Text>
              <Text className='kdy-buddy-detail__row'>发起人：{post.creator.nickname}</Text>
            </View>

            {summary.tagLabels.length > 0 && (
              <View className='kdy-buddy-detail__tags'>
                {summary.tagLabels.map((label) => (
                  <KdyTag key={label} tone='neutral'>
                    {label}
                  </KdyTag>
                ))}
              </View>
            )}

            {post.description !== null && (
              <Text className='kdy-buddy-detail__description'>{post.description}</Text>
            )}
          </KdyCard>

          {/* 联系方式说明（规格 §6.2：不许写进说明，通过站内信交换） */}
          <KdyBuddyPrivacyNotice showContact />

          {/* ---------------- 申请区 ---------------- */}
          {!state.isCreator && (
            <KdyCard title='申请加入'>
              {post.myApplication !== null ? (
                <View className='kdy-buddy-detail__mine'>
                  <View className='kdy-buddy-detail__mine-head'>
                    <Text className='kdy-buddy-detail__row'>我的申请</Text>
                    <KdyTag tone={applicationTone(post.myApplication.status)}>
                      {BUDDY_APPLICATION_STATUS_LABELS[post.myApplication.status]}
                    </KdyTag>
                  </View>
                  {post.myApplication.message !== null && (
                    <Text className='kdy-buddy-detail__row'>留言：{post.myApplication.message}</Text>
                  )}
                  {post.myApplication.status === 'PENDING' && (
                    <View className='kdy-buddy-detail__actions'>
                      <KdyButton
                        variant='ghost'
                        size='sm'
                        loading={state.acting}
                        onClick={() => void handleLeave()}
                      >
                        撤回申请
                      </KdyButton>
                    </View>
                  )}
                  {post.myApplication.status === 'WITHDRAWN' && (
                    <Text className='kdy-buddy-detail__note'>已撤回，可以重新申请</Text>
                  )}
                </View>
              ) : (
                <View>
                  <Text className='kdy-buddy-detail__note'>
                    提交的是**申请**，不占名额；发起人接受后才算加入。
                  </Text>
                  <Textarea
                    className='kdy-buddy-detail__textarea'
                    value={message}
                    maxlength={200}
                    placeholder='想对发起人说点什么（可选，≤200 字，只有发起人能看到）'
                    onInput={(event) => setMessage(event.detail.value)}
                  />
                  {state.eligibility !== null && !state.eligibility.allowed && (
                    <Text className='kdy-buddy-detail__blocked'>{state.eligibility.message}</Text>
                  )}
                  <View className='kdy-buddy-detail__actions'>
                    <KdyButton
                      loading={state.acting}
                      disabled={state.eligibility !== null && !state.eligibility.allowed}
                      onClick={() => void handleJoin()}
                    >
                      申请加入
                    </KdyButton>
                  </View>
                </View>
              )}
            </KdyCard>
          )}

          {/* ---------------- 发起人区 ---------------- */}
          {state.isCreator && (
            <KdyCard
              title='收到的申请'
              extra={<KdyTag tone='neutral'>{state.applications.length} 条</KdyTag>}
            >
              {state.applications.length === 0 ? (
                <View>
                  <Text className='kdy-buddy-detail__note'>还没有人申请</Text>
                  {container.mockBuddyControls !== null && (
                    <View className='kdy-buddy-detail__actions'>
                      <KdyButton
                        variant='ghost'
                        size='sm'
                        onClick={() => {
                          void container.mockBuddyControls
                            ?.addDemoApplication(id as string)
                            .then(() => detail.load(id as string))
                        }}
                      >
                        模拟一条申请
                      </KdyButton>
                    </View>
                  )}
                </View>
              ) : (
                <View>
                  {state.applications.map((application) => (
                    <View key={application.id} className='kdy-buddy-detail__application'>
                      <View className='kdy-buddy-detail__mine-head'>
                        <Text className='kdy-buddy-detail__row'>{application.applicantName}</Text>
                        <KdyTag tone={applicationTone(application.status)}>
                          {BUDDY_APPLICATION_STATUS_LABELS[application.status]}
                        </KdyTag>
                      </View>
                      {application.message !== null && (
                        <Text className='kdy-buddy-detail__row'>{application.message}</Text>
                      )}
                      {application.status === 'PENDING' && (
                        <View className='kdy-buddy-detail__actions'>
                          <KdyButton
                            size='sm'
                            loading={state.acting}
                            onClick={() => void handleDecide(application.id, 'ACCEPTED')}
                          >
                            接受
                          </KdyButton>
                          <KdyButton
                            size='sm'
                            variant='ghost'
                            loading={state.acting}
                            onClick={() => void handleDecide(application.id, 'REJECTED')}
                          >
                            拒绝
                          </KdyButton>
                        </View>
                      )}
                    </View>
                  ))}
                  <Text className='kdy-buddy-detail__note'>
                    拒绝不会给出理由（规格 §5.6）—— 发起人没有解释义务，理由文本会成为骚扰面。
                  </Text>
                </View>
              )}
            </KdyCard>
          )}

          {state.isCreator && (
            <KdyCard title='发起人操作'>
              <View className='kdy-buddy-detail__actions'>
                <KdyButton
                  variant='danger'
                  size='sm'
                  loading={state.acting}
                  disabled={post.status === 'CLOSED' || post.status === 'CANCELLED'}
                  onClick={() => void handleClose()}
                >
                  关闭招募
                </KdyButton>
              </View>
              <Text className='kdy-buddy-detail__note'>
                关闭后状态变为 CLOSED，无法再收到申请（契约 §11.2 的 `close` 动作）。
              </Text>
            </KdyCard>
          )}

          {/* ---------------- 匹配反馈（规格 §5.8） ---------------- */}
          <KdyCard title='这条搭子适合我吗'>
            <Text className='kdy-buddy-detail__note'>
              反馈只影响「为我推荐」的排序，不会通知发起人，也不会公开。
            </Text>
            <View className='kdy-buddy-detail__actions'>
              <KdyButton
                size='sm'
                variant={state.myFeedback === 'like' ? 'primary' : 'ghost'}
                loading={state.acting}
                onClick={() => void handleFeedback('like')}
              >
                感兴趣
              </KdyButton>
              <KdyButton
                size='sm'
                variant={state.myFeedback === 'dislike' ? 'danger' : 'ghost'}
                loading={state.acting}
                onClick={() => void handleFeedback('dislike')}
              >
                不感兴趣
              </KdyButton>
              <KdyButton
                size='sm'
                variant={state.myFeedback === 'skip' ? 'secondary' : 'ghost'}
                loading={state.acting}
                onClick={() => void handleFeedback('skip')}
              >
                跳过
              </KdyButton>
            </View>
            {state.myFeedback !== null && (
              <Text className='kdy-buddy-detail__note'>已记录：{state.myFeedback}</Text>
            )}
          </KdyCard>

          {state.actionError !== null && (
            <Text className='kdy-buddy-detail__error'>{state.actionError}</Text>
          )}

          <View className='kdy-buddy-detail__actions'>
            <KdyButton variant='ghost' size='sm' onClick={() => void navigateBack()}>
              返回
            </KdyButton>
          </View>
        </View>
      )}

      <Text className='kdy-disclaimer'>
        可达鸭是第三方非官方校园服务平台，与上海科技大学官方系统无关。
      </Text>
    </View>
  )
}
