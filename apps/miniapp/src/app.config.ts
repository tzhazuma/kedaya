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
  ],
  window: {
    backgroundTextStyle: 'light',
    navigationBarBackgroundColor: color.brand,
    navigationBarTitleText: '可达鸭',
    navigationBarTextStyle: 'black',
    backgroundColor: color.bg,
    enablePullDownRefresh: false,
  },
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
