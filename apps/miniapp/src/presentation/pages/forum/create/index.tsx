import { Text, View } from '@tarojs/components'
import { useState } from 'react'

import { getContainer } from '../../../../app/container'
import { PAGE_PATHS, forumDetailPath } from '../../../../app/routes'
import { validatePostDraft } from '../../../../application/forum/forumUseCases'
import {
  FORUM_BOARDS,
  FORUM_BOARD_LABELS,
  FORUM_BODY_MAX,
  FORUM_TITLE_MAX,
  boardLabel,
} from '../../../../domain/models/forum'
import { navigateTo, toast } from '../../../../platform/navigation'
import { KdyButton, KdyCard, KdyChip, KdyField, KdyImageUploader } from '../../../components'
import { KdyHeading } from '../../../components/KdyHeading'
import { imageSubmitProblem, useImageAttachments, useStore } from '../../../hooks'
import './index.scss'

/**
 * 发帖页。
 *
 * 三条纪律（都来自后端 `ForumPostService.create`）：
 *   · **作者只能是自己**：服务端从 JWT 取 `authorId`，客户端连这个字段都不发；
 *   · **匿名只影响存储形态**：勾选匿名只是请求 `anonymous: true`，实名主体仍由服务端承载，
 *     一旦匿名，`authorId` 不落库，之后连作者本人也无法关闭 / 删除（页面会提前说明）；
 *   · **状态只能走领域动作**：新建一律 `published`，不能通过请求体直接写 `status`。
 */

export default function ForumCreatePage() {
  const container = getContainer()
  const forum = container.useCases.forum
  const session = useStore(container.useCases.session)

  const [board, setBoard] = useState<string>(FORUM_BOARDS[0])
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [anonymous, setAnonymous] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  /**
   * 图片：选完立即上传（匿名帖同样可以带图 —— 图片里没有身份信息，
   * 且服务端上传时已剥离 EXIF GPS，见契约 A2.5）。
   */
  const attachments = useImageAttachments()
  const imageProblem = imageSubmitProblem(attachments)

  const draft = { board, title, body, anonymous, imageUrls: attachments.urls }
  const problems = validatePostDraft(draft)

  if (session.tokens === null) {
    return (
      <View className='kdy-page kdy-forum-create'>
        <KdyHeading title='发布主题' subtitle='登录后才能发帖，方便你管理自己的主题。' />
        <KdyCard elevated={false}>
          <Text className='kdy-forum-create__hint'>当前未登录。</Text>
          <View className='kdy-forum-create__actions'>
            <KdyButton
              block
              onClick={() => {
                void navigateTo(PAGE_PATHS.authLogin)
              }}
            >
              去登录
            </KdyButton>
          </View>
        </KdyCard>
      </View>
    )
  }

  async function handleSubmit(): Promise<void> {
    if (submitting) return
    setError(null)
    setSubmitting(true)

    const result = await forum.createPost(draft)
    setSubmitting(false)

    if (!result.ok) {
      setError(result.error.message)
      return
    }
    toast('发布成功', 'success')
    await navigateTo(forumDetailPath(result.value.id))
  }

  return (
    <View className='kdy-page kdy-forum-create'>
      <KdyHeading
        title='发布主题'
        subtitle='选好版块，写清楚标题与正文；提问前建议先搜索是否已有同类主题。'
        eyebrow='KEDAYA · 论坛'
      />

      <KdyCard title='版块' elevated={false}>
        <View className='kdy-forum-create__chips'>
          {FORUM_BOARDS.map((item) => (
            <KdyChip key={item} active={board === item} onClick={() => setBoard(item)}>
              {FORUM_BOARD_LABELS[item]}
            </KdyChip>
          ))}
        </View>
        <Text className='kdy-forum-create__hint'>当前选择：{boardLabel(board)}</Text>
      </KdyCard>

      <KdyCard title='标题与正文' elevated={false}>
        <KdyField
          label='标题'
          value={title}
          onChange={setTitle}
          placeholder='一句话说清你想讨论什么'
          maxLength={FORUM_TITLE_MAX}
        />
        <KdyField
          label='正文'
          value={body}
          onChange={setBody}
          placeholder='补充背景、你说过的尝试、希望得到的帮助'
          maxLength={FORUM_BODY_MAX}
          hint='支持长文，最多 5000 字；请勿发布违法或侵权内容。'
        />
      </KdyCard>

      <KdyCard title='发布方式' elevated={false}>
        <View className='kdy-forum-create__chips'>
          <KdyChip active={!anonymous} onClick={() => setAnonymous(false)}>
            实名发布
          </KdyChip>
          <KdyChip active={anonymous} onClick={() => setAnonymous(true)}>
            匿名发布
          </KdyChip>
        </View>
        <Text className='kdy-forum-create__hint'>
          {anonymous
            ? '匿名主题不保存作者身份：其他同学只会看到随机昵称；出于隐私保护，发布后你本人也无法关闭或删除它。'
            : '实名发布时作者身份由登录态承载，其他同学看不到你的账号；你可以随时关闭或删除自己的主题。'}
        </Text>
      </KdyCard>

      <KdyCard title='配图' elevated={false}>
        <KdyImageUploader
          items={attachments.items}
          availability={attachments.availability}
          full={attachments.full}
          maxCount={attachments.maxCount}
          onAdd={() => void attachments.add()}
          onRemove={attachments.remove}
          onRetry={(id) => void attachments.retry(id)}
          onRetryAvailability={() => void container.useCases.media.ensureAvailability(true)}
        />
      </KdyCard>

      {problems.length > 0 && (
        <Text className='kdy-forum-create__problems'>还需要完善：{problems.join('、')}</Text>
      )}
      {imageProblem !== null && <Text className='kdy-forum-create__problems'>{imageProblem}</Text>}
      {error !== null && <Text className='kdy-forum-create__error'>{error}</Text>}

      <View className='kdy-forum-create__actions'>
        <KdyButton
          block
          loading={submitting}
          disabled={problems.length > 0 || imageProblem !== null}
          onClick={() => void handleSubmit()}
        >
          发布主题
        </KdyButton>
      </View>

      <Text className='kdy-disclaimer'>
        可达鸭是第三方非官方校园服务平台，与上海科技大学官方系统无关。匿名不等于免责，请勿发布违法或侵权内容或人身攻击。
      </Text>
    </View>
  )
}
