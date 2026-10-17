import { Text, View } from '@tarojs/components'
import { useDidShow, useRouter } from '@tarojs/taro'
import { useState } from 'react'

import { getContainer } from '../../../../app/container'
import { navigateBack } from '../../../../platform/navigation'
import {
  FORUM_ANONYMITY_NOTICE,
  FORUM_BODY_MAX_LENGTH,
  FORUM_MAX_TAGS,
  FORUM_TAG_MAX_LENGTH,
  FORUM_TITLE_MAX_LENGTH,
  validatePostDraft,
} from '../../../../domain/models/forum'
import type { DraftFieldError } from '../../../../domain/models/forum'
import { toast } from '../../../../platform/navigation'
import { KdyButton, KdyCard, KdyChip, KdyEmpty, KdyField, KdySwitch, KdyTag } from '../../../components'
import { useStore } from '../../../hooks'
import './index.scss'

/**
 * 发帖页 —— 含**匿名开关**与明确的隐私说明（契约 §9 + domain-model §2.4）。
 *
 * 隐私说明不是装饰：`anonymous` 只是让其他同学看不到你的昵称，
 * 版主仍可在本板块内追溯同一匿名身份。把这句话显示出来，才不算误导性的隐私承诺。
 *
 * 校验分两道：
 * 1. 页面用 `validatePostDraft`（纯函数）做即时反馈，错误就地显示；
 * 2. 用例层再校验一次（同一个函数），避免绕过 UI 的调用路径漏掉规则。
 */

function errorFor(errors: DraftFieldError[], field: string): string | undefined {
  return errors.find((error) => error.field === field)?.message
}

export default function ForumCreatePage() {
  const router = useRouter()
  const params = router.params as Record<string, string | undefined>

  const container = getContainer()
  const createPost = container.useCases.createForumPost
  const boardsUseCase = container.useCases.listForumBoards
  const boardState = useStore(boardsUseCase)

  const [boardId, setBoardId] = useState<string>(params.boardId ?? '')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [tagInput, setTagInput] = useState('')
  const [anonymous, setAnonymous] = useState(false)
  const [errors, setErrors] = useState<DraftFieldError[]>([])
  const [warnings, setWarnings] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)

  useDidShow(() => {
    boardsUseCase.hydrate()
    if (boardsUseCase.getSnapshot().boards.length === 0) void boardsUseCase.load()
  })

  const tags = tagInput
    .split(/[,，\s]+/)
    .map((tag) => tag.trim())
    .filter((tag) => tag !== '')

  const activeBoardId = boardId !== '' ? boardId : (boardState.boards[0]?.id ?? '')

  function handleValidate(): boolean {
    const result = validatePostDraft({ boardId: activeBoardId, title, body, tags })
    if (result.valid) {
      setErrors([])
      setWarnings(result.warnings)
      return true
    }
    setErrors(result.errors)
    setWarnings(result.warnings)
    return false
  }

  async function handleSubmit(): Promise<void> {
    if (!handleValidate()) {
      toast('请先修正表单里的问题')
      return
    }

    setSubmitting(true)
    try {
      const result = await createPost.submit({
        boardId: activeBoardId,
        title,
        body,
        tags,
        anonymous,
      })

      if (!result.ok) {
        toast(result.error.message)
        return
      }

      setWarnings(result.value.warnings)
      toast(anonymous ? '已匿名发布' : '发布成功', 'success')
      await navigateBack()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <View className='kdy-page kdy-forum-create'>
      <KdyCard title='选择版块' elevated={false}>
        {boardState.status === 'loading' && <KdyEmpty mode='loading' description='正在加载版块' />}

        {boardState.status === 'error' && (
          <KdyEmpty
            mode='error'
            description={boardState.error ?? '版块加载失败'}
            actionText='重试'
            onAction={() => {
              void boardsUseCase.load()
            }}
          />
        )}

        {boardState.status !== 'loading' && boardState.status !== 'error' && (
          <View className='kdy-forum-create__boards'>
            {boardState.boards.map((board) => (
              <View
                key={board.id}
                className='kdy-forum-create__board'
              >
                <KdyChip active={activeBoardId === board.id} onClick={() => setBoardId(board.id)}>
                  {board.name}
                </KdyChip>
              </View>
            ))}
            {boardState.boards.length === 0 && (
              <Text className='kdy-forum-create__hint'>还没有可选版块</Text>
            )}
          </View>
        )}
      </KdyCard>

      <KdyCard title='主题内容' elevated={false}>
        <KdyField
          label='标题'
          required
          hint={`${[...title].length}/${FORUM_TITLE_MAX_LENGTH}`}
          error={errorFor(errors, 'title')}
          value={title}
          placeholder='一句话说清你想聊什么'
          maxLength={FORUM_TITLE_MAX_LENGTH}
          onChange={setTitle}
        />

        <KdyField
          label='正文'
          required
          hint={`${[...body].length}/${FORUM_BODY_MAX_LENGTH}`}
          error={errorFor(errors, 'body')}
          multiline
          value={body}
          placeholder='补充细节，方便同学理解和回复'
          maxLength={FORUM_BODY_MAX_LENGTH}
          onChange={setBody}
        />

        <KdyField
          label='标签'
          hint={`最多 ${FORUM_MAX_TAGS} 个，每个 ≤${FORUM_TAG_MAX_LENGTH} 字，用空格或逗号分隔`}
          error={errorFor(errors, 'tags')}
          value={tagInput}
          placeholder='例如：食堂 图书馆'
          onChange={setTagInput}
        />

        {tags.length > 0 && (
          <View className='kdy-forum-create__tags'>
            {tags.map((tag) => (
              <KdyTag key={tag} tone='info'>
                #{tag}
              </KdyTag>
            ))}
          </View>
        )}
      </KdyCard>

      <KdyCard title='发布方式' elevated={false}>
        <KdySwitch
          checked={anonymous}
          label='匿名发布'
          description='其他同学看不到你的昵称与学号'
          onChange={setAnonymous}
        />
        <Text className='kdy-forum-create__privacy'>{FORUM_ANONYMITY_NOTICE}</Text>
      </KdyCard>

      {warnings.length > 0 && (
        <KdyCard title='发布前提醒' elevated={false}>
          {warnings.map((warning) => (
            <Text key={warning} className='kdy-forum-create__warning'>
              {warning}
            </Text>
          ))}
        </KdyCard>
      )}

      {errors.length > 0 && (
        <KdyCard title='需要修正' elevated={false}>
          {errors.map((error) => (
            <Text key={`${error.field}-${error.message}`} className='kdy-forum-create__error'>
              {error.message}
            </Text>
          ))}
        </KdyCard>
      )}

      <View className='kdy-forum-create__actions'>
        <KdyButton
          block
          size='lg'
          loading={submitting}
          onClick={() => {
            void handleSubmit()
          }}
        >
          {anonymous ? '匿名发布' : '发布主题'}
        </KdyButton>
        <KdyButton size='sm' variant='ghost' onClick={() => void navigateBack()}>
          取消
        </KdyButton>
      </View>

      <Text className='kdy-disclaimer'>
        可达鸭是第三方非官方校园服务平台。请遵守社区规范，不要发布违法违规内容。
      </Text>
    </View>
  )
}
