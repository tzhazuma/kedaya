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
  },
});
