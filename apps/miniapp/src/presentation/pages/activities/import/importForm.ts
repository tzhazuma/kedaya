import type { ActivityItem } from '../../../../domain/models/activity'

/**
 * 公众号导入页的状态机。
 *
 * 三个必须由状态机保证的边界：
 *   · 请求抛错也要在 `finally` 里解除 `submitting`（按钮不能卡死）；
 *   · 成功后清空正文 / 链接（否则用户会重复导入同一篇）；
 *   · 切换模式清掉上一种模式的错误（链接模式的错误不该挂在正文模式上）。
 */

export type ImportMode = 'link' | 'text'

export interface ImportFormState {
  mode: ImportMode
  link: string
  text: string
  /** 服务端 / 网络错误 */
  error: string | null
  /** 客户端字段校验错误（显示在输入框下） */
  fieldError: string | null
  notice: string | null
  submitting: boolean
  results: ActivityItem[]
}

export const initialImportFormState: ImportFormState = {
  mode: 'link',
  link: '',
  text: '',
  error: null,
  fieldError: null,
  notice: null,
  submitting: false,
  results: [],
}

export type ImportFormAction =
  | { type: 'mode'; mode: ImportMode }
  | { type: 'link'; value: string }
  | { type: 'text'; value: string }
  | { type: 'submit-start' }
  | { type: 'submit-invalid'; message: string }
  | { type: 'submit-success'; items: ActivityItem[] }
  | { type: 'submit-failure'; message: string }
  | { type: 'submit-end' }

export function importFormReducer(
  state: ImportFormState,
  action: ImportFormAction,
): ImportFormState {
  switch (action.type) {
    case 'mode':
      return {
        ...state,
        mode: action.mode,
        error: null,
        fieldError: null,
        notice: null,
      }
    case 'link':
      return { ...state, link: action.value, fieldError: null }
    case 'text':
      return { ...state, text: action.value, fieldError: null }
    case 'submit-start':
      return { ...state, submitting: true, error: null, fieldError: null, notice: null }
    case 'submit-invalid':
      return { ...state, submitting: false, error: null, fieldError: action.message, notice: null }
    case 'submit-success':
      return {
        ...state,
        submitting: false,
        link: '',
        text: '',
        error: null,
        fieldError: null,
        results: action.items,
        notice:
          action.items.length > 1
            ? `已导入 ${action.items.length} 条候选活动。确认后才加入日程，也才会建提醒。`
            : '已导入为候选活动。确认后才加入日程，也才会建提醒。',
      }
    case 'submit-failure':
      return { ...state, submitting: false, error: action.message }
    case 'submit-end':
      return { ...state, submitting: false }
    default:
      return state
  }
}
