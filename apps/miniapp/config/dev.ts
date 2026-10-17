import type { UserConfigExport } from '@tarojs/cli'

/**
 * 开发模式增量配置（会被 merge 进 config/index.ts 的 baseConfig）。
 *
 * 骨架阶段刻意保持为空：小程序端的 dev 差异主要是 sourcemap / 热更新开关，
 * Taro 已按 NODE_ENV=development 自动处理。需要时在这里加 `mini.webpackChain`。
 */
const devConfig: UserConfigExport<'webpack5'> = {
  mini: {},
  h5: {},
}

export default devConfig
