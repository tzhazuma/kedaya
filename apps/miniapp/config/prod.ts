import type { UserConfigExport } from '@tarojs/cli'

/**
 * 生产模式增量配置（会被 merge 进 config/index.ts 的 baseConfig）。
 *
 * 骨架阶段刻意保持为空。上线前需要在这里补：
 * - `mini.minifyXML` / 代码压缩策略
 * - `defineConstants` 注入生产 API 域名（或改用 TARO_APP_* 环境变量）
 */
const prodConfig: UserConfigExport<'webpack5'> = {
  mini: {},
  h5: {},
}

export default prodConfig
