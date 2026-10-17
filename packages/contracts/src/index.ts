/**
 * @kedaya/contracts —— 可达鸭三端共享契约
 *
 * 唯一真相来源是 `openapi/kedaya.v1.yaml` + 本目录的 TS 类型。
 * 三端（微信小程序 / Web / NestJS API）必须使用同一套信封、错误码与模块表。
 *
 * ⚠️ 相对导入**必须带 `.ts` 扩展名**：
 * 本包的 `main` 指向 TS 源码，后端 `tsc` 产物在运行时直接 `require('@kedaya/contracts')`，
 * 由 Node 的类型剥离直接执行源码。Node 的 ESM 解析器不做扩展名补全，
 * 写成 `./envelope` 会在启动时报 `ERR_MODULE_NOT_FOUND`。
 * `rewriteRelativeImportExtensions` 会在编译产物里把 `.ts` 重写回 `.js`。
 */

export * from './envelope.ts';
export * from './modules.ts';
