import { Text, View } from '@tarojs/components'
import { useReducer } from 'react'

import { getContainer } from '../../../../app/container'
import { navigateTo } from '../../../../platform/navigation'
import { KdyButton, KdyCard, KdyChip, KdyTag } from '../../../components'
import { KdyField } from '../../../components/KdyField'
import { KdyHeading } from '../../../components/KdyHeading'
import {
  historyFormReducer,
  initialHistoryFormState,
  selectedArticles,
} from './historyForm'
import './index.scss'

/**
 * 从「历史消息」页批量挑文章。
 *
 * 输入是**用户自己保存的页面**：他在微信里本来就能看到这页内容。
 * 服务端只解析 `msgList`，不抓取、不带 Cookie、不绕过验证。
 *
 * 自动获取那一页需要微信客户端内部的会话 Cookie（`wap_sid2`），
 * 那等于逆向客户端 —— 这条不做。
 */

export default function ActivityHistoryPage() {
  const activities = getContainer().useCases.activities
  const [state, dispatch] = useReducer(historyFormReducer, initialHistoryFormState)
  const picked = selectedArticles(state)
  const page = state.page

  async function handleParse(): Promise<void> {
    if (state.parsing || state.importing) return
    if (state.html.trim() === '') {
      dispatch({ type: 'parse-failure', message: '先把页面内容粘贴进来' })
      return
    }
    dispatch({ type: 'parse-start' })
    try {
      const parsed = await activities.parseWechatHistory(state.html)
      if (!parsed.ok) {
        dispatch({ type: 'parse-failure', message: parsed.error.message })
        return
      }
      dispatch({ type: 'parse-success', page: parsed.value })
    } finally {
      dispatch({ type: 'parse-end' })
    }
  }

  async function handleImport(): Promise<void> {
    if (state.importing || picked.length === 0) return
    dispatch({ type: 'import-start' })

    let imported = 0
    const failures: string[] = []
    try {
      for (const article of picked) {
        // 只传链接：契约要求 url 与 text 二选一，同时给会被判成入参错误。
        const result = await activities.importWechat({ link: article.url })
        if (!result.ok) {
          // 一篇失败不拖垮整批：其余继续，最后统一报哪几篇没进去。
          failures.push(`${article.title}：${result.error.message}`)
          continue
        }
        imported += 1
        dispatch({ type: 'import-progress', imported })
      }
    } finally {
      dispatch({ type: 'import-result', imported, failures })
    }
  }

  return (
    <View className='kdy-page kdy-activity-history'>
      <KdyHeading
        title='从历史消息导入'
        subtitle='粘贴你在微信里保存的「查看历史消息」页；我们只解析你贴进来的内容。'
      />

      <KdyCard elevated={false}>
        <KdyField
          label='历史消息页内容'
          name='wechatHistoryHtml'
          value={state.html}
          onChange={(value) => dispatch({ type: 'html', value })}
          placeholder='在微信里打开公众号 →「查看历史消息」→ 复制页面内容粘贴到这里'
          multiline
          maxLength={200000}
          hint='不抓取、不带 Cookie、不绕过验证；导入的每一篇都要你确认后才进日程'
        />

        <View className='kdy-activity-history__actions'>
          <KdyButton block loading={state.parsing} onClick={() => void handleParse()}>
            解析出文章列表
          </KdyButton>
        </View>

        {state.error !== null ? (
          <View className='kdy-activity-history__error' aria-label={state.error}>
            {state.error}
          </View>
        ) : null}
        {state.notice !== null ? (
          <View className='kdy-activity-history__notice' aria-label={state.notice}>
            {state.notice}
          </View>
        ) : null}
      </KdyCard>

      {page !== null && page.articles.length > 0 ? (
        <KdyCard
          title={page.accountName ?? '识别到的文章'}
          extra={<KdyTag tone='brand'>待确认</KdyTag>}
          elevated={false}
        >
          <Text className='kdy-activity-history__count'>
            已选 {picked.length} / {page.articles.length}
          </Text>

          {page.articles.map((article) => {
            const active = state.selected.includes(article.url)
            return (
              <View key={article.url} className='kdy-activity-history__row'>
                <View className='kdy-activity-history__modes'>
                  <KdyChip
                    active={active}
                    onClick={() => {
                      if (state.importing) return
                      dispatch({ type: 'toggle', url: article.url })
                    }}
                  >
                    {active ? '已选' : '选择'}
                  </KdyChip>
                </View>
                <Text className='kdy-activity-history__row-title'>{article.title}</Text>
                <Text className='kdy-activity-history__row-meta'>
                  {formatDate(article.publishedAt)}
                  {article.digest === null ? '' : ` · ${article.digest}`}
                </Text>
              </View>
            )
          })}

          <View className='kdy-activity-history__actions'>
            <KdyButton
              block
              loading={state.importing}
              disabled={picked.length === 0}
              onClick={() => void handleImport()}
            >
              {state.importing
                ? `正在导入 ${state.imported} / ${picked.length}`
                : `导入选中的 ${picked.length} 篇`}
            </KdyButton>
          </View>

          <Text className='kdy-activity-history__hint'>
            {picked.length === 0
              ? '至少勾一篇再导入。'
              : '导入后仍要在详情页确认；未确认的活动不会生成提醒。'}
          </Text>
        </KdyCard>
      ) : null}

      <Text className='kdy-disclaimer'>
        第三方非官方平台 · 与上海科技大学官方系统无关。请只导入你有权查看的内容。
      </Text>
    </View>
  )
}

function formatDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}
