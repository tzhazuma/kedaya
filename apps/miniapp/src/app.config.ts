import tokens from '@kedaya/design-tokens/tokens.json'

/**
 * 小程序全局配置（app.json）。
 *
 * 色值**全部**取自 `@kedaya/design-tokens`（契约 §6.2：禁止手写色值）。
 * 这里直接读包的 `tokens.json`（唯一真相来源本身，非派生产物）：
 * Taro 在构建期用 esbuild 打包本文件，JSON 导入不涉及 TS 解析，最稳。
 *
 * ⚠️ 本文件由 Taro 在**构建期**读取并生成 `dist/app.json`，
 * 因此不能引用运行时代码（store / 环境变量等）。
 */

const color = tokens.color

/**
 * 分包（`subPackages`）—— 主包体积是**硬约束**（微信上限 2 MB，超了整个包不能上传）。
 *
 * ## 为什么这么分
 *
 * | 放主包 | 理由 |
 * | --- | --- |
 * | 4 个 tabBar 页（首页/发现/消息/我的） | 微信**强制**要求 tabBar 页在主包 |
 * | `auth/*`（登录/注册/找回/改密/绑邮箱） | 崩溃最常发生在登录前，且任何入口都可能跳到登录页。分包会让"点登录先等下载" |
 * | `profile/*`（编辑/设置/资产） | 与 tabBar 的 `profile` 同根目录，拆开会让 `profile/index` 落进子包（tabBar 页不允许） |
 * | `agent` | 可达鸭是**全局悬浮球**，任何页面都可能点开，必须没有下载延迟 |
 * | `identity` / `schedule` / `campusCard` | 与「我的」并列的核心模块，属于高频首屏路径 |
 * | `legal/*` | 登录/注册页直接引用，属注册转化路径 |
 *
 * 子包放**六个生活模块 + 宿舍矛盾**：它们都是"用户主动点进去才需要"的垂直业务，
 * 首屏不需要，且各自 3 个页面正好是一个自然的访问单元（列表→发布→详情）。
 *
 * ## 为什么不是"每个页面一个子包"
 *
 * 子包数量本身有开销，且同一模块的三个页面总是连着访问 ——
 * 按模块分包才能让"点进跳蚤市场"只下载一次。
 *
 * ⚠️ 改动本文件必须同步 `src/app/__tests__/routes.test.ts`
 * （它把契约 / 路由表 / 构建配置三方锁在一起）。
 */
const subPackages = [
  { root: 'presentation/pages/groupbuy', pages: ['list/index', 'create/index', 'detail/index'] },
  { root: 'presentation/pages/fleaMarket', pages: ['list/index', 'create/index', 'detail/index'] },
  { root: 'presentation/pages/errand', pages: ['list/index', 'create/index', 'detail/index'] },
  { root: 'presentation/pages/buddy', pages: ['list/index', 'create/index', 'detail/index'] },
  { root: 'presentation/pages/lostFound', pages: ['list/index', 'create/index', 'detail/index'] },
  { root: 'presentation/pages/forum', pages: ['list/index', 'create/index', 'detail/index'] },
  { root: 'presentation/pages/wildlife', pages: ['list/index', 'create/index', 'detail/index'] },
  { root: 'presentation/pages/canteen', pages: ['list/index', 'create/index', 'detail/index'] },
  { root: 'presentation/pages/faq', pages: ['list/index', 'create/index', 'detail/index'] },
  { root: 'presentation/pages/takeoutGuard', pages: ['list/index', 'create/index', 'detail/index'] },
  { root: 'presentation/pages/techpie', pages: ['list/index', 'create/index', 'detail/index'] },
  { root: 'presentation/pages/wellbeing', pages: ['list/index', 'create/index', 'detail/index'] },
  { root: 'presentation/pages/aiPortrait', pages: ['index/index', 'sources/index'] },
  { root: 'presentation/pages/dormHarmony', pages: ['index/index'] },
]

export default {
  pages: [
    'presentation/pages/home/index',
    'presentation/pages/discover/index',
    'presentation/pages/messages/index',
    'presentation/pages/profile/index',
    'presentation/pages/profile/edit/index',
    'presentation/pages/profile/settings/index',
    'presentation/pages/profile/assets/index',
    'presentation/pages/auth/login/index',
    'presentation/pages/auth/register/index',
    'presentation/pages/auth/forgot/index',
    'presentation/pages/auth/change-password/index',
    'presentation/pages/auth/bind-email/index',
    'presentation/pages/identity/index',
    'presentation/pages/schedule/index',
    'presentation/pages/campusCard/index',
    'presentation/pages/agent/index',
    'presentation/pages/legal/terms/index',
    'presentation/pages/legal/privacy/index',
  ],
  subPackages,
  /**
   * 预下载规则：**只在 Wi-Fi 下**、且只在用户已经进到「发现」页时，
   * 才预下载这七个业务子包。
   *
   * 为什么不从首页预下载：首页是最高频的入口（用户可能只是来看一眼消息），
   * 在 4G 上替他把七个模块的代码全下下来，是拿用户的流量换**可能用不到**的顺滑。
   * 「发现」页是用户的**意图信号**（他正在找模块），此时预下载才是划算的。
   * `network: 'wifi'` 让移动网络下仍然按需下载。
   */
  preloadRule: {
    'presentation/pages/discover/index': {
      network: 'wifi',
      packages: subPackages.map((item) => item.root),
    },
  },
  window: {
    backgroundTextStyle: 'light',
    navigationBarBackgroundColor: color.surface,
    navigationBarTitleText: '可达鸭',
    navigationBarTextStyle: 'black',
    backgroundColor: color.bg,
    enablePullDownRefresh: false,
  },
  tabBar: {
    color: color.textMuted,
    selectedColor: color.ink,
    backgroundColor: color.surface,
    borderStyle: 'white',
    list: [
      {
        pagePath: 'presentation/pages/home/index',
        text: '首页',
        iconPath: 'assets/tabs/home.png',
        selectedIconPath: 'assets/tabs/home-active.png',
      },
      {
        pagePath: 'presentation/pages/discover/index',
        text: '发现',
        iconPath: 'assets/tabs/discover.png',
        selectedIconPath: 'assets/tabs/discover-active.png',
      },
      {
        pagePath: 'presentation/pages/messages/index',
        text: '消息',
        iconPath: 'assets/tabs/messages.png',
        selectedIconPath: 'assets/tabs/messages-active.png',
      },
      {
        pagePath: 'presentation/pages/profile/index',
        text: '我的',
        iconPath: 'assets/tabs/profile.png',
        selectedIconPath: 'assets/tabs/profile-active.png',
      },
    ],
  },
}
