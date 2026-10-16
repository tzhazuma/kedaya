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

export default {
  pages: [
    'presentation/pages/home/index',
    'presentation/pages/discover/index',
    'presentation/pages/messages/index',
    'presentation/pages/profile/index',
    'presentation/pages/groupbuy/list/index',
    'presentation/pages/groupbuy/detail/index',
    'presentation/pages/forum/list/index',
    'presentation/pages/forum/detail/index',
    'presentation/pages/forum/create/index',
    'presentation/pages/forum/report/index',
    'presentation/pages/faq/index/index',
    'presentation/pages/faq/tickets/index',
    'presentation/pages/wildlife/map/index',
    'presentation/pages/wildlife/report/index',
    'presentation/pages/wildlife/tracks/index',
  ],
  window: {
    backgroundTextStyle: 'light',
    navigationBarBackgroundColor: color.brand,
    navigationBarTitleText: '可达鸭',
    navigationBarTextStyle: 'black',
    backgroundColor: color.bg,
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
      desc: '用于记录你发现动物的位置（仅在你主动上报时采集，公开位置会做模糊化处理）',
    },
  },
  requiredPrivateInfos: ['getLocation', 'chooseLocation'],
  tabBar: {
    color: color.textMuted,
    selectedColor: color.brandStrong,
    backgroundColor: color.surface,
    borderStyle: 'white',
    // 暂不配置图标（iconPath 可省略，仅显示文字）。
    // 品牌图标就位后在这里补 iconPath / selectedIconPath 即可。
    list: [
      { pagePath: 'presentation/pages/home/index', text: '首页' },
      { pagePath: 'presentation/pages/discover/index', text: '发现' },
      { pagePath: 'presentation/pages/messages/index', text: '消息' },
      { pagePath: 'presentation/pages/profile/index', text: '我的' },
    ],
  },
}
