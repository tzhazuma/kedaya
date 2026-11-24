/**
 * 公众号「历史消息」页解析结果。
 *
 * 数据来源是**用户自己保存的页面**（他在微信里本来就能看见），
 * 服务端只做 `msgList` 的解析，不抓取、不带 Cookie、不绕过验证。
 *
 * 形状归一化放在这里而不是页面里：坏字段要在进 UI 之前就被挡掉，
 * 否则页面得为每一条写一遍判空。
 */

/** 一篇历史文章。 */
export interface WechatHistoryArticle {
  title: string
  url: string
  /** ISO 8601 UTC */
  publishedAt: string
  digest: string | null
  coverUrl: string | null
  /** 一次推送的主条为 true，副条为 false。 */
  isHeadline: boolean
}

export interface WechatHistoryPage {
  accountName: string | null
  biz: string | null
  articles: WechatHistoryArticle[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

function isoOrNull(value: unknown): string | null {
  const raw = text(value)
  if (raw === null) return null
  const parsed = new Date(raw)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

/**
 * 归一化一条文章。
 *
 * 标题或链接缺失就**整条丢弃**：没有链接的条目在小程序里点不动，
 * 留在列表里只会让用户以为「点这里就行」。
 */
export function normalizeWechatHistoryArticle(raw: unknown): WechatHistoryArticle | null {
  if (!isRecord(raw)) return null
  const title = text(raw.title)
  const url = text(raw.url)
  const publishedAt = isoOrNull(raw.publishedAt)
  if (title === null || url === null || publishedAt === null) return null
  if (!/^https?:\/\//i.test(url)) return null

  return {
    title,
    url,
    publishedAt,
    digest: text(raw.digest),
    coverUrl: text(raw.coverUrl),
    isHeadline: raw.isHeadline !== false,
  }
}

/** 归一化整页结果；坏条目被丢弃并计数。 */
export function normalizeWechatHistoryPage(raw: unknown): {
  page: WechatHistoryPage | null
  dropped: number
} {
  if (!isRecord(raw) || !Array.isArray(raw.items)) return { page: null, dropped: 0 }

  const articles: WechatHistoryArticle[] = []
  let dropped = 0
  for (const item of raw.items) {
    const article = normalizeWechatHistoryArticle(item)
    if (article === null) {
      dropped += 1
      continue
    }
    articles.push(article)
  }

  return {
    page: {
      accountName: text(raw.accountName),
      biz: text(raw.biz),
      articles,
    },
    dropped,
  }
}
