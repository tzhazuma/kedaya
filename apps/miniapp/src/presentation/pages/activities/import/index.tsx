import { Text, View } from '@tarojs/components'
import { useReducer } from 'react'

import { getContainer } from '../../../../app/container'
import { activityDetailPath, activityHistoryPath } from '../../../../app/routes'
import { wechatImportProblem } from '../../../../domain/models/activity'
import { navigateTo } from '../../../../platform/navigation'
import { KdyButton, KdyCard, KdyChip, KdyTag } from '../../../components'
import { KdyField } from '../../../components/KdyField'
import { KdyHeading } from '../../../components/KdyHeading'
import { importFormReducer, initialImportFormState } from './importForm'
import './index.scss'

/**
 * 公众号单篇导入。
 *
 * 只做**用户主动**粘一篇链接或正文：
 *   · 不做自动发现、不做批量历史抓取；
 *   · 不做反检测 / 绕过验证；
 *   · 链接只用于复制（`web-view` 需要业务域名备案，这里不打开）。
 *
 * 服务端解析后返回的是**候选活动**；用户还要在详情页确认，
 * 才会加入日程或建提醒。
 */

export default function ActivityImportPage() {
  const activities = getContainer().useCases.activities
  const [state, dispatch] = useReducer(importFormReducer, initialImportFormState)

  async function handleSubmit(): Promise<void> {
    if (state.submitting) return
    const input = state.mode === 'link' ? { link: state.link } : { text: state.text }
    const problem = wechatImportProblem(input)
    if (problem !== null) {
      dispatch({ type: 'submit-invalid', message: problem })
      return
    }

    dispatch({ type: 'submit-start' })
    try {
      const imported = await activities.importWechat(input)
      if (!imported.ok) {
        dispatch({ type: 'submit-failure', message: imported.error.message })
        return
      }
      dispatch({ type: 'submit-success', items: [imported.value] })
    } finally {
      dispatch({ type: 'submit-end' })
    }
  }

  return (
    <View className='kdy-page kdy-activity-import'>
      <KdyHeading
        title='导入公众号文章'
        subtitle='一次只导入你主动粘贴的一篇；不做自动发现，也不抓历史文章。'
      />

      <KdyCard elevated={false}>
        <View className='kdy-activity-import__modes'>
          <KdyChip
            active={state.mode === 'link'}
            onClick={() => dispatch({ type: 'mode', mode: 'link' })}
          >
            粘贴链接
          </KdyChip>
          <KdyChip
            active={state.mode === 'text'}
            onClick={() => dispatch({ type: 'mode', mode: 'text' })}
          >
            粘贴正文
          </KdyChip>
        </View>

        {state.mode === 'link' ? (
          <KdyField
            label='公众号文章链接'
            name='wechatLink'
            required
            value={state.link}
            onChange={(value) => dispatch({ type: 'link', value })}
            error={state.fieldError}
            placeholder='https://mp.weixin.qq.com/s/…'
            maxLength={2048}
            hint='只支持 mp.weixin.qq.com 的单篇文章'
          />
        ) : (
          <KdyField
            label='文章正文'
            name='wechatText'
            required
            value={state.text}
            onChange={(value) => dispatch({ type: 'text', value })}
            error={state.fieldError}
            placeholder='粘贴这一篇的活动说明（只保留 ≤200 字证据片段）'
            multiline
            maxLength={20000}
            hint='正文里不要夹带第二篇公众号链接'
          />
        )}

        <View className='kdy-activity-import__actions'>
          <KdyButton block loading={state.submitting} onClick={() => void handleSubmit()}>
            导入为候选活动
          </KdyButton>
        </View>
        <View className='kdy-activity-import__actions'>
          <KdyButton block onClick={() => void navigateTo(activityHistoryPath())}>
            从「历史消息」页批量挑文章
          </KdyButton>
        </View>

        {state.notice !== null ? (
          <View className='kdy-activity-import__ok' aria-label={state.notice}>
            {state.notice}
          </View>
        ) : null}
        {state.error !== null ? (
          <View className='kdy-activity-import__error' aria-label={state.error}>
            {state.error}
          </View>
        ) : null}
      </KdyCard>

      {state.results.length > 0 ? (
        <KdyCard title='导入结果' extra={<KdyTag tone='brand'>待确认</KdyTag>} elevated={false}>
          {state.results.map((result) => (
            <View key={result.id} className='kdy-activity-import__result'>
              <Text className='kdy-activity-import__result-title'>{result.title}</Text>
              <View className='kdy-activity-import__actions'>
                <KdyButton block onClick={() => void navigateTo(activityDetailPath(result.id))}>
                  查看并确认
                </KdyButton>
              </View>
            </View>
          ))}
          <Text className='kdy-activity-import__hint'>
            已保存活动字段与证据片段；邮件正文与公众号全文不会进入小程序。
          </Text>
        </KdyCard>
      ) : null}

      <Text className='kdy-disclaimer'>
        第三方非官方平台 · 与上海科技大学官方系统无关。请只导入你有权查看的内容。
      </Text>
    </View>
  )
}
