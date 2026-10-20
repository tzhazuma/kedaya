/**
 * @kedaya/shared —— 三端共享的纯工具。
 *
 * 约束：本包**不得**依赖任何框架（无 React / 无 Taro / 无 Nest），
 * 只允许纯 TS 逻辑，以便 Web、小程序、Node 后端共用。
 *
 * ⚠️ 相对导入是 **extensionless** 的，原因同 `@kedaya/contracts`：
 * 打包器（Web / 小程序 / vitest）能补全，服务端「tsc 产物 + Node 跑 CJS」那条路径
 * 靠预加载补丁 `services/api/register-workspace-modules.cjs` 改指到 `dist/packages/**`。
 * 详见 `docs/local-development.md` §6。
 */

export * from './result';
export * from './money';
export * from './time';
export * from './validate';
export * from './geo';
export * from './buddy';
export * from './nutrition';
export * from './group-import';
export * from './deadline-normalize';
export * from './deadline-paste';
export * from './deadline-html';
export * from './deadline-ics';

// ---- 从同学项目合并（见 docs/architecture/12-merged-from-classmates.md）----
export * from './deadline-parse-html';
export * from './wechat-article';
export * from './deadline-nextddl-week';
export * from './deadline-parse-gradescope';
export * from './deadline-parse-blackboard';
export * from './deadline-parse-eams';
export * from './deadline-section';
export * from './deadline-source-url';
