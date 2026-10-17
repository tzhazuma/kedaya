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
  // 拼单
  groupBuyList: '/presentation/pages/groupbuy/list/index',
  groupBuyCreate: '/presentation/pages/groupbuy/create/index',
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
  // 猫鸟黑天鹅（校园动物观察点）
  wildlifeList: '/presentation/pages/wildlife/list/index',
  wildlifeCreate: '/presentation/pages/wildlife/create/index',
  wildlifeDetail: '/presentation/pages/wildlife/detail/index',
  // 食堂营养（同学共建菜品库）
  canteenList: '/presentation/pages/canteen/list/index',
  canteenCreate: '/presentation/pages/canteen/create/index',
  canteenDetail: '/presentation/pages/canteen/detail/index',
  // 常见问题（问答库）
  faqList: '/presentation/pages/faq/list/index',
  faqCreate: '/presentation/pages/faq/create/index',
  faqDetail: '/presentation/pages/faq/detail/index',
  // 偷外卖（本人可见的报备记录，不是公开举报墙）
  takeoutGuardList: '/presentation/pages/takeoutGuard/list/index',
  takeoutGuardCreate: '/presentation/pages/takeoutGuard/create/index',
  takeoutGuardDetail: '/presentation/pages/takeoutGuard/detail/index',
  // 宿舍矛盾（匿名，凭追踪码查看）
  dormHarmonyHome: '/presentation/pages/dormHarmony/index/index',
  // 四个核心模块：身份 / 课表 / 校园卡 / 我的（隐私与数据）
  identity: '/presentation/pages/identity/index',
  schedule: '/presentation/pages/schedule/index',
  campusCard: '/presentation/pages/campusCard/index',
  profileSettings: '/presentation/pages/profile/settings/index',
  /** 「我的资产」：我的拼单（发起/参与）+ 各模块入口 */
  profileAssets: '/presentation/pages/profile/assets/index',
  // 内置全局助手「可达鸭」
  agent: '/presentation/pages/agent/index',
  // 法务页（微信审核必备；内容与 PRIVACY_RULES 同源，避免两处漂移）
  legalTerms: '/presentation/pages/legal/terms/index',
  legalPrivacy: '/presentation/pages/legal/privacy/index',
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

/**
 * tabBar 下标 —— `Taro.setTabBarBadge` 只认数字下标，不认页面路径。
 *
 * 从 `TAB_BAR_PATHS` 推导而不是在平台层写死 `2`：将来调整 tabBar 顺序时，
 * 红点会跟着走，而不是悄悄挂到错误的 tab 上。
 */
export function tabBarIndex(path: string): number {
  const [base] = path.split('?')
  return base === undefined ? -1 : TAB_BAR_PATHS.indexOf(base)
}

/**
 * 已实现垂直切片的模块 → 入口页。
 *
 * 这里只做「契约模块 id → 页面路径」的映射，模块清单本身仍然来自
 * `@kedaya/contracts`（契约 §4 硬规则：禁止各端硬编码模块清单）。
 * 未登记的模块点击后明确提示「开发中」，不假装可用。
 *
 * 放在 `app/routes.ts` 而不是页面里：首页宫格与「发现」页都要用它，
 * 各写一份必然漂移（新增页面时只改了一处，另一处静默点不进去）。
 */
export const MODULE_ENTRY_PATHS: Readonly<Record<string, string>> = {
  groupbuy: PAGE_PATHS.groupBuyList,
  'flea-market': PAGE_PATHS.fleaList,
  errand: PAGE_PATHS.errandList,
  buddy: PAGE_PATHS.buddyList,
  'lost-found': PAGE_PATHS.lostFoundList,
  forum: PAGE_PATHS.forumList,
  wildlife: PAGE_PATHS.wildlifeList,
  canteen: PAGE_PATHS.canteenList,
  faq: PAGE_PATHS.faqList,
  'takeout-guard': PAGE_PATHS.takeoutGuardList,
  'dorm-harmony': PAGE_PATHS.dormHarmonyHome,
  // 站内通知：就是 tabBar 上的「消息」页（用 switchTab 跳，navigateTo 会失败）
  notifications: PAGE_PATHS.messages,
  // 四个核心模块（身份 / 课表 / 校园卡 / 我的）
  auth: PAGE_PATHS.identity,
  schedule: PAGE_PATHS.schedule,
  'campus-card': PAGE_PATHS.campusCard,
  profile: PAGE_PATHS.profile,
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

export function wildlifeDetailPath(id: string): string {
  return detailPath(PAGE_PATHS.wildlifeDetail, id)
}

export function canteenDetailPath(id: string): string {
  return detailPath(PAGE_PATHS.canteenDetail, id)
}

export function faqDetailPath(id: string): string {
  return detailPath(PAGE_PATHS.faqDetail, id)
}

export function takeoutGuardDetailPath(id: string): string {
  return detailPath(PAGE_PATHS.takeoutGuardDetail, id)
}

/** 宿舍矛盾：详情靠追踪码而不是 id 寻址 */
export function dormHarmonyDetailPath(trackCode: string): string {
  return `${PAGE_PATHS.dormHarmonyHome}?trackCode=${encodeURIComponent(trackCode)}`
}
