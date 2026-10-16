import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts', 'test/**/*.spec.ts'],
    globals: false,
    // 每个测试文件独立进程池，避免 Prisma / reflect-metadata 全局态互相污染
    pool: 'forks',
    setupFiles: ['./test/setup.ts'],
  },
});
