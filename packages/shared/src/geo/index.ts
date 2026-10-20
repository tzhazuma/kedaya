/**
 * 地理工具（三端共用，**纯 TS 无框架依赖**）。
 *
 * 分层原则：
 *   - **坐标转换、距离、网格吸附** → 放这里，三端都要用
 *   - **隐私模糊化的完整流水线（含 HMAC 加噪）** → 放服务端
 *     （`services/api/src/modules/wildlife/domain/fuzzing.ts`）
 *     理由：它是**隐私保证**，必须由服务端强制执行；客户端拿到未模糊的坐标
 *     就已经输了，让客户端"自己模糊"等于没有保证。而且它需要 `node:crypto`。
 */

export * from './types';
export * from './gcj02';
export * from './local';
export * from './grid';
export * from './bd09';
