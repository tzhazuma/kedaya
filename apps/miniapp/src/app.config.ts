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
 * | `home/services`（服务大厅）`profile/home`（首页管理） | 分别是首页宫格与「我的」的下一跳，属于首屏路径 |
 * | `cou`（凑凑） | 首页主推的聚合入口，点开要立刻出来（它只是两个入口的导航页，体积可忽略） |
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
  {
    root: 'presentation/pages/buddy',
    pages: ['list/index', 'create/index', 'detail/index', 'profile/index', 'recommendations/index'],
  },
  { root: 'presentation/pages/lostFound', pages: ['list/index', 'create/index', 'detail/index'] },
  { root: 'presentation/pages/facility', pages: ['list/index', 'create/index', 'detail/index'] },
  {
    root: 'presentation/pages/forum',
    pages: ['list/index', 'create/index', 'detail/index', 'report/index'],
  },
  {
    root: 'presentation/pages/wildlife',
    pages: ['archive/index', 'map/index', 'report/index', 'tracks/index'],
  },
  { root: 'presentation/pages/canteen', pages: ['list/index', 'create/index', 'detail/index'] },
  /**
   * 营养管家（模块 id 仍是 `canteen`）：今日营养是主界面，其余五页从它进入。
   * 与上面的 `canteen` 子包分开是为了**下载体积**：进营养管家不需要
   * 拉旧的共建菜品库三页（它们只在纠错/浏览时才用得到）。
   */
  {
    root: 'presentation/pages/nutrition',
    pages: [
      'index',
      'log/index',
      'history/index',
      'targets/index',
      'recommend/index',
      'dishes/index',
    ],
  },
  { root: 'presentation/pages/faq', pages: ['index/index', 'tickets/index'] },
  { root: 'presentation/pages/takeoutGuard', pages: ['list/index', 'create/index', 'detail/index'] },
  {
    root: 'presentation/pages/techpie',
    pages: ['links/index', 'capabilities/index', 'webview/index'],
  },
  { root: 'presentation/pages/wellbeing', pages: ['list/index', 'create/index', 'detail/index'] },
  { root: 'presentation/pages/aiPortrait', pages: ['index/index', 'sources/index'] },
  { root: 'presentation/pages/dormHarmony', pages: ['index/index'] },
]

export default {
  pages: [
    'presentation/pages/welcome/index',
    'presentation/pages/home/index',
    'presentation/pages/home/services/index',
    'presentation/pages/discover/index',
    'presentation/pages/messages/index',
    'presentation/pages/profile/index',
    'presentation/pages/profile/edit/index',
    'presentation/pages/profile/settings/index',
    'presentation/pages/profile/home/index',
    'presentation/pages/profile/assets/index',
    'presentation/pages/cou/index',
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
    backgroundColor: color.surface,
    enablePullDownRefresh: false,
  },
  /**
   * 位置权限（`wildlife` 上报观测需要）。
   *
   * ⚠️ 必须声明 `scope.userLocation` 的 `desc`，否则 `wx.getLocation`
   * 在真机上会直接失败。`requiredPrivateInfos` 是微信对「隐私接口」的强制申报项 ——
   * 未申报的接口即使拿到了权限也会被拒绝调用。
   *
   * 只申报**两个**：
   * - `getLocation`：上报时取当前定位（显式 `type: 'wgs84'`，规格 §3.2 硬要求 2）
   * - `chooseLocation`：从地图选点时使用
   *
   * 刻意**不**申报 `onLocationChange` / `startLocationUpdate` 等后台持续定位能力 ——
   * 本模块不需要、也不应该持续追踪用户位置（数据最小化，契约 §9）。
   */
  permission: {
    'scope.userLocation': {
      /**
       * ⚠️ 微信硬限制：`desc` **不得超过 30 个字符**（中英文都按 1 个算），
       * 超了会在**上传**阶段直接失败，报
       * `错误码 80058 ... of scope.userLocation exceeds 30, word count: N`，
       * 而本地编译、单测、`verify:weapp` 全都不会报错 —— 只有真机上传时才炸。
       * 所以这条文案由 `src/app/__tests__/appConfig.test.ts` 守着，改长短先跑测试。
       *
       * 文案要把三件事说完（少一件都可能过不了审核 / 用户不敢授权）：
       * 用途、采集时机（仅主动上报）、以及公开时的处理（模糊化）。
       */
      desc: '用于上报你发现的动物，仅主动采集、公开位置模糊化',
    },
  },
  requiredPrivateInfos: ['getLocation', 'chooseLocation'],
  tabBar: {
    /**
     * 自定义 tabBar（贴纸簿的手绘胶囊导航）。
     *
     * `custom: true` 之后微信**不再画**原生 tabBar，改为渲染
     * `src/custom-tab-bar/` 里的组件（`KdyDock`）。`list` 仍然必须完整声明：
     * 它决定"哪些页面是 tab 页"（`wx.switchTab` 只认这些页面），
     * 也是 `src/platform/tabBar.ts` 里消息红点的下标来源。
     *
     * ⚠️ dock 只画了五个格子（首页 / 地图 / ＋ / 发现 / 我的），
     * 「消息」不在其中 —— 它是 tab 页，入口留在「我的」页里，
     * `navigateTo(PAGE_PATHS.messages)` 仍然走 `switchTab`。
     */
    custom: true,
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
