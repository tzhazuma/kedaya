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
    'presentation/pages/profile/edit/index',
    'presentation/pages/groupbuy/list/index',
    'presentation/pages/groupbuy/detail/index',
    'presentation/pages/auth/login/index',
    'presentation/pages/auth/register/index',
    'presentation/pages/auth/forgot/index',
    'presentation/pages/auth/change-password/index',
    'presentation/pages/auth/bind-email/index',
    'presentation/pages/fleaMarket/list/index',
    'presentation/pages/fleaMarket/create/index',
    'presentation/pages/fleaMarket/detail/index',
    'presentation/pages/errand/list/index',
    'presentation/pages/errand/create/index',
    'presentation/pages/errand/detail/index',
    'presentation/pages/buddy/list/index',
    'presentation/pages/buddy/create/index',
    'presentation/pages/buddy/detail/index',
    'presentation/pages/lostFound/list/index',
    'presentation/pages/lostFound/create/index',
    'presentation/pages/lostFound/detail/index',
    'presentation/pages/forum/list/index',
    'presentation/pages/forum/create/index',
    'presentation/pages/forum/detail/index',
    'presentation/pages/dormHarmony/index/index',
    'presentation/pages/identity/index',
    'presentation/pages/schedule/index',
    'presentation/pages/campusCard/index',
    'presentation/pages/profile/settings/index',
    'presentation/pages/agent/index',
  ],
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
