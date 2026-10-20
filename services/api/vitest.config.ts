import { defineConfig } from 'vitest/config';

export default defineConfig({
  // NestJS 使用 TypeScript 的 legacy 装饰器 + 元数据反射做依赖注入。
  // Vite 8 的转换器（oxc）默认不开启 legacy 装饰器；这里显式打开，
  // 否则任何带 `@Controller` / `@Injectable` 的测试文件都会以
  // "SyntaxError: Invalid or unexpected token" 失败。
  oxc: {
    decorator: {
      legacy: true,
      emitDecoratorMetadata: true,
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts', 'test/**/*.spec.ts'],
    globals: false,
    // 每个测试文件独立进程池，避免 Prisma / reflect-metadata 全局态互相污染
    pool: 'forks',
    setupFiles: ['./test/setup.ts'],

    /**
     * ⚠️ 超时必须有界，否则一个挂起会静默吃掉十几分钟。
     *
     * ## 实测背景（2026-10-20）
     *
     * 全量 98 个文件，实测约 **1/9 概率**出现 2–5 条偶发失败。
     * 失败时耗时 **780 秒** —— 那是**挂起**，不是断言失败：
     * 默认的 5s/10s 超时没生效过（挂起发生在进程层面），
     * 进程一直卡到外层 `timeout` 才被收掉。
     *
     * 已经查过并排除的：
     * - 不是端口冲突：PGlite socket 用 `port: 0`，由内核分配
     * - 不是迁移太重：只有 5 个 PGlite 文件、10 条迁移，单跑 6 秒
     * - 单独重跑失败文件全过；连续 6 次全量也全过 → 确实是偶发
     *
     * **根因未定位**。所以这里不猜、也不加重试（重试只会掩盖真问题）。
     * 只做一件确定有用的事：**给超时设上界**，让偶发挂起在 2 分钟内
     * 以一条明确的失败出现，而不是 13 分钟静默无输出。
     *
     * 取值依据：正常单文件 < 7 秒，全量 9–36 秒。
     * 30s / 90s 给了 4–13 倍余量，正常路径不可能触发。
     */
    testTimeout: 30_000,
    hookTimeout: 90_000,

    /**
     * 限制并发 fork 数（默认 = CPU 数，本机 12）。
     *
     * 5 个文件要起 PGlite（WASM Postgres）并跑迁移，12 路并发时
     * 这些 WASM 实例会互相争 CPU。收到 6 路仍有核数一半的并发，
     * 但给 WASM 计算留了余量。
     *
     * ⚠️ 这是**降低触发概率**，不是修复。根因仍未定位。
     */
    maxForks: 6,
  },
});
