/**
 * TechPie 整合 mock 数据集 —— 保证**无后端也能跑通**（契约 §7 硬规则 4）。
 *
 * 刻意覆盖 Phase 0 的**全部** UI 状态：
 * - 绑定：一条 `EXPIRED`（演示"绑定已过期 → 需重新绑定，但登录不受影响"）、
 *   **校园卡默认未绑定**（这样能力清单默认就能展示 `CAMPUS_BINDING_REQUIRED` 的**引导**，
 *   而不是要靠人工造数据才能看到）；
 * - 能力：Phase 0 可用（校园卡 OPENID / WebView 直连）、未绑定（校园卡）、
 *   已过期（CpDaily）、Phase 1–2 **阻塞**（课表 / 场馆预约）；
 * - 校园卡：余额 / 流水 / 付款码（60s TTL）。
 *
 * ⚠️ **不编造校园网能力**（契约 §11.18-C：当前 clone 未发现该能力）。
 * ⚠️ **不编造 Phase 1+ 的数据**：阻塞项只以 `PHASE_BLOCKED` 出现，
 *    mock 里**没有任何** CASTGC / CpDaily 会话数据 —— 一个字段都没有。
 * ⚠️ 白名单里的域名是**占位**（§11.18-B / U11），见 `CAMPUS_TARGET_ALLOWLIST`。
 */
import type {
  CampusBindingSummary,
  CampusCard,
  CardTransaction,
  TechpieCapability,
} from '@/domain/models/techpie';

/** 演示会话用户（与 `application/buddy/session.ts` 的 `DEMO_BUDDY_SESSION` 对齐） */
export const DEMO_TECHPIE_USER_ID = 'u_1024';

const DAY = 24 * 60 * 60 * 1000;

/** 本地时间构造（测试传固定 now 即可确定性） */
function iso(base: Date, deltaMs: number): string {
  return new Date(base.getTime() + deltaMs).toISOString();
}

/**
 * 默认绑定：只有一条 **`cpdaily` `EXPIRED`**。
 *
 * 为什么默认不含 `ecard`：校园卡默认未绑定，能力清单才能默认展示
 * `CAMPUS_BINDING_REQUIRED` 的引导（这是 Phase 0 的验收点之一）。
 * 绑定校园卡走 OPENID 通道，`POST /techpie/links` 即可发起。
 *
 * 为什么没有 `egate` / `cas` / `techpie` 的 `LINKED` 假数据：
 * 那会暗示 Phase 1 已经能用（§11.18-D：根本没做）。
 */
export function techpieLinkFixtures(now: Date): CampusBindingSummary[] {
  return [
    {
      id: 'lk_01JCPDAILY000000000000001',
      platform: 'cpdaily',
      status: 'EXPIRED',
      externalUserId: '2023XXXXXX',
      expiresAt: iso(now, -2 * DAY),
      lastSyncAt: iso(now, -3 * DAY),
    },
  ];
}

/**
 * 校园能力清单（Phase 0 子集 + Phase 1/2 的**阻塞**项）。
 *
 * `status` 由 mock 的"服务端"按绑定状态计算（见 `techpie.repository.ts` 的
 * `withCapabilityStatus`），因此这里是**基线**，不是最终值。
 */
export const TECHPIE_CAPABILITY_FIXTURES: readonly TechpieCapability[] = [
  /* ---- Phase 0 · 校园卡（OPENID 通道，§2.5） ---- */
  {
    id: 'ecard.balance',
    moduleId: 'campus-card',
    nameZh: '校园卡余额',
    summary: '一卡通余额（缓存 60 秒）。',
    phase: 'phase0',
    access: 'openid',
    platform: 'ecard',
    targetUrl: null,
    status: 'CAMPUS_BINDING_REQUIRED',
    guidance: null,
  },
  {
    id: 'ecard.transactions',
    moduleId: 'campus-card',
    nameZh: '校园卡流水',
    summary: '消费 / 充值 / 退款流水，游标分页。',
    phase: 'phase0',
    access: 'openid',
    platform: 'ecard',
    targetUrl: null,
    status: 'CAMPUS_BINDING_REQUIRED',
    guidance: null,
  },
  {
    id: 'ecard.payment-code',
    moduleId: 'campus-card',
    nameZh: '校园卡付款码',
    summary: '付款码，60 秒有效且旧码立即失效；码值不进日志、不进审计正文。',
    phase: 'phase0',
    access: 'openid',
    platform: 'ecard',
    targetUrl: null,
    status: 'CAMPUS_BINDING_REQUIRED',
    guidance: null,
  },

  /* ---- Phase 0 · WebView 直连（W4：用户自登录，我们不接触 cookie，§8.4） ---- */
  {
    id: 'webview.ecourse',
    moduleId: 'techpie',
    nameZh: 'E云课堂',
    summary: '直接打开学校 E云课堂；登录在学校页面完成。',
    phase: 'phase0',
    access: 'webview',
    // W4：不注入 cookie ⇒ **不需要绑定**（§9.1）
    platform: null,
    targetUrl: 'https://ecourse.shanghaitech.edu.cn/',
    status: 'AVAILABLE',
    guidance: null,
  },
  {
    id: 'webview.leave',
    moduleId: 'techpie',
    nameZh: '学生请假',
    summary: '直接打开学校请假系统；登录在学校页面完成。',
    phase: 'phase0',
    access: 'webview',
    platform: null,
    targetUrl: 'https://oa.shanghaitech.edu.cn/',
    status: 'AVAILABLE',
    guidance: null,
  },
  {
    id: 'webview.activity',
    moduleId: 'techpie',
    nameZh: '学生活动',
    summary: '直接打开学生活动页面；登录在学校页面完成。',
    phase: 'phase0',
    access: 'webview',
    platform: null,
    targetUrl: 'https://oa.shanghaitech.edu.cn/activity',
    status: 'AVAILABLE',
    guidance: null,
  },
  {
    id: 'webview.lecture',
    moduleId: 'techpie',
    nameZh: '课程录播',
    summary: '直接打开课程录播（ELRC）；登录在学校页面完成。',
    phase: 'phase0',
    access: 'webview',
    platform: null,
    targetUrl: 'https://elrc.shanghaitech.edu.cn/',
    status: 'AVAILABLE',
    guidance: null,
  },

  /* ---- Phase 1 · 结构化校园数据（阻塞于信息办，§11.18-D） ---- */
  {
    id: 'schedule.timetable',
    moduleId: 'schedule',
    nameZh: '课表',
    summary: '结构化课表（需要 CpDaily 会话）。',
    phase: 'phase1',
    access: 'server_proxy',
    platform: 'cpdaily',
    targetUrl: null,
    status: 'PHASE_BLOCKED',
    guidance: null,
  },
  {
    id: 'schedule.exams',
    moduleId: 'schedule',
    nameZh: '考试表',
    summary: '考试安排（需要 CpDaily 会话）。',
    phase: 'phase1',
    access: 'server_proxy',
    platform: 'cpdaily',
    targetUrl: null,
    status: 'PHASE_BLOCKED',
    guidance: null,
  },

  /* ---- Phase 2 · 场馆预约（需先解决模块归属 + Phase 1 全通过，§9.3） ---- */
  {
    id: 'facility.gym',
    moduleId: 'facility',
    nameZh: '场馆预约',
    summary: '体育馆 / 健身房预约（需要 OA 会话）。',
    phase: 'phase2',
    access: 'server_proxy',
    platform: 'egate',
    targetUrl: null,
    status: 'PHASE_BLOCKED',
    guidance: null,
  },
];

/** 校园卡（`cardNoMasked` 只存掩码 —— 完整卡号不进客户端模型） */
export function campusCardFixture(now: Date): CampusCard {
  return {
    cardNoMasked: '****1024',
    balanceFen: 5830,
    status: 'ACTIVE',
    syncedAt: iso(now, -60 * 1000),
  };
}

/** 校园卡流水（覆盖 5 种 `kind`；负数 = 支出） */
export function cardTransactionFixtures(now: Date): CardTransaction[] {
  return [
    {
      id: 'tx_0005',
      occurredAt: iso(now, -2 * 60 * 60 * 1000),
      amountFen: -1250,
      merchant: '一食堂二楼',
      kind: 'meal',
    },
    {
      id: 'tx_0004',
      occurredAt: iso(now, -1 * DAY),
      amountFen: -380,
      merchant: '教育超市',
      kind: 'shop',
    },
    {
      id: 'tx_0003',
      occurredAt: iso(now, -3 * DAY),
      amountFen: 20000,
      merchant: '微信充值',
      kind: 'recharge',
    },
    {
      id: 'tx_0002',
      occurredAt: iso(now, -5 * DAY),
      amountFen: 1500,
      merchant: '教育超市（退货）',
      kind: 'refund',
    },
    {
      id: 'tx_0001',
      occurredAt: iso(now, -9 * DAY),
      amountFen: -2000,
      merchant: null,
      kind: 'other',
    },
  ];
}

/** 付款码 TTL（规格 §3.3 / `06-roadmap.md:103`：60 秒） */
export const PAYMENT_CODE_TTL_SEC_FIXTURE = 60;
