/**
 * 三端共享的**小程序页面路径**（供后端 `agent` 下发 `navigate` 动作使用）。
 *
 * 为什么放在契约包而不是各写一份：
 *   可达鸭 agent 的 `actions` 里带的是真实页面路径，小程序拿到后直接跳转。
 *   如果后端硬编码一份、小程序再维护一份，两边一旦漂移，用户点"打开课表"就会
 *   跳到一个空页面 —— 而且**不会报错**，只是没反应，极难排查。
 *
 * 因此这里只放**agent 会跳转到的页面**（不是全部页面），
 * 并由小程序侧的测试断言 `PAGE_PATHS` 与这里逐条一致（`routes.test.ts`）：
 *   谁改了路径，另一边立刻红。
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
  authLogin: '/presentation/pages/auth/login/index',
  authBindEmail: '/presentation/pages/auth/bind-email/index',
  fleaList: '/presentation/pages/fleaMarket/list/index',
  errandList: '/presentation/pages/errand/list/index',
  buddyList: '/presentation/pages/buddy/list/index',
  lostFoundList: '/presentation/pages/lostFound/list/index',
  forumList: '/presentation/pages/forum/list/index',
} as const;

export type MiniappPageKey = keyof typeof MINIAPP_PAGES;
