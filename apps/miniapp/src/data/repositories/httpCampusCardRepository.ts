import { modulePath } from '@kedaya/contracts'
import { err, ok, type Result } from '@kedaya/shared'

import { computeCardInsight } from '../../domain/models/cardInsight'
import type {
  CardLostReport,
  CardOverview,
  CardTransactionView,
} from '../../domain/models/campusCard'
import type { RepositoryError } from '../../domain/ports/errors'
import type { CampusCardRepository } from '../../domain/ports/campusCardRepository'
import type { ApiClient } from '../api/request'
import { toRepositoryError } from './toRepositoryError'

/**
 * 真后端校园卡仓储。
 *
 * ## ⚠️ 这个文件修的是一个**真实的 wire 错位**
 *
 * 此前 `overview()` 请求 `GET /campus-card/overview` —— **服务端没有这个端点**
 * （契约里校园卡只有 `/account`、`/account/activate`、`/transactions`、`/payment-code`）。
 * 真实后端下这个调用必然 404，于是"诚实的 503"用户也看不到。
 *
 * 现在按契约走两条真实端点，然后在**客户端组装** `CardOverview`：
 *
 * ```
 * GET /campus-card/account       → { activated, balanceFen, updatedAt? }
 * GET /campus-card/transactions  → { items: CampusCardTxn[] }
 *       ↓ 本地补 lowBalance / stale / insight / simulated
 * CardOverview
 * ```
 *
 * 为什么组装放在客户端而不是新增一个 `/overview` 端点：
 * - `lowBalance` 依赖**用户自己设的**阈值（`thresholdFen`），服务端不知道；
 * - `insight` 是纯统计（今天/本周/日均/中位数/异常/常去商户），
 *   放客户端可以随筛选条件即时重算，不必每次回源；
 * - 新增端点要改冻结契约，而这不是"缺少数据"，只是"缺少聚合"。
 *
 * ## `lostReport` 为什么是本地内容
 *
 * 契约里**没有**"报失校园卡"的端点（grep 过 OpenAPI 与后端，零命中）。
 * 报失是**校方渠道**的流程，可达鸭能做的是"告诉你走哪个流程"，
 * 这本质是**静态指引**，不需要也不应该有后端接口。
 * 此前它请求 `GET /campus-card/lost-report` —— 那个端点从来不存在。
 */

/** 服务端 `GET /campus-card/account` 的响应 */
interface AccountWire {
  activated: boolean
  balanceFen: number
  updatedAt?: string
  /** 服务端是否在给模拟数据（新字段；老服务端没有时按 false 处理） */
  simulated?: boolean
}

/** 服务端 `GET /campus-card/transactions` 的元素 */
interface TxnWire {
  id: string
  amountFen: number
  direction: string
  merchant: string
  occurredAt: string
  balanceAfterFen: number
}

interface TxnPageWire {
  items: TxnWire[]
  nextCursor: string | null
}

/** 行金额的符号文案：支出 `−15.00`、收入 `+200.00` */
function amountLabel(direction: string, amountFen: number): string {
  const yuan = (Math.abs(amountFen) / 100).toFixed(2)
  return direction === 'DEBIT' ? `−${yuan}` : `+${yuan}`
}

function toTransactionView(row: TxnWire): CardTransactionView {
  return {
    id: row.id,
    amountFen: row.amountFen,
    direction: row.direction,
    merchant: row.merchant,
    // 服务端字段名是 `occurredAt`（契约 §11.21-B 的裁决），客户端视图叫 `happenedAt`
    happenedAt: row.occurredAt,
    balanceAfterFen: row.balanceAfterFen,
    amountLabel: amountLabel(row.direction, row.amountFen),
  }
}

/** 报失指引 —— **静态内容，不依赖后端**。号码不编，以校方当前公布为准。 */
const LOST_REPORT_GUIDE = {
  accepted: false as const,
  steps: [
    '先在一网通办 / 校园卡服务里自助挂失（立即生效，防止被盗刷）',
    '带上学生证或身份证，到校园卡服务中心办理补卡',
    '补卡后原卡余额会转入新卡，通常需要 1 个工作日',
  ],
  channels: [
    { name: '校园卡服务中心', detail: '工作时间到窗口办理；具体位置与电话见校方通知' },
    { name: '自助终端', detail: '部分楼宇有自助补卡机，支持挂失与查询' },
  ],
  // 报失是**校方渠道**的动作，可达鸭没有也不该有审计权
  audited: false,
}

export function createHttpCampusCardRepository(client: ApiClient): CampusCardRepository {
  const base = modulePath('campus-card')

  return {
    async overview(thresholdFen = 2000): Promise<Result<CardOverview, RepositoryError>> {
      // 1) 余额（契约 `GET /campus-card/account`）
      const account = await client.get<AccountWire>(`${base}/account`)
      if (!account.ok) return err(toRepositoryError(account.error))

      const balanceFen = account.value.balanceFen ?? 0
      const dataAsOf = account.value.updatedAt ?? new Date().toISOString()
      const simulated = account.value.simulated === true

      // 未开通不是错误：给一个可渲染的空态，让页面引导去开通
      if (!account.value.activated) {
        return ok({
          platform: 'CARD',
          balanceFen,
          thresholdFen,
          lowBalance: false,
          dataAsOf,
          syncedAt: null,
          stale: false,
          staleReason: null,
          simulated,
          transactions: [],
          insight: computeCardInsight([], new Date()),
        })
      }

      // 2) 流水（契约 `GET /campus-card/transactions`）
      const txns = await client.get<TxnPageWire>(`${base}/transactions`, { limit: 50 })
      if (!txns.ok) {
        // 流水失败不该让整个卡片变错误态：余额已经拿到了，
        // 用 stale 标记"这是一份不完整的快照"，比整块报错有用
        return ok({
          platform: 'CARD',
          balanceFen,
          thresholdFen,
          lowBalance: balanceFen < thresholdFen,
          dataAsOf,
          syncedAt: null,
          stale: true,
          staleReason: toRepositoryError(txns.error).message,
          simulated,
          transactions: [],
          insight: computeCardInsight([], new Date()),
        })
      }

      const transactions = txns.value.items.map(toTransactionView)

      return ok({
        platform: 'CARD',
        balanceFen,
        thresholdFen,
        lowBalance: balanceFen < thresholdFen,
        dataAsOf,
        // 余额与流水都拿到了才算一次成功同步
        syncedAt: new Date().toISOString(),
        stale: false,
        staleReason: null,
        simulated,
        transactions,
        // insight 从**真实流水**算，不是从服务端拿 —— 服务端没有这个字段
        insight: computeCardInsight(transactions, new Date()),
      })
    },

    async lostReport(reason?: string): Promise<Result<CardLostReport, RepositoryError>> {
      // 本地静态指引（契约无此端点，见文件头注释）
      const hasReason = typeof reason === 'string' && reason.length > 0
      return ok({
        ...LOST_REPORT_GUIDE,
        note: hasReason
          ? `你填写的原因：${reason}。以下是挂失与补卡的流程（可达鸭只做指引，实际挂失请走校方渠道）。`
          : '以下是挂失与补卡的流程（可达鸭只做指引，实际挂失请走校方渠道）。',
      })
    },
  }
}
