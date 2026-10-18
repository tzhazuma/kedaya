/**
 * @kedaya/contracts —— 可达鸭三端共享契约
 *
 * 唯一真相来源是 `openapi/kedaya.v1.yaml` + 本目录的 TS 类型。
 * 三端（微信小程序 / Web / NestJS API）必须使用同一套信封、错误码与模块表。
 *
 * ⚠️ 相对导入是 **extensionless** 的（`./envelope`）—— 打包器（小程序 / Web / vitest）
 * 都能补全，所以源码直接可用。唯一不行的是「`tsc` 产物 + Node 直接跑 CJS」这条路径：
 * 本包 `main` 指向 TS 源码，Node 会去解析 `./envelope` 而失败。
 * 服务端因此用 `services/api/register-workspace-modules.cjs`（`node -r` 预加载）
 * 把 `@kedaya/contracts` 改指到编译产物 `dist/packages/contracts/src/index.js`，
 * 那里是 CJS，`require('./envelope')` 能正确解析到 `./envelope.js`。
 * 改这里的导入形式前先读 `docs/local-development.md` §6。
 */

export * from './envelope';
export * from './modules';
export * from './buddy-tags';
export * from './pages';
export * from './contact-exchange';
export * from './campus-map';
export * from './campus-services';
export * from './group-bot';
