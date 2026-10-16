/**
 * 列表四态选择器（application 层，纯函数）。
 *
 * 契约 §8 要求「失败静默降级而非白屏」，所以 UI 必须显式区分四态。
 * 把这个判定收敛成一个纯函数，好处是**三态可以被真实单测覆盖**，
 * 而不是散落在各组件里靠人工点页面确认。
 *
 * 依赖方向：application 不 import React / TanStack Query，只吃布尔入参。
 */

export type ViewState = 'loading' | 'error' | 'empty' | 'ready';

export interface ViewStateInput {
  /** 首次加载中（TanStack Query 的 `isPending`） */
  isPending: boolean;
  /** 请求失败（`isError`） */
  isError: boolean;
  /** 成功但结果为空 */
  isEmpty: boolean;
}

/**
 * 优先级：loading > error > empty > ready。
 *
 * 注意：`error` 态**不排斥**已有数据 —— 组件在 error 时仍会渲染上一次成功的数据，
 * 这里返回 'error' 只表示"需要展示错误提示与重试入口"。
 */
export function deriveViewState(input: ViewStateInput): ViewState {
  if (input.isPending) return 'loading';
  if (input.isError) return 'error';
  if (input.isEmpty) return 'empty';
  return 'ready';
}

/** 四态的中文兜底文案（组件可用自己的更具体文案覆盖） */
export const VIEW_STATE_LABELS: Record<ViewState, string> = {
  loading: '加载中…',
  error: '加载失败',
  empty: '暂无数据',
  ready: '',
};

/** 是否应该渲染骨架屏 */
export function showsSkeleton(state: ViewState): boolean {
  return state === 'loading';
}

/** 是否应该渲染错误提示 + 重试入口 */
export function showsError(state: ViewState): boolean {
  return state === 'error';
}

/** 是否应该渲染空态引导 */
export function showsEmpty(state: ViewState): boolean {
  return state === 'empty';
}
