/**
 * `@electric-sql/pglite/vector` 的环境声明。
 *
 * 为什么需要它：本仓 `tsconfig.json` 用的是 `moduleResolution: Node10`，
 * 而 pglite 的 `exports` 映射（`"./vector"`）只在 `node16` / `nodenext` /
 * `bundler` 下被解析 —— Node10 解析不到，typecheck 会报
 * "Cannot find module '@electric-sql/pglite/vector'"。
 *
 * 改 `moduleResolution` 会影响**全仓**（`@kedaya/shared` 的
 * extensionless 相对导入依赖 Node10 的行为），代价远大于收益。
 * 因此这里只给这一个扩展入口补一份最小声明 —— 它只被测试夹具使用。
 */
declare module '@electric-sql/pglite/vector' {
  export const vector: {
    name: string;
    setup: (pg: unknown, emscriptenOpts: unknown) => Promise<{ emscriptenOpts: unknown; bundlePath: URL }>;
  };
}
