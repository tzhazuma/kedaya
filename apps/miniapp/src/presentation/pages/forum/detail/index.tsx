import { Text, View } from '@tarojs/components'
import Taro, { useDidShow, useRouter } from '@tarojs/taro'
import { useState } from 'react'

import { getContainer } from '../../../../app/container'
import { PAGE_PATHS, readIdParam } from '../../../../app/routes'
import { validateReplyDraft } from '../../../../application/forum/forumUseCases'
import {
  FORUM_ACTION_LABELS,
  FORUM_REPLY_MAX,
  FORUM_STATUS,
  availableActions,
  canReply,
  summarizePost,
  summarizeReply,
} from '../../../../domain/models/forum'
import type { ForumPost, ForumPostAction } from '../../../../domain/models/forum'
import { navigateTo, redirectTo, toast } from '../../../../platform/navigation'
import { KdyButton, KdyCard, KdyChip, KdyEmpty, KdyField, KdyTag } from '../../../components'
import { KdyHeading } from '../../../components/KdyHeading'
import { useStore } from '../../../hooks'
import './index.scss'

/**
 * 论坛主题详情页。
 *
 * 这一页把**领域规则**直接呈现在 UI 上：
 *   · 回复框只在 `canReply()` 允许时出现 —— 已关闭主题不再显示输入区；
 *   · 关闭 / 删除只按 `availableActions()` 渲染 —— 别人家的主题不会露出管理按钮，
 *     匿名主题连原发布者也不给（`canClose` / `canRemove` 会说明原因）；
 *   · 未登录时动作引导登录，而不是发一个注定 401 的请求；
 *   · 回复成功后由用例重新拉详情，`replyCount` 与回复列表立刻一致。
 */

/** 详情页里由「管理区」渲染的动作（回复有独立输入区，不放进按钮行） */
type ManagementAction = 'close' | 'delete'

const ACTION_VARIANT: Readonly<Record<ForumPostAction, 'primary' | 'secondary' | 'ghost' | 'danger'>> =
  {
    reply: 'primary',
    close: 'secondary',
    delete: 'danger',
  }

export default function ForumDetailPage() {
  const container = getContainer()
  const router = useRouter()
  const id = readIdParam(router.params as Record<string, string | undefined>)

  const forum = container.useCases.forum
  const detail = useStore(forum.detail)
  const session = useStore(container.useCases.session)
  const viewerId = session.profile?.id ?? null

  const [replyBody, setReplyBody] = useState('')
  const [replyAnonymous, setReplyAnonymous] = useState(false)
  const [replyError, setReplyError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)

  useDidShow(() => {
    if (id !== null) void forum.detail.load(id)
  })

  if (id === null) {
    return (
      <View className='kdy-page'>
        <KdyEmpty mode='error' title='链接不对' description='缺少主题 id，请从列表进入' />
      </View>
    )
  }

  if (detail.status === 'loading' && detail.data === null) {
    return (
      <View className='kdy-page'>
        <KdyEmpty mode='loading' />
      </View>
    )
  }

  if (detail.status === 'error' && detail.data === null) {
    return (
      <View className='kdy-page'>
        <KdyEmpty
          mode='error'
          title='没能打开这个主题'
          description={detail.error ?? '请稍后重试'}
          actionText='重试'
          onAction={() => void forum.detail.load(id)}
        />
      </View>
    )
  }

  if (detail.data === null) {
    return (
      <View className='kdy-page'>
        <KdyEmpty mode='empty' title='主题不存在或已被删除' />
      </View>
    )
  }

  // 已经过 null 校验：用非空局部变量，闭包（事件处理）里也能安全取用
  const post: ForumPost = detail.data.post
  const replies = detail.data.replies
  const summary = summarizePost(post, viewerId, container.clock.now())
  const actions = availableActions(post, viewerId)
  const managementActions = actions.filter(
    (action): action is ManagementAction => action !== 'reply',
  )
  const replyGate = canReply(post, viewerId)
  const replyProblems = validateReplyDraft({ body: replyBody, anonymous: replyAnonymous })
  const canSend = replyGate.allowed && replyProblems.length === 0 && !sending

  /** 管理区 / 无权限时给一句人话，和按钮同源判断 */
  const managementHint =
    viewerId === null
      ? ''
      : post.authorId === null
        ? '这是匿名主题，不保存作者身份，出于隐私保护任何人都不能关闭或删除它。'
        : post.authorId !== viewerId
          ? '这是其他同学发布的内容，你可以在下面回复参与讨论；关闭或删除仅限发布者。'
          : post.status === FORUM_STATUS.closed
            ? '这个主题已关闭，只能删除，不能再回复。'
            : '你是发布者：关闭后停止接收回复（主题仍可见）；删除后无法恢复，回复会一并删除。'

  async function handleSend(): Promise<void> {
    if (!canSend) return
    setReplyError(null)
    setSending(true)

    const result = await forum.reply(post.id, { body: replyBody, anonymous: replyAnonymous })
    setSending(false)

    if (!result.ok) {
      setReplyError(result.error.message)
      return
    }
    setReplyBody('')
    toast('回复已发布', 'success')
  }

  async function handleLoadMoreReplies(): Promise<void> {
    const result = await forum.loadMoreReplies(post.id)
    if (!result.ok) toast(result.error.message, 'error')
  }

  async function handleAction(action: ManagementAction): Promise<void> {
    if (viewerId === null) {
      toast('请先登录')
      await navigateTo(PAGE_PATHS.authLogin)
      return
    }

    if (action === 'close') {
      const result = await forum.close(post.id)
      if (!result.ok) {
        toast(result.error.message, 'error')
        return
      }
      toast('主题已关闭', 'success')
      return
    }

    const confirmed = await Taro.showModal({
      title: '删除这个主题？',
      content: '删除后无法恢复，主题下的所有回复也会一并删除。',
      confirmText: '删除',
    })
    if (!confirmed.confirm) return

    const removed = await forum.remove(post.id)
    if (!removed.ok) {
      toast(removed.error.message, 'error')
      return
    }
    toast('主题已删除', 'success')
    await redirectTo(PAGE_PATHS.forumList)
  }

  return (
    <View className='kdy-page kdy-forum-detail'>
      <KdyHeading
        title={post.title}
        subtitle={`${summary.boardLabel} · ${summary.statusLabel}`}
        eyebrow='KEDAYA · 论坛'
      />

      <KdyCard elevated={false}>
        <View className='kdy-forum-detail__head'>
          <View className='kdy-forum-detail__tags'>
            {summary.pinned ? <KdyTag tone='warning'>置顶</KdyTag> : null}
            {summary.anonymous ? <KdyTag tone='neutral'>匿名</KdyTag> : null}
            {post.status === FORUM_STATUS.closed ? (
              <KdyTag tone='success'>{summary.statusLabel}</KdyTag>
            ) : null}
            {summary.mine ? <KdyTag tone='brand'>我发布的</KdyTag> : null}
          </View>
          <Text className='kdy-forum-detail__meta'>
            {summary.boardLabel} · {summary.authorLabel}
          </Text>
        </View>

        <Text className='kdy-forum-detail__body'>{post.body}</Text>

        <View className='kdy-forum-detail__rows'>
          <View className='kdy-forum-detail__row'>
            <Text className='kdy-forum-detail__k'>状态</Text>
            <Text className='kdy-forum-detail__v'>{summary.statusLabel}</Text>
          </View>
          <View className='kdy-forum-detail__row'>
            <Text className='kdy-forum-detail__k'>回复数</Text>
            <Text className='kdy-forum-detail__v'>{summary.replyCountLabel}</Text>
          </View>
          <View className='kdy-forum-detail__row'>
            <Text className='kdy-forum-detail__k'>发布时间</Text>
            <Text className='kdy-forum-detail__v'>发布于 {summary.createdLabel}</Text>
          </View>
          <View className='kdy-forum-detail__row'>
            <Text className='kdy-forum-detail__k'>最近回复</Text>
            <Text className='kdy-forum-detail__v'>{summary.lastReplyLabel ?? '还没有人回复'}</Text>
          </View>
        </View>
      </KdyCard>

      {managementActions.length > 0 && (
        <KdyCard title='主题管理' elevated={false}>
          {managementHint === '' ? null : (
            <Text className='kdy-forum-detail__hint'>{managementHint}</Text>
          )}
          <View className='kdy-forum-detail__actions'>
            {managementActions.map((action) => (
              <KdyButton
                key={action}
                variant={ACTION_VARIANT[action]}
                loading={detail.mutating}
                onClick={() => void handleAction(action)}
              >
                {action === 'close' ? FORUM_ACTION_LABELS.close : FORUM_ACTION_LABELS.delete}
              </KdyButton>
            ))}
          </View>
        </KdyCard>
      )}

      {managementActions.length === 0 && viewerId === null && (
        <KdyCard elevated={false}>
          <Text className='kdy-forum-detail__hint'>
            登录后可以回复主题；如果你是发布者，还能关闭或删除自己的主题。
          </Text>
          <View className='kdy-forum-detail__actions'>
            <KdyButton
              onClick={() => {
                void navigateTo(PAGE_PATHS.authLogin)
              }}
            >
              去登录
            </KdyButton>
          </View>
        </KdyCard>
      )}

      {managementActions.length === 0 && viewerId !== null && managementHint !== '' && (
        <KdyCard elevated={false}>
          <Text className='kdy-forum-detail__hint'>{managementHint}</Text>
        </KdyCard>
      )}

      <KdyCard title='回复' extra={<Text>{`${post.replyCount} 条`}</Text>} elevated={false}>
        {replies.items.length === 0 ? (
          <Text className='kdy-forum-detail__hint'>还没有回复，来抢第一个位置吧。</Text>
        ) : (
          <View className='kdy-forum-detail__replies'>
            {replies.items.map((reply) => {
              const view = summarizeReply(reply, viewerId, container.clock.now())
              return (
                <View className='kdy-forum-detail__reply' key={view.id}>
                  <View className='kdy-forum-detail__reply-head'>
                    <Text className='kdy-forum-detail__reply-author'>{view.authorLabel}</Text>
                    <Text className='kdy-forum-detail__reply-time'>{view.timeLabel}</Text>
                  </View>
                  <Text className='kdy-forum-detail__reply-body'>{view.body}</Text>
                </View>
              )
            })}
          </View>
        )}

        {replies.nextCursor !== null && (
          <View className='kdy-forum-detail__more'>
            <KdyButton
              size='sm'
              variant='ghost'
              loading={detail.mutating}
              onClick={() => void handleLoadMoreReplies()}
            >
              加载更多回复
            </KdyButton>
          </View>
        )}
      </KdyCard>

      {viewerId === null ? (
        <KdyCard title='参与讨论' elevated={false}>
          <Text className='kdy-forum-detail__hint'>登录后可以回复主题，也可以选择匿名回复。</Text>
          <View className='kdy-forum-detail__actions'>
            <KdyButton
              onClick={() => {
                void navigateTo(PAGE_PATHS.authLogin)
              }}
            >
              去登录
            </KdyButton>
          </View>
        </KdyCard>
      ) : !replyGate.allowed ? (
        <KdyCard title='参与讨论' elevated={false}>
          <Text className='kdy-forum-detail__hint'>{replyGate.message}</Text>
        </KdyCard>
      ) : (
        <KdyCard title='写回复' elevated={false}>
          <KdyField
            label='回复内容'
            value={replyBody}
            onChange={setReplyBody}
            placeholder='友善发言，请勿人身攻击'
            maxLength={FORUM_REPLY_MAX}
          />
          <View className='kdy-forum-detail__chips'>
            <KdyChip active={!replyAnonymous} onClick={() => setReplyAnonymous(false)}>
              实名回复
            </KdyChip>
            <KdyChip active={replyAnonymous} onClick={() => setReplyAnonymous(true)}>
              匿名回复
            </KdyChip>
          </View>
          <Text className='kdy-forum-detail__hint'>
            匿名回复同样不保存作者身份，发布后任何人都无法把它与你的账号关联。
          </Text>
          {replyBody.trim() !== '' && replyProblems.length > 0 && (
            <Text className='kdy-forum-detail__hint'>还需要完善：{replyProblems.join('、')}</Text>
          )}
          {replyError !== null && <Text className='kdy-forum-detail__error'>{replyError}</Text>}
          <View className='kdy-forum-detail__actions'>
            <KdyButton block loading={sending} disabled={!canSend} onClick={() => void handleSend()}>
              发表回复
            </KdyButton>
          </View>
        </KdyCard>
      )}

      {detail.error !== null && <Text className='kdy-forum-detail__error'>{detail.error}</Text>}

      <Text className='kdy-disclaimer'>
        可达鸭是第三方非官方校园服务平台，与上海科技大学官方系统无关。匿名不等于免责，请友善交流，请勿发布违法或侵权内容。
      </Text>
    </View>
  )
}
