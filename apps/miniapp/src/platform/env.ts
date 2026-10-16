import Taro from '@tarojs/taro'

/**
 * 运行端判定。
 *
 * 优先用**构建期常量** `process.env.TARO_ENV`（Taro 在编译时静态注入，
 * 因此无关分支会被 tree-shaking 干掉），运行时 API 只作为兜底。
 */

export type KdyPlatform = 'weapp' | 'h5' | 'unknown'

export function currentPlatform(): KdyPlatform {
  const buildTimeEnv = typeof process !== 'undefined' ? process.env.TARO_ENV : undefined
  if (buildTimeEnv === 'weapp' || buildTimeEnv === 'h5') return buildTimeEnv

  try {
    const env = Taro.getEnv()
    if (env === Taro.ENV_TYPE.WEAPP) return 'weapp'
    if (env === Taro.ENV_TYPE.WEB) return 'h5'
  } catch {
    // 非 Taro 运行时（例如 node 测试环境）：落到 unknown
  }

  return 'unknown'
}

export function isWeapp(): boolean {
  return currentPlatform() === 'weapp'
}

export function isH5(): boolean {
  return currentPlatform() === 'h5'
}
