import type { Result } from '@kedaya/shared'

import type {
  DormHarmonyCase,
  DormHarmonyCaseDetail,
  DormHarmonyMessageResult,
  SubmitDormHarmonyCaseInput,
  SubmitDormHarmonyCaseResult,
} from '../models/dormHarmony'
import type { RepositoryError } from './errors'

/**
 * 宿舍矛盾仓储端口 —— http / mock 两套实现（契约 §7 硬规则 3、4）。
 *
 * 端点形状（与后端 `dorm-harmony.controller.ts` 一一对应）：
 * ```
 * GET    /dorm-harmony/cases            不提供公开列表（返回 403）
 * POST   /dorm-harmony/cases            匿名提交，一次性返回 { case, trackCode }
 * GET    /dorm-harmony/cases/:id?trackCode=…   查看详情 + 留言
 * POST   /dorm-harmony/cases/:id/messages      学生追加留言
 * POST   /dorm-harmony/cases/:id/close         学生结案
 * POST   /dorm-harmony/cases/:id/mediator-reply 调解员回复（唯一需要登录的入口）
 * ```
 *
 * 两个刻意的设计：
 *   · **没有 `list()`**。后端不提供公开列表（会泄漏全校议题分布），
 *     端口里也就没有这个方法 —— 少一个方法比多一条注释更能防住「顺手列一下」。
 *   · **读操作要 (caseId, trackCode) 两项**。地址是 `:id`，能力是 `trackCode`；
 *     只有 `trackCode` 而没有 `caseId` 时，服务端无处可寻（它刻意不提供反查接口）。
 *     客户端的做法是把两者一起存在本地（见 `dormHarmonyUseCases.savedCases()`）。
 */

export interface TrackDormHarmonyCaseQuery {
  /** 案子 id —— 地址的一部分，**不是**秘密（但离开本机前也没人会知道） */
  caseId: string
  /** 一次性追踪码 —— 真正的凭据，服务端只存 sha256 */
  trackCode: string
}

export interface DormHarmonyRepository {
  submit(
    input: SubmitDormHarmonyCaseInput,
  ): Promise<Result<SubmitDormHarmonyCaseResult, RepositoryError>>

  /** 出示追踪码查看详情（含留言）。追踪码错误 / 案子不存在 → 同一个 FORBIDDEN 文案 */
  track(
    query: TrackDormHarmonyCaseQuery,
  ): Promise<Result<DormHarmonyCaseDetail, RepositoryError>>

  postMessage(
    query: TrackDormHarmonyCaseQuery & { body: string },
  ): Promise<Result<DormHarmonyMessageResult, RepositoryError>>

  close(query: TrackDormHarmonyCaseQuery): Promise<Result<DormHarmonyCase, RepositoryError>>

  /**
   * 调解员回复 —— 本模块**唯一**需要登录的写入口（校方工作人员实名回复是职责）。
   * 客户端页面不暴露它（学生没有这个身份），保留是为了与后端 controller 逐条对齐。
   */
  mediatorReply(
    caseId: string,
    body: string,
  ): Promise<Result<DormHarmonyMessageResult, RepositoryError>>
}
