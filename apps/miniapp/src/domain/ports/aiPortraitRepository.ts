import type { Result } from '@kedaya/shared'

import type {
  AiPortraitProfilePayload,
  AiPortraitServerConsent,
  AiPortraitSourcesPayload,
} from '../models/aiPortrait'
import type { RepositoryError } from './errors'

/**
 * AI 校园画像仓储端口 —— http / mock 两套实现（契约 §7 硬规则 3、4）。
 *
 * 端点形状（与后端 `ai-portrait.controller.ts` 一一对应，
 * 控制器挂在 `modulePath('ai-portrait')` 下，**没有** `items` 列表段）：
 * ```
 * GET    /ai-portrait/sources    公开：允许 / 禁止的数据来源清单 + 接入现状（可解释性）
 * GET    /ai-portrait/consents   我的同意记录（含已撤回的历史条目）
 * POST   /ai-portrait/consents   二次同意（幂等）
 * DELETE /ai-portrait/consents   撤回同意（幂等，返回被撤回的记录或 null）
 * GET    /ai-portrait/me         我的画像（无同意 → CONSENT_REQUIRED；无画像 → null）
 * PATCH  /ai-portrait/me         开启 / 关闭画像（body 只有 enabled）
 * ```
 *
 * 刻意**没有**的方法（不是漏了）：
 *   · 没有 `list` —— 画像永远按主体寻址，不存在"看别人的画像"的合法路径，
 *     后端也没有可分页的画像列表端点；
 *   · 没有 `upsert`（写画像）—— 那条 `POST /items` 是给服务端受信的生成流程用的。
 *     客户端只读画像：**客户端不允许编造标签**，所以连入口都不开。
 */
export interface AiPortraitRepository {
  /** 我的画像；`null` = 还没有画像（后端尚无生成逻辑时这是常态，页面走空态） */
  me(): Promise<Result<AiPortraitProfilePayload | null, RepositoryError>>
  /** 公开的来源清单（不依赖登录与同意，因此"哪些数据不参与"永远能显示） */
  sources(): Promise<Result<AiPortraitSourcesPayload, RepositoryError>>
  /** 我的同意记录（含已撤回的历史条目） */
  consents(): Promise<Result<AiPortraitServerConsent[], RepositoryError>>
  /** 二次同意（幂等） */
  grantConsent(): Promise<Result<AiPortraitServerConsent, RepositoryError>>
  /** 撤回同意（幂等；没有记录时返回 null） */
  revokeConsent(): Promise<Result<AiPortraitServerConsent | null, RepositoryError>>
  /** 开启 / 关闭画像（只改开关，不动数据） */
  setEnabled(enabled: boolean): Promise<Result<AiPortraitProfilePayload, RepositoryError>>
}
