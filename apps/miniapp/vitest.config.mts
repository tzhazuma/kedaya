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

    /**
     * ⚠️ 给超时留余量。
     *
     * ## 实测（2026-10-20）
     *
     * `超长标题与超长正文被拦截` 曾耗时 **5228 ms** 后失败，而单独重跑只需
     * **589 ms**，连跑 3 次全绿。默认 5000 ms 在**机器有负载时**（同时跑
     * 构建 / 部署 / 其他测试）会误杀正常测试 —— 不是测试慢，是环境在争 CPU。
     *
     * 20 s 给了约 3.5 倍余量，正常路径（< 1 s）不可能触发。
     *
     * ⚠️ 不要靠「提高超时」去掩盖真正慢的测试 —— 如果哪条测试常态超过
     * 2 秒，应该先查它为什么慢，而不是把它调到 20 秒。
     */
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
})
