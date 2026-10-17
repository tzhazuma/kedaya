/**
 * 隐私与数据（`profile` 模块的读侧）领域模型。
 *
 * 「我的」不只是设置项堆放处：契约 §9 给了用户三项**可执行**的权利，
 * 这个模型就是它们的载体：
 *   ① 同意可撤回（`Consent`）—— 并且能看到"哪些模块我还没授权"；
 *   ② 画像/敏感开关可关闭（`PrivacySettings`）；
 *   ③ 数据可携（`ProfileExport`）。
 */

export interface PrivacySettings {
  showRealName: boolean
  allowAiPortrait: boolean
  allowWellbeing: boolean
  allowDormHarmony: boolean
  themeMode: string
}

/** 可切换的隐私开关（页面上逐个渲染，避免写死顺序与文案） */
export const PRIVACY_TOGGLES: readonly {
  key: 'showRealName' | 'allowAiPortrait' | 'allowWellbeing' | 'allowDormHarmony'
  title: string
  detail: string
}[] = [
  {
    key: 'allowAiPortrait',
    title: 'AI 画像',
    detail: '允许可达鸭为你生成校园生活画像（关闭后画像立即不可用，已有画像不再被读取）',
  },
  {
    key: 'showRealName',
    title: '展示实名',
    detail: '在需要实名的场景显示你的真实姓名（默认关闭，仅显示昵称）',
  },
  {
    key: 'allowWellbeing',
    title: '心理健康服务',
    detail: '允许使用心理健康模块（数据与其它模块物理隔离，不进入通用画像）',
  },
  {
    key: 'allowDormHarmony',
    title: '宿舍矛盾调解',
    detail: '允许使用宿舍矛盾模块（匿名存储，仅调解员可见）',
  },
]

export interface ConsentView {
  module: string
  nameZh: string
  summary: string
  sensitivity: string
  /** 契约里该模块是否需要二次同意 */
  gated: boolean
  /** 当前是否有效授权 */
  active: boolean
  version: string | null
  grantedAt: string | null
  revokedAt: string | null
}

export interface ProfileExportContent {
  module: string
  nameZh: string
  count: number
  note?: string
}

export interface ProfileExport {
  generatedAt: string
  account: {
    id: string
    displayName: string
    hasAvatar: boolean
    anonEnabled: boolean
    department: string | null
    createdAt: string
    hasPassword: boolean
    identities: { provider: string; email: string | null; realName: string | null; linkedAt: string }[]
    campusBindings: { platform: string; status: string; scopes: string[]; createdAt: string; expiresAt: string }[]
  } | null
  settings: PrivacySettings | null
  consents: { module: string; nameZh: string; version: string; grantedAt: string; revokedAt: string | null }[]
  audit: {
    total: number
    recent: { action: string; module: string | null; resource: string; at: string }[]
  }
  content: ProfileExportContent[]
  note: string
}

/** 敏感级中文（页面标签，避免出现裸英文枚举） */
export const SENSITIVITY_LABELS: Readonly<Record<string, string>> = {
  critical: '极高敏感',
  high: '高敏感',
  medium: '中敏感',
  low: '低敏感',
  unknown: '未标注',
}
