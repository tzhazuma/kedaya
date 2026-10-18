import tokens from '@kedaya/design-tokens/tokens.json'

/**
 * 入口页的页面配置。
 *
 * 导航栏仍用微信原生（白底黑字）—— 贴纸簿的"大标题"在页面内容里，
 * 原生导航栏只负责放"可达鸭"这个 app 名和系统级返回按钮。
 */
export default {
  navigationBarTitleText: '可达鸭',
  backgroundColor: tokens.color.surface,
}
