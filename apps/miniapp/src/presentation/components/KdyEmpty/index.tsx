import { Text, View } from '@tarojs/components'
import Empty from '@taroify/core/empty'
import Loading from '@taroify/core/loading'
import { SmileOutlined, WarningOutlined } from '@taroify/icons'
import '@taroify/core/empty/style'
import '@taroify/core/loading/style'

import { KdyButton } from '../KdyButton'
import './index.scss'

/**
 * KdyEmpty —— 空 / 错误 / 加载 三态占位。
 *
 * 把三态收敛到一个组件里，是为了强制每个列表页都**显式**处理
 * `loading / empty / error`，而不是只画 happy path。
 */
export type KdyEmptyMode = 'empty' | 'error' | 'loading'

export interface KdyEmptyProps {
  mode?: KdyEmptyMode
  title?: string
  description?: string
  /** 有值时显示行动按钮（例如「重试」「清空筛选」） */
  actionText?: string
  onAction?: () => void
}

const DEFAULTS: Record<KdyEmptyMode, { title: string }> = {
  empty: { title: '这里还什么都没有' },
  error: { title: '加载失败了' },
  loading: { title: '正在加载…' },
}

export function KdyEmpty({
  mode = 'empty',
  title,
  description,
  actionText,
  onAction,
}: KdyEmptyProps) {
  const preset = DEFAULTS[mode]

  return (
    <View className={`kdy-empty kdy-empty--${mode}`}>
      <Empty>
        <View className='kdy-empty__glyph'>
          {mode === 'loading' ? (
            <Loading />
          ) : mode === 'error' ? (
            <WarningOutlined />
          ) : (
            <SmileOutlined />
          )}
        </View>
        <Text className='kdy-empty__title'>{title ?? preset.title}</Text>
        {description !== undefined && (
          <Empty.Description className='kdy-empty__description'>
            {description}
          </Empty.Description>
        )}
      </Empty>
      {actionText !== undefined && onAction !== undefined && (
        <View className='kdy-empty__action'>
          <KdyButton variant='secondary' size='sm' onClick={onAction}>
            {actionText}
          </KdyButton>
        </View>
      )}
    </View>
  )
}

export default KdyEmpty
