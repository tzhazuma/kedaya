/**
 * 身份（`auth`）领域模型 —— 校园**第二级能力**的读取侧。
 *
 * 关键概念（契约 §5）：
 *   · 登录 ≠ 绑定。登录回答"你是谁"；校园系统绑定回答"你能读哪些校园数据"。
 *   · 因此本模型里的一切都要能表达「未绑定 / 已过期 / 已绑定」，而不是简单的布尔。
 *
 * 隐私硬约束（契约 §9）：实名信息**默认脱敏**，且脱敏在服务端完成 ——
 * 客户端拿到的 `masked: true` 数据里已经没有明文，前端没有"自己打码"的机会。
 */

export const CAMPUS_PLATFORMS = ['EGATE', 'JWC', 'CPDAILY', 'CARD'] as const
export type CampusPlatform = (typeof CAMPUS_PLATFORMS)[number]

export const CAMPUS_PLATFORM_LABELS: Readonly<Record<CampusPlatform, string>> = {
  EGATE: '统一身份认证',
  JWC: '教务系统',
  CPDAILY: '校园日常',
  CARD: '校园卡系统',
}

/** 每个平台**具体**能换来什么能力 —— 用户要知道"绑它有什么用" */
export const CAMPUS_PLATFORM_PURPOSE: Readonly<Record<CampusPlatform, string>> = {
  EGATE: '学号、姓名、院系（默认打码展示）',
  JWC: '本学期课表，可一键同步',
  CPDAILY: '校园通知与日常信息',
  CARD: '校园卡余额与消费流水',
}

/** 平台作用的中文一句话（给"还没绑定"的空态用） */
export const CAMPUS_PLATFORM_GAIN: Readonly<Record<CampusPlatform, string>> = {
  EGATE: '绑定后可以核对你的实名信息',
  JWC: '绑定后可以同步本学期课表',
  CPDAILY: '绑定后可以收到校园日常信息',
  CARD: '绑定后可以查余额和消费流水',
}

export interface CampusPlatformStatus {
  platform: CampusPlatform
  /** 现在就能用（已绑定且未过期） */
  available: boolean
  /** 绑定建立时间（ISO），未绑定为 null */
  boundAt: string | null
  /** 授权到期时间（ISO） */
  expiresAt: string | null
  /** 绑定过但已过期 —— UI 要提示"重新绑定"，而不是"未绑定" */
  expired: boolean
  /** 是否为开发用模拟凭据（必须如实标注） */
  simulated: boolean
}

export interface CampusOverview {
  /** `mock` = 上游是模拟数据源（本地开发），UI 必须标注 */
  dataMode: 'mock' | 'live'
  platforms: CampusPlatformStatus[]
}

export interface CampusIdentity {
  studentId: string
  realName: string
  department: string | null
  email: string | null
  campus: string | null
}

export interface CampusIdentityView {
  platform: CampusPlatform
  /** true = 服务端已脱敏（客户端展示的就是打码后的内容） */
  masked: boolean
  identity: CampusIdentity
  simulated: boolean
  dataMode: 'mock' | 'live'
  fetchedAt: string
  /** 本次读取是否写了审计（展开明文时为 true） */
  audited: boolean
}

/** 已绑定且可用的平台（页面里到处都要用到这个小判断） */
export function availablePlatforms(overview: CampusOverview): CampusPlatformStatus[] {
  return overview.platforms.filter((item) => item.available)
}
