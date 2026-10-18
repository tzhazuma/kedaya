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
 *
 * 默认白色背景，页面使用微信原生顶部导航区；底部仍使用自绘悬浮 dock，
 * 所以这里**不配置原生 tabBar**：
 * 原生 tabBar 只能是「白底 + 文字/图片图标」，做不出设计里的浮动胶囊导航栏。
 */

const color = tokens.color

export default {
  pages: [
    'presentation/pages/welcome/index',
    'presentation/pages/home/index',
    'presentation/pages/discover/index',
    'presentation/pages/messages/index',
    'presentation/pages/profile/index',
    'presentation/pages/groupbuy/list/index',
    'presentation/pages/groupbuy/detail/index',
    'presentation/pages/groupbuy/create/index',
    'presentation/pages/wildlife/map/index',
    'presentation/pages/wildlife/encounter/index',
    'presentation/pages/wildlife/archive/index',
    'presentation/pages/wildlife/resident/index',
    'presentation/pages/wildlife/identity/index',
  ],
  window: {
    backgroundTextStyle: 'light',
    navigationBarBackgroundColor: color.surface,
    navigationBarTitleText: '可达鸭',
    navigationBarTextStyle: 'black',
    backgroundColor: color.surface,
    enablePullDownRefresh: false,
  },
  permission: { 'scope.userLocation': { desc: '用于显示你在校园地图的位置，并在你确认后记录动物偶遇地点。实时位置不会上传。' } },
  requiredPrivateInfos: ['getLocation', 'chooseLocation', 'startLocationUpdate', 'onLocationChange'],
}
