import { describe, expect, it } from 'vitest'

import {
  normalizeWechatHistoryArticle,
  normalizeWechatHistoryPage,
} from '../wechatHistory'

/**
 * 历史页结果的形状归一化。
 *
 * 坏条目必须在这里被丢掉：留到页面里，用户会看到点不动的空条目。
 */
describe('normalizeWechatHistoryArticle', () => {
  const good = {
    title: '校园马拉松',
    url: 'https://mp.weixin.qq.com/s/a',
    publishedAt: '2026-11-24T00:00:00.000Z',
  }

  it('正常条目原样通过，缺省字段补 null', () => {
    const article = normalizeWechatHistoryArticle(good)
    expect(article).not.toBeNull()
    expect(article?.digest).toBeNull()
    expect(article?.coverUrl).toBeNull()
    expect(article?.isHeadline).toBe(true)
  })

  it('isHeadline 显式 false 时保留 false', () => {
    expect(normalizeWechatHistoryArticle({ ...good, isHeadline: false })?.isHeadline).toBe(false)
  })

  it('缺标题 / 缺链接 / 链接非 http 都整条丢弃', () => {
    expect(normalizeWechatHistoryArticle({ ...good, title: '  ' })).toBeNull()
    expect(normalizeWechatHistoryArticle({ ...good, url: '' })).toBeNull()
    expect(normalizeWechatHistoryArticle({ ...good, url: 'javascript:alert(1)' })).toBeNull()
  })

  it('时间不可解析时丢弃（日历与排序都要它）', () => {
    expect(normalizeWechatHistoryArticle({ ...good, publishedAt: 'not-a-date' })).toBeNull()
    expect(normalizeWechatHistoryArticle({ ...good, publishedAt: undefined })).toBeNull()
  })

  it('时间统一成 UTC ISO', () => {
    const article = normalizeWechatHistoryArticle({
      ...good,
      publishedAt: '2026-11-24T08:00:00+08:00',
    })
    expect(article?.publishedAt).toBe('2026-11-24T00:00:00.000Z')
  })
})

describe('normalizeWechatHistoryPage', () => {
  it('不是对象或没有 items 时返回 null', () => {
    expect(normalizeWechatHistoryPage(null).page).toBeNull()
    expect(normalizeWechatHistoryPage({}).page).toBeNull()
    expect(normalizeWechatHistoryPage({ items: 'x' }).page).toBeNull()
  })

  it('坏条目被丢弃并计数，好条目保留', () => {
    const { page, dropped } = normalizeWechatHistoryPage({
      accountName: '上科大信息学院',
      items: [
        {
          title: '好的',
          url: 'https://mp.weixin.qq.com/s/a',
          publishedAt: '2026-11-24T00:00:00.000Z',
        },
        { title: '没有链接', publishedAt: '2026-11-24T00:00:00.000Z' },
      ],
    })
    expect(page?.articles).toHaveLength(1)
    expect(page?.accountName).toBe('上科大信息学院')
    expect(dropped).toBe(1)
  })

  it('空 items 返回空列表而不是 null（由调用方决定文案）', () => {
    const { page } = normalizeWechatHistoryPage({ items: [] })
    expect(page?.articles).toEqual([])
  })
})
