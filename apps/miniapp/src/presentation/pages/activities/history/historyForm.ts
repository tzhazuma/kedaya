import type { WechatHistoryArticle, WechatHistoryPage } from '../../../../domain/models/wechatHistory'

/**
 * 历史消息页导入的状态机。
 *
 * 三条由状态机保证的边界（和单篇导入页同一套思路）：
 *   · 解析 / 导入抛错也要解除 loading（按钮不能卡死）；
 *   · 默认只勾**主条**：副条多是「附：报名表」这类，一起勾会把待确认列表变成噪音；
 *   · 没有「全选并全部导入」：一次十几条会让用户反过来逐条删。
 */

export interface HistoryFormState {
  html: string
  parsing: boolean
  importing: boolean
  /** 服务端 / 网络错误 */
  error: string | null
  notice: string | null
  page: WechatHistoryPage | null
  /** 勾选的文章 url（url 是这一页里唯一的稳定标识） */
  selected: string[]
  /** 本轮已成功导入的篇数 */
  imported: number
}

export const initialHistoryFormState: HistoryFormState = {
  html: '',
  parsing: false,
  importing: false,
  error: null,
  notice: null,
  page: null,
  selected: [],
  imported: 0,
}

export type HistoryFormAction =
  | { type: 'html'; value: string }
  | { type: 'parse-start' }
  | { type: 'parse-success'; page: WechatHistoryPage }
  | { type: 'parse-failure'; message: string }
  | { type: 'parse-end' }
  | { type: 'toggle'; url: string }
  | { type: 'import-start' }
  | { type: 'import-progress'; imported: number }
  | { type: 'import-result'; imported: number; failures: string[] }
  | { type: 'import-end' }

/** 默认勾选：只勾主条。 */
export function defaultSelection(page: WechatHistoryPage): string[] {
  return page.articles.filter((article) => article.isHeadline).map((article) => article.url)
}

export function selectedArticles(state: HistoryFormState): WechatHistoryArticle[] {
  const page = state.page
  if (page === null) return []
  return page.articles.filter((article) => state.selected.includes(article.url))
}

export function historyFormReducer(
  state: HistoryFormState,
  action: HistoryFormAction,
): HistoryFormState {
  switch (action.type) {
    case 'html':
      return { ...state, html: action.value, error: null }
    case 'parse-start':
      return {
        ...state,
        parsing: true,
        error: null,
        notice: null,
        page: null,
        selected: [],
        imported: 0,
      }
    case 'parse-success':
      return {
        ...state,
        parsing: false,
        page: action.page,
        selected: defaultSelection(action.page),
        notice:
          action.page.articles.length === 0
            ? null
            : `识别到 ${action.page.articles.length} 篇，已默认勾选主条。`,
      }
    case 'parse-failure':
      return { ...state, parsing: false, error: action.message }
    case 'parse-end':
      return { ...state, parsing: false }
    case 'toggle': {
      const selected = state.selected.includes(action.url)
        ? state.selected.filter((url) => url !== action.url)
        : [...state.selected, action.url]
      return { ...state, selected }
    }
    case 'import-start':
      return { ...state, importing: true, error: null, notice: null, imported: 0 }
    case 'import-progress':
      return { ...state, imported: action.imported }
    case 'import-result': {
      const failures = action.failures
      return {
        ...state,
        importing: false,
        imported: action.imported,
        error: failures.length === 0 ? null : `${failures.length} 篇没导入成功\n${failures.join('\n')}`,
        notice:
          action.imported === 0
            ? null
            : `已导入 ${action.imported} 篇候选活动。确认后才加入日程，也才会建提醒。`,
      }
    }
    case 'import-end':
      return { ...state, importing: false }
    default:
      return state
  }
}
