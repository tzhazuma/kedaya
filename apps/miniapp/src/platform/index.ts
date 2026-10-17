/**
 * 平台适配层（契约 §7）。
 *
 * 这里是**唯一**允许直接依赖微信 / H5 宿主能力的地方；
 * 每个模块都在文件头注明了「微信特有」与「H5 降级」行为。
 */
export * from './capabilities'
export * from './env'
export * from './failure'
export * from './location'
export * from './map'
export * from './mediaPicker'
export * from './navigation'
export * from './scanner'
export * from './share'
export * from './log'
export * from './subscribeMessage'
export * from './wechatLogin'
