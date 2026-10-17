import { defineConfig } from 'vitest/config'

/**
 * Vitest 只跑**纯逻辑**测试（domain / application / data 的非 UI 部分）。
 *
 * 为什么不需要 Taro 运行时：六边形架构下 `presentation` 之外的所有层
 * 都不 import `@tarojs/*`（Taro 只出现在 `data/api/taroHttpAdapter.ts`、
 * `data/storage/taroStorage.ts`、`platform/*` 这些真正的 adapter 里）。
 * 因此测试跑在 node 环境即可，不需要小程序模拟器。
 *
 * 文件用 `.mts` 扩展名（而不是 `.ts`）：package.json 没有 `"type": "module"`，
 * Vite 会把这个配置当 CommonJS 加载并给出 ESM 语法警告，`.mts` 可以避免。
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    // 三个 @kedaya/* 包以 TS 源码（main: ./src/index.ts）形式被 workspace 链接，
    // 必须让 Vite 直接编译它们，而不是当预打包依赖处理。
    server: {
      deps: {
        inline: [/@kedaya\//],
      },
    },
  },
})
