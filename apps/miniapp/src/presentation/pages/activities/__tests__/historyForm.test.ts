import { describe, expect, it } from 'vitest'

import {
  defaultSelection,
  historyFormReducer,
  initialHistoryFormState,
  selectedArticles,
  type HistoryFormState,
} from '../history/historyForm'
import type { WechatHistoryPage } from '../../../../domain/models/wechatHistory'

/**
 * 历史消息页导入的状态机。
 *
 * 这里守的是三条「点进去才发现不对」的边界：
 *   · 默认只勾主条（副条是「附：报名表」这类噪音）；
 *   · 解析失败要解除 loading，不能把按钮卡死；
 *   · 一篇失败不能拖垮整批，且失败原因要能说清是哪一篇。
 */

const page: WechatHistoryPage = {
  accountName: '上科大信息学院',
  biz: null,
  articles: [
    {
      title: '校园马拉松',
      url: 'https://mp.weixin.qq.com/s/a',
      publishedAt: '2026-11-24T00:00:00.000Z',
      digest: '11 月 30 日开跑',
      coverUrl: null,
      isHeadline: true,
    },
    {
      title: '名师讲坛',
      url: 'https://mp.weixin.qq.com/s/b',
      publishedAt: '2026-11-22T00:00:00.000Z',
      digest: null,
      coverUrl: null,
      isHeadline: true,
    },
    {
      title: '附：报名表',
      url: 'https://mp.weixin.qq.com/s/c',
      publishedAt: '2026-11-22T00:00:00.000Z',
      digest: null,
      coverUrl: null,
      isHeadline: false,
    },
  ],
}

function reduce(
  actions: Parameters<typeof historyFormReducer>[1][],
  from: HistoryFormState = initialHistoryFormState,
): HistoryFormState {
  return actions.reduce(historyFormReducer, from)
}

describe('历史消息页状态机', () => {
  it('默认只勾主条', () => {
    expect(defaultSelection(page)).toEqual([
      'https://mp.weixin.qq.com/s/a',
      'https://mp.weixin.qq.com/s/b',
    ])
  })

  it('解析成功后按主条预选，并给出篇数提示', () => {
    const state = reduce([{ type: 'parse-success', page }])
    expect(state.selected).toHaveLength(2)
    expect(state.notice).toContain('3 篇')
  })

  it('解析失败解除 loading，错误可上屏', () => {
    const state = reduce([
      { type: 'parse-start' },
      { type: 'parse-failure', message: '这个页面里没有历史文章列表' },
    ])
    expect(state.parsing).toBe(false)
    expect(state.error).toBe('这个页面里没有历史文章列表')
    expect(state.page).toBeNull()
  })

  it('切换勾选是幂等的：点两次回到未选', () => {
    const base = reduce([{ type: 'parse-success', page }])
    const once = historyFormReducer(base, { type: 'toggle', url: 'https://mp.weixin.qq.com/s/c' })
    expect(once.selected).toContain('https://mp.weixin.qq.com/s/c')
    const twice = historyFormReducer(once, { type: 'toggle', url: 'https://mp.weixin.qq.com/s/c' })
    expect(twice.selected).not.toContain('https://mp.weixin.qq.com/s/c')
  })

  it('selectedArticles 保持页面顺序而不是勾选顺序', () => {
    const base = reduce([
      { type: 'parse-success', page },
      { type: 'toggle', url: 'https://mp.weixin.qq.com/s/c' },
    ])
    expect(selectedArticles(base).map((article) => article.title)).toEqual([
      '校园马拉松',
      '名师讲坛',
      '附：报名表',
    ])
  })

  it('部分失败时保留成功计数，并逐条列出失败原因', () => {
    const state = reduce([
      { type: 'parse-success', page },
      { type: 'import-start' },
      { type: 'import-result', imported: 2, failures: ['附：报名表：链接不合法'] },
    ])
    expect(state.importing).toBe(false)
    expect(state.imported).toBe(2)
    expect(state.notice).toContain('已导入 2 篇')
    expect(state.error).toContain('附：报名表：链接不合法')
  })

  it('全部失败时不谎称导入成功', () => {
    const state = reduce([
      { type: 'parse-success', page },
      { type: 'import-start' },
      { type: 'import-result', imported: 0, failures: ['a：失败', 'b：失败'] },
    ])
    expect(state.notice).toBeNull()
    expect(state.error).toContain('2 篇没导入成功')
  })

  it('重新解析会清掉上一次的勾选与计数', () => {
    const withOld = reduce([
      { type: 'parse-success', page },
      { type: 'toggle', url: 'https://mp.weixin.qq.com/s/c' },
      { type: 'import-result', imported: 1, failures: [] },
    ])
    const parsing = historyFormReducer(withOld, { type: 'parse-start' })
    expect(parsing.selected).toEqual([])
    expect(parsing.imported).toBe(0)
    expect(parsing.page).toBeNull()
  })
})
