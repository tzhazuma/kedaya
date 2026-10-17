import type { CampusCardTransaction } from '../../domain/models/campusCard'
import type { CampusBindingSummary, CampusCapability } from '../../domain/models/techpie'

/**
 * TechPie / 校园能力的 mock 种子数据（契约 §7 硬规则 4：无后端也能开发）。
 *
 * ## 为什么默认种子是**空**的
 *
 * Phase 0 的新用户**就是**「已登录但未绑定」——这是契约 §5 硬规则 3 明确
 * 承认为**合法状态**的那个状态。把它设成默认，有三个好处：
 *
 * 1. 打开能力清单页就能看到 `CAMPUS_BINDING_REQUIRED` 被渲染成**引导**
 *    （而不是红色报错）—— 这正是本模块最容易做错的地方；
 * 2. 绑定管理页的**空态**是真实空态，不是硬编码的假状态；
 * 3. 用户点「绑定校园卡」后能**真实**观察到引导 → 可用的状态迁移。
 *
 * 「已绑定 / 已过期 / 错误」三种演示状态由 mock 控制面按需注入
 * （`mockTechpieRepository.ts` 的 `seedEcardBinding` / `expireAll` 等），
 * 而不是塞进种子 —— 硬编码的假状态会掩盖真实的状态机 bug。
 */

/** 默认：**没有任何绑定**（未绑定是合法状态，不是错误） */
export const MOCK_BINDINGS: readonly CampusBindingSummary[] = []

/** 演示用：一张已绑定的校园卡（OPENID 通道，**不含任何凭证**） */
export const MOCK_ECARD_BINDING: CampusBindingSummary = {
  id: 'tpl-ecard-0001',
  provider: 'ecard',
  status: 'ACTIVE',
  displayName: null,
  boundAt: '2026-10-17T01:30:00.000Z',
  expiresAt: null,
  lastSyncAt: '2026-10-17T01:30:00.000Z',
  phase: 'phase0',
}

/** 演示用：一条**已过期**的 eGate 绑定（Phase 1 的历史遗留数据） */
export const MOCK_EXPIRED_EGATE_BINDING: CampusBindingSummary = {
  id: 'tpl-egate-0001',
  provider: 'egate',
  status: 'EXPIRED',
  displayName: '2023XXXXXX',
  boundAt: '2026-09-20T02:00:00.000Z',
  expiresAt: '2026-10-15T02:00:00.000Z',
  lastSyncAt: '2026-10-14T02:00:00.000Z',
  phase: 'phase1',
}

/**
 * 能力清单（服务端视角）。
 *
 * ⚠️ 三条硬规则体现在数据里，改数据前请先读：
 *
 * 1. **Phase 0 的 WebView 能力 `requiredProvider` 为 `null`** ——
 *    契约 §11.10-F 的 W4：用户在校园系统页面**自己登录**，不需要我们代持会话，
 *    因此不存在「绑定 eGate 才能用请假」这种话术（那是 Phase 1 的事）。
 * 2. **`campus_card` 需要 `ecard`** —— 校园卡走独立 OPENID 通道（规格 §2.5）。
 *    未绑定时客户端渲染成**引导**（契约 I4），不是错误。
 * 3. **Phase 1+ 的能力 `blockedReason` 必须诚实** ——
 *    写「等待学校信息办书面回复」，不写含糊的「暂不可用」。
 */
export const MOCK_CAPABILITIES: readonly CampusCapability[] = [
  {
    key: 'ecourse',
    nameZh: 'E云课堂',
    available: true,
    requiredProvider: null,
    phase: 'phase0',
    blockedReason: null,
  },
  {
    key: 'student_leave',
    nameZh: '学生请假',
    available: true,
    requiredProvider: null,
    phase: 'phase0',
    blockedReason: null,
  },
  {
    key: 'student_activity',
    nameZh: '学生活动',
    available: true,
    requiredProvider: null,
    phase: 'phase0',
    blockedReason: null,
  },
  {
    key: 'elrc_recordings',
    nameZh: '课程录播',
    available: true,
    requiredProvider: null,
    phase: 'phase0',
    blockedReason: null,
  },
  {
    key: 'campus_card',
    nameZh: '校园卡',
    available: true,
    requiredProvider: 'ecard',
    phase: 'phase0',
    blockedReason: null,
  },
  {
    key: 'schedule',
    nameZh: '课表',
    available: false,
    requiredProvider: 'cpdaily',
    phase: 'phase1',
    blockedReason:
      '课表需要调用校园系统接口（CpDaily），即代持校园会话；正在等待学校信息办的书面回复（契约 §11.9 第 1 项）。在回复到达之前，可达鸭不会建立任何校园会话副本。',
  },
  {
    key: 'exam',
    nameZh: '考试安排',
    available: false,
    requiredProvider: 'cpdaily',
    phase: 'phase1',
    blockedReason:
      '考试安排与课表同源（CpDaily），同样阻塞于学校信息办的书面回复（契约 §11.9 第 1 项）。',
  },
  {
    key: 'ddl',
    nameZh: '作业 DDL 聚合',
    available: false,
    requiredProvider: 'cpdaily',
    phase: 'phase1',
    blockedReason:
      'DDL 聚合需要 Blackboard / 教务接口，属 Phase 1，阻塞于信息办对「是否允许第三方代持校园会话」的书面回复。',
  },
  {
    key: 'facility',
    nameZh: '场馆预约',
    available: false,
    requiredProvider: 'cpdaily',
    phase: 'phase2',
    blockedReason:
      '场馆预约需要 OA 会话，依赖 Phase 1；且上游接口的可用性尚未确认（规格 §6.3 的 R4）。本轮不实现。',
  },
]

/**
 * 校园卡流水（含每笔交易后的余额 —— 余额由最新一笔推导，见 `deriveCardAccount`）。
 *
 * 种子数据刻意保持**算术自洽**（前一笔余额 + 本笔金额 = 本笔余额），
 * 否则「余额从流水推导」这个设计就没法被演示验证：
 * 最新一笔 `txn-0005` 的 `balanceFen = 58750` 就是当前余额（¥587.50）。
 */
export const MOCK_CARD_TRANSACTIONS: readonly CampusCardTransaction[] = [
  {
    id: 'txn-0005',
    amountFen: -1250,
    balanceFen: 58_750,
    merchant: '一食堂 · 二楼',
    occurredAt: '2026-10-17T03:12:00.000Z',
  },
  {
    id: 'txn-0004',
    amountFen: -600,
    balanceFen: 60_000,
    merchant: '教超 · 便利店',
    occurredAt: '2026-10-16T09:41:00.000Z',
  },
  {
    id: 'txn-0003',
    amountFen: 50_000,
    balanceFen: 60_600,
    merchant: '自助充值',
    occurredAt: '2026-10-15T12:00:00.000Z',
  },
  {
    id: 'txn-0002',
    amountFen: -1800,
    balanceFen: 10_600,
    merchant: '二食堂 · 三楼',
    occurredAt: '2026-10-14T04:22:00.000Z',
  },
  {
    id: 'txn-0001',
    amountFen: -2200,
    balanceFen: 12_400,
    merchant: '体育馆 · 羽毛球场',
    occurredAt: '2026-10-13T10:05:00.000Z',
  },
]

/** 付款码的演示有效期（秒）—— 真实的校园卡付款码是短时效的 */
export const MOCK_PAYMENT_CODE_TTL_SEC = 60
