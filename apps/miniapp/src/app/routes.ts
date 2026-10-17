/**
 * 页面路由表 —— 纯常量，不依赖 Taro（便于在测试/非 UI 场景引用）。
 *
 * 路径规则：Taro 的页面路径 = `sourceRoot` 之后的相对路径（不含扩展名）。
 * 由于契约 §7 冻结了六边形目录，页面真实位于 `src/presentation/pages/**`，
 * 因此路径统一以 `presentation/` 开头。
 */

export const PAGE_PATHS = {
  home: '/presentation/pages/home/index',
  discover: '/presentation/pages/discover/index',
  messages: '/presentation/pages/messages/index',
  profile: '/presentation/pages/profile/index',
  groupBuyList: '/presentation/pages/groupbuy/list/index',
  groupBuyDetail: '/presentation/pages/groupbuy/detail/index',
  // 账号（自建账号体系：注册 / 登录 / 找回密码 / 修改密码）
  authLogin: '/presentation/pages/auth/login/index',
  authRegister: '/presentation/pages/auth/register/index',
  authForgot: '/presentation/pages/auth/forgot/index',
  authChangePassword: '/presentation/pages/auth/change-password/index',
  authBindEmail: '/presentation/pages/auth/bind-email/index',
  // 资料（昵称 / 头像：微信一键注册后会直接引到这里）
  profileEdit: '/presentation/pages/profile/edit/index',
  // 跳蚤市场
  fleaList: '/presentation/pages/fleaMarket/list/index',
  fleaCreate: '/presentation/pages/fleaMarket/create/index',
  fleaDetail: '/presentation/pages/fleaMarket/detail/index',
  // 跑腿
  errandList: '/presentation/pages/errand/list/index',
  errandCreate: '/presentation/pages/errand/create/index',
  errandDetail: '/presentation/pages/errand/detail/index',
  // 找搭子
  buddyList: '/presentation/pages/buddy/list/index',
  buddyCreate: '/presentation/pages/buddy/create/index',
  buddyDetail: '/presentation/pages/buddy/detail/index',
  // 失物招领
  lostFoundList: '/presentation/pages/lostFound/list/index',
  lostFoundCreate: '/presentation/pages/lostFound/create/index',
  lostFoundDetail: '/presentation/pages/lostFound/detail/index',
  // 论坛
  forumList: '/presentation/pages/forum/list/index',
  forumCreate: '/presentation/pages/forum/create/index',
  forumDetail: '/presentation/pages/forum/detail/index',
  // 宿舍矛盾（匿名，凭追踪码查看）
  dormHarmonyHome: '/presentation/pages/dormHarmony/index/index',
  // 四个核心模块：身份 / 课表 / 校园卡 / 我的（隐私与数据）
  identity: '/presentation/pages/identity/index',
  schedule: '/presentation/pages/schedule/index',
  campusCard: '/presentation/pages/campusCard/index',
  profileSettings: '/presentation/pages/profile/settings/index',
  // 内置全局助手「可达鸭」
  agent: '/presentation/pages/agent/index',
} as const

export type PagePath = (typeof PAGE_PATHS)[keyof typeof PAGE_PATHS]

/** tabBar 上的四个主页面（必须与 app.config.ts 的 tabBar.list 完全一致） */
export const TAB_BAR_PATHS: readonly string[] = [
  PAGE_PATHS.home,
  PAGE_PATHS.discover,
  PAGE_PATHS.messages,
  PAGE_PATHS.profile,
]

export function isTabBarPath(path: string): boolean {
  const [base] = path.split('?')
  return base !== undefined && TAB_BAR_PATHS.includes(base)
}

/** 从页面参数里安全取 id（`useRouter().params.id` 可能是 string | undefined） */
export function readIdParam(params: Record<string, string | undefined>): string | null {
  const id = params.id
  return id === undefined || id === '' ? null : id
}

function detailPath(base: string, id: string): string {
  return `${base}?id=${encodeURIComponent(id)}`
}

export function groupBuyDetailPath(id: string): string {
  return detailPath(PAGE_PATHS.groupBuyDetail, id)
}

export function fleaDetailPath(id: string): string {
  return detailPath(PAGE_PATHS.fleaDetail, id)
}

export function errandDetailPath(id: string): string {
  return detailPath(PAGE_PATHS.errandDetail, id)
}

export function buddyDetailPath(id: string): string {
  return detailPath(PAGE_PATHS.buddyDetail, id)
}

export function lostFoundDetailPath(id: string): string {
  return detailPath(PAGE_PATHS.lostFoundDetail, id)
}

export function forumDetailPath(id: string): string {
  return detailPath(PAGE_PATHS.forumDetail, id)
}

/** 宿舍矛盾：详情靠追踪码而不是 id 寻址 */
export function dormHarmonyDetailPath(trackCode: string): string {
  return `${PAGE_PATHS.dormHarmonyHome}?trackCode=${encodeURIComponent(trackCode)}`
}
