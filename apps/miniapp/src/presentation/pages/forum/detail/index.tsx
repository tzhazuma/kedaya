import { Text, Textarea, View } from '@tarojs/components'
import Taro, {
  useDidShow,
  usePullDownRefresh,
  useReachBottom,
  useRouter,
  useShareAppMessage,
} from '@tarojs/taro'
import { useState } from 'react'

import { getContainer } from '../../../../app/container'
import { PAGE_PATHS, forumDetailPath, forumReportPath, readIdParam } from '../../../../app/routes'
import { FORUM_ANONYMITY_NOTICE_SHORT, FORUM_REPLY_MAX_LENGTH } from '../../../../domain/models/forum'
import type { ForumReply } from '../../../../domain/models/forum'
import { navigateTo, toast } from '../../../../platform/navigation'
import { buildSharePath, copyToClipboard, enableShareMenu } from '../../../../platform/share'
import { KdyButton, KdyCard, KdyEmpty, KdyField, KdyTag } from '../../../components'
import { useStore } from '../../../hooks'
import './index.scss'

/**
 * 论坛主题详情页 —— 读（主题 + 楼中楼回复）+ 写（回复）+ 举报 + 分享。
 *
 * 小程序特性：
 * - `onShareAppMessage`（`useShareAppMessage`）+ `<Button open-type='share'>`：
 *   微信**不允许**代码静默分享，必须由用户点击触发（见 `platform/share.ts`）。
 * - `onPullDownRefresh` / `onReachBottom`：刷新主题、加载更多回复。
 *
 * 三态：loading / error（带重试）/ ready；回复区另有**局部**错误态，
 * 避免「主题已加载但回复失败」退化成整页错误页。
 */

export default function ForumDetailPage() {
  const router = useRouter()
  const id = readIdParam(router.params as Record<string, string | undefined>)

  const container = getContainer()
  const detail = container.useCases.forumPostDetail
  const replyToPost = container.useCases.replyToPost
  const state = useStore(detail)

  const [replyBody, setReplyBody] = useState('')
  const [replyTarget, setReplyTarget] = useState<ForumReply | null>(null)
  const [submitting, setSubmitting] = useState(false)

  function load(): Promise<void> {
    if (id === null) return Promise.resolve()
    return detail.load(id).then(() => undefined)
  }

  useDidShow(() => {
    if (id === null) return
    detail.hydrate(id)
    void load()
    // 打开右上角「转发」菜单项；H5 无此概念，静默成功
    void enableShareMenu()
  })

  usePullDownRefresh(() => {
    void load().then(() => Taro.stopPullDownRefresh())
  })

  useReachBottom(() => {
    void detail.loadMoreReplies()
  })

  useShareAppMessage(() => ({
    title: state.summary?.title ?? '可达鸭 · 校园论坛',
    path: id === null ? PAGE_PATHS.forumList : forumDetailPath(id),
  }))

  async function handleSubmitReply(): Promise<void> {
    if (id === null) return
    setSubmitting(true)
    try {
      const result = await replyToPost.submit({
        postId: id,
        body: replyBody,
        ...(replyTarget === null ? {} : { parentReplyId: replyTarget.id }),
      })

      if (!result.ok) {
        toast(result.error.message)
        if (result.error.code === 'UNAUTHENTICATED') {
          void navigateTo(PAGE_PATHS.profile)
        }
        return
      }

      detail.appendReply(result.value.reply)
      setReplyBody('')
      setReplyTarget(null)
      toast('回复成功', 'success')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleCopyLink(): Promise<void> {
    if (id === null) return
    const result = await copyToClipboard({
      title: state.summary?.title ?? '可达鸭 · 校园论坛',
      path: forumDetailPath(id),
    })
    if (result.ok) {
      toast('链接已复制', 'success')
      return
    }
    toast(result.error.message)
  }

  if (state.status === 'loading') {
    return (
      <View className='kdy-page kdy-forum-detail'>
        <KdyEmpty mode='loading' description='正在加载主题' />
      </View>
    )
  }

  if (state.status === 'error' || state.summary === null) {
    return (
      <View className='kdy-page kdy-forum-detail'>
        <KdyEmpty
          mode='error'
          description={state.error ?? '主题不存在或已被删除'}
          actionText='重试'
          onAction={() => {
            void load()
          }}
        />
      </View>
    )
  }

  const summary = state.summary
  const post = state.post
  const sharePath = buildSharePath({
    title: summary.title,
    path: id === null ? PAGE_PATHS.forumList : forumDetailPath(id),
  })

  return (
    <View className='kdy-page kdy-forum-detail'>
      <KdyCard
        title={summary.title}
        extra={<KdyTag tone={summary.commentable ? 'brand' : 'neutral'}>{summary.statusLabel}</KdyTag>}
      >
        <View className='kdy-forum-detail__meta'>
          <KdyTag tone='neutral'>{summary.authorName}</KdyTag>
          {summary.anonymous && <KdyTag tone='info'>匿名</KdyTag>}
          {state.fromCache && <KdyTag tone='info'>本地缓存</KdyTag>}
          <Text className='kdy-forum-detail__time'>{summary.createdAtLabel}</Text>
        </View>

        {summary.tags.length > 0 && (
          <View className='kdy-forum-detail__tags'>
            {summary.tags.map((tag) => (
              <KdyTag key={tag} tone='info'>
                #{tag}
              </KdyTag>
            ))}
          </View>
        )}

        {post !== null && <Text className='kdy-forum-detail__body'>{post.body}</Text>}

        <Text className='kdy-forum-detail__stats'>
          {summary.replyCount} 回复 · {summary.likeCount} 赞 · 分享路径 {sharePath}
        </Text>
      </KdyCard>

      <KdyCard title={`回复（${state.replies.length}）`} elevated={false}>
        {state.repliesError !== null && (
          <Text className='kdy-forum-detail__replies-error'>
            回复加载失败：{state.repliesError}
          </Text>
        )}

        {state.threads.length === 0 && state.repliesError === null && (
          <Text className='kdy-forum-detail__empty'>还没有人回复，来说第一句吧</Text>
        )}

        {state.threads.map((thread) => (
          <View key={thread.root.id} className='kdy-forum-detail__thread'>
            <View className='kdy-forum-detail__reply'>
              <View className='kdy-forum-detail__reply-head'>
                <Text className='kdy-forum-detail__reply-author'>{thread.root.authorName}</Text>
                <Text className='kdy-forum-detail__reply-time'>{thread.root.createdAt}</Text>
              </View>
              <Text className='kdy-forum-detail__reply-body'>{thread.root.body}</Text>
              <View className='kdy-forum-detail__reply-actions'>
                <Text
                  className='kdy-forum-detail__link'
                  onClick={() => setReplyTarget(thread.root)}
                >
                  回复
                </Text>
                <Text
                  className='kdy-forum-detail__link'
                  onClick={() => {
                    void navigateTo(
                      forumReportPath({ targetType: 'REPLY', targetId: thread.root.id }),
                    )
                  }}
                >
                  举报
                </Text>
              </View>
            </View>

            {thread.children.map((child) => (
              <View key={child.id} className='kdy-forum-detail__reply kdy-forum-detail__reply--child'>
                <View className='kdy-forum-detail__reply-head'>
                  <Text className='kdy-forum-detail__reply-author'>{child.authorName}</Text>
                  <Text className='kdy-forum-detail__reply-time'>{child.createdAt}</Text>
                </View>
                <Text className='kdy-forum-detail__reply-body'>{child.body}</Text>
                <View className='kdy-forum-detail__reply-actions'>
                  <Text
                    className='kdy-forum-detail__link'
                    onClick={() => setReplyTarget(thread.root)}
                  >
                    回复
                  </Text>
                  <Text
                    className='kdy-forum-detail__link'
                    onClick={() => {
                      void navigateTo(
                        forumReportPath({ targetType: 'REPLY', targetId: child.id }),
                      )
                    }}
                  >
                    举报
                  </Text>
                </View>
              </View>
            ))}
          </View>
        ))}

        {state.loadingReplies && <Text className='kdy-forum-detail__more'>正在加载更多回复…</Text>}
        {!state.loadingReplies && state.nextReplyCursor === null && state.replies.length > 0 && (
          <Text className='kdy-forum-detail__more'>没有更多回复了</Text>
        )}
      </KdyCard>

      <KdyCard title='发表回复' elevated={false}>
        {summary.commentable ? (
          <View>
            {replyTarget !== null && (
              <View className='kdy-forum-detail__quoting'>
                <Text className='kdy-forum-detail__quoting-text'>
                  正在回复 {replyTarget.authorName}
                </Text>
                <Text className='kdy-forum-detail__link' onClick={() => setReplyTarget(null)}>
                  取消
                </Text>
              </View>
            )}

            <KdyField label='回复内容' hint={`${[...replyBody].length}/${FORUM_REPLY_MAX_LENGTH}`} required>
              <Textarea
                className='kdy-forum-detail__textarea'
                value={replyBody}
                placeholder='友善发言，共建校园社区'
                maxlength={FORUM_REPLY_MAX_LENGTH}
                onInput={(event) => setReplyBody(event.detail.value)}
              />
            </KdyField>

            <KdyButton
              block
              loading={submitting}
              disabled={replyBody.trim() === ''}
              onClick={() => {
                void handleSubmitReply()
              }}
            >
              提交回复
            </KdyButton>
            <Text className='kdy-forum-detail__notice'>{FORUM_ANONYMITY_NOTICE_SHORT}</Text>
          </View>
        ) : (
          <Text className='kdy-forum-detail__locked'>
            该主题当前状态为「{summary.statusLabel}」，无法回复。
          </Text>
        )}
      </KdyCard>

      <View className='kdy-forum-detail__actions'>
        {/* 微信：必须由用户点击 open-type='share' 才会触发转发 */}
        <KdyButton size='sm' variant='ghost' openType='share'>
          分享给好友
        </KdyButton>
        <KdyButton
          size='sm'
          variant='ghost'
          onClick={() => {
            void handleCopyLink()
          }}
        >
          复制链接
        </KdyButton>
        <KdyButton
          size='sm'
          variant='ghost'
          onClick={() => {
            void navigateTo(forumReportPath({ targetType: 'POST', targetId: summary.id }))
          }}
        >
          举报主题
        </KdyButton>
      </View>

      <Text className='kdy-disclaimer'>
        可达鸭是第三方非官方校园服务平台。论坛内容由同学发布，平台不保证其真实性。
      </Text>
    </View>
  )
}
