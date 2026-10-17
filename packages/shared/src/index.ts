/**
 * @kedaya/shared —— 三端共享的纯工具。
 *
 * 约束：本包**不得**依赖任何框架（无 React / 无 Taro / 无 Nest），
 * 只允许纯 TS 逻辑，以便 Web、小程序、Node 后端共用。
 *
 * ⚠️ 相对导入必须带 `.ts` 扩展名，原因同 `@kedaya/contracts`：
 * 后端 tsc 产物在运行时会直接加载本包源码，Node 的 ESM 解析器不做扩展名补全。
 */

export * from './result';
export * from './money';
export * from './time';
export * from './validate';
export * from './geo';
export * from './buddy';
