/**
 * 三端共享的**小程序页面路径**（服务端会下发的跳转目标）。
 *
 * 谁会用到：
 *   · 可达鸭 agent 的 `actions`（"打开课表"这类动作）；
 *   · 站内信通知的 `link`（"有人参团了你的拼单"要能点进详情）。
 *
 * 为什么放在契约包而不是各写一份：
 *   这些路径是**落库/下发的字符串**，一旦和小程序真实路由漂移，
 *   用户点进去只会**静默无反应**（微信不报错），极难排查。
 *   因此这里集中登记，并由小程序侧的测试断言 `PAGE_PATHS` 与这里逐条一致
 *   （`apps/miniapp/src/app/__tests__/routes.test.ts`）：谁改了路径，另一边立刻红。
 */
export const MINIAPP_PAGES = {
  home: '/presentation/pages/home/index',
  agent: '/presentation/pages/agent/index',
  identity: '/presentation/pages/identity/index',
  schedule: '/presentation/pages/schedule/index',
  campusCard: '/presentation/pages/campusCard/index',
  profile: '/presentation/pages/profile/index',
  profileSettings: '/presentation/pages/profile/settings/index',
  profileEdit: '/presentation/pages/profile/edit/index',
  profileAssets: '/presentation/pages/profile/assets/index',
  authLogin: '/presentation/pages/auth/login/index',  authBindEmail: '/presentation/pages/auth/bind-email/index',
  groupBuyList: '/presentation/pages/groupbuy/list/index',
  groupBuyDetail: '/presentation/pages/groupbuy/detail/index',
  fleaList: '/presentation/pages/fleaMarket/list/index',
  fleaDetail: '/presentation/pages/fleaMarket/detail/index',
  errandList: '/presentation/pages/errand/list/index',
  errandDetail: '/presentation/pages/errand/detail/index',
  buddyList: '/presentation/pages/buddy/list/index',
  buddyDetail: '/presentation/pages/buddy/detail/index',
  lostFoundList: '/presentation/pages/lostFound/list/index',
  lostFoundDetail: '/presentation/pages/lostFound/detail/index',
  forumList: '/presentation/pages/forum/list/index',
  forumDetail: '/presentation/pages/forum/detail/index',
  // 法务页：用户协议 / 隐私政策（审核必备；系统通知也可能把用户引到这里）
  legalTerms: '/presentation/pages/legal/terms/index',
  legalPrivacy: '/presentation/pages/legal/privacy/index',
} as const;

export type MiniappPageKey = keyof typeof MINIAPP_PAGES;
