import type { Result } from '@kedaya/shared'

import type {
  CampusCardBindCredential,
  CampusCardPaymentCode,
  CampusCardTransaction,
} from '../models/campusCard'
import type { CampusBindingSummary, CampusCapability, CampusPlatform } from '../models/techpie'
import type { RepositoryError } from './errors'

/**
 * TechPie / 校园能力仓储端口（规格 §8.1 端点总表）。
 *
 * 契约 §7 硬规则 3：所有网络访问必须经过 `data/api/`，
 * `presentation` 禁止直接发请求，只能通过用例层调用本端口。
 *
 * ## 路径映射
 *
 * ```
 * GET    /techpie/links                  列出我的全部绑定（**不含凭证**）
 * POST   /techpie/links                  发起绑定（**必需 Idempotency-Key**）
 * GET    /techpie/links/:id              绑定详情
 * DELETE /techpie/links/:id              解绑
 * POST   /techpie/links/:id/renew        手动续期（契约 §11.2 冻结 action：`renew`）
 * GET    /techpie/capabilities           能力清单（未绑定项**不是错误**）
 *
 * GET    /campus-card/items              校园卡流水（游标分页，冻结契约）
 * POST   /campus-card/payment-code       付款码（⚠️ **尚未登记进冻结契约**，见下）
 * ```
 *
 * ## ⚠️ 本端**刻意不实现** `POST /techpie/webview-session`
 *
 * 契约 §11.10-F 裁决：微信小程序的 `web-view` **无法注入 cookie**，
 * 因此契约不变式 **I3 在小程序端没有出口**。
 * 小程序端的校园系统访问走 **W4** —— 用户在校园系统页面里**自己登录**，
 * 我们不接触 cookie（见 `presentation/pages/techpie/webview`）。
 *
 * 本端口因此**没有** `cookieHeaderFor` / `webviewSession` / 任何票据方法：
 * 不是"忘了实现"，而是**平台能力边界**（契约 §11.10-F 的原话）。
 * `src/__tests__/techpie-no-cookie-injection.test.ts` 会用静态扫描把这条钉死。
 */

export interface ListBindingsQuery {
  /** 游标**原样透传**（契约 §11.10-E：客户端不解析、不构造） */
  cursor?: string | null
  limit?: number
}

export interface CampusBindingPage {
  items: CampusBindingSummary[]
  nextCursor: string | null
  total?: number
}

/**
 * 发起绑定的输入。
 *
 * ⚠️ Phase 0 **只允许** `provider: 'ecard'`（校园卡 OPENID 通道）。
 * 其余平台在信息办书面回复前不实现（契约 §11.18-D）。
 */
export interface CreateCampusBindingInput {
  provider: CampusPlatform
  /**
   * 校园卡 OPENID 通道凭证。
   *
   * 它是 `wx.login` 的**一次性 code**，不是 openid，也不是密码 ——
   * 详见 `domain/models/campusCard.ts` 的 `CampusCardBindCredential`。
   */
  credential?: CampusCardBindCredential
}

export interface CampusCardTransactionPage {
  items: CampusCardTransaction[]
  nextCursor: string | null
  total?: number
}

export interface TechpieRepository {
  /* ---------------- techpie ---------------- */

  /** 列出我的全部绑定。返回的形状里**没有任何凭证字段** */
  listBindings(query?: ListBindingsQuery): Promise<Result<CampusBindingPage, RepositoryError>>

  /** 绑定详情（**不含凭证**） */
  bindingDetail(id: string): Promise<Result<CampusBindingSummary, RepositoryError>>

  /** 发起绑定（`POST` 必须带 `Idempotency-Key`，契约 §11.3） */
  createBinding(
    input: CreateCampusBindingInput,
    idempotencyKey?: string,
  ): Promise<Result<CampusBindingSummary, RepositoryError>>

  /** 解绑。服务端必须**真正删除**凭证副本，而不只是标记失效 */
  unbind(id: string, idempotencyKey?: string): Promise<Result<true, RepositoryError>>

  /** 手动续期（Phase 0 是手动；自动续期属 Phase 3，本轮不做） */
  renew(id: string, idempotencyKey?: string): Promise<Result<CampusBindingSummary, RepositoryError>>

  /** 能力清单。`available: false` **不是错误**（契约 I4） */
  capabilities(): Promise<Result<CampusCapability[], RepositoryError>>

  /* ---------------- campus-card（独立 OPENID 通道） ---------------- */

  /**
   * 校园卡流水。
   *
   * 余额**不单独请求**：冻结契约里没有余额端点，
   * 而 `CampusCardTxn.balanceFen` 是「交易后余额」，最新一笔即为当前余额
   * （见 `domain/models/campusCard.ts` 的 `deriveCardAccount`）。
   */
  cardTransactions(
    query?: ListBindingsQuery,
  ): Promise<Result<CampusCardTransactionPage, RepositoryError>>

  /**
   * 换取一次性付款码。
   *
   * ⚠️ **契约缺口**：该路径尚未登记进 `packages/contracts/openapi/kedaya.v1.yaml`
   * （见 `CAMPUS_CARD_PAYMENT_CODE_REGISTERED = false`）。
   * 端口先就位，避免接通时改动面扩散；UI 必须如实标注。
   */
  paymentCode(idempotencyKey?: string): Promise<Result<CampusCardPaymentCode, RepositoryError>>
}
