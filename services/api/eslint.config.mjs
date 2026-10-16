// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * 扁平配置（ESLint 10）。
 * 刻意**不**开启 type-aware 规则（不传 projectService）：后端骨架阶段，
 * 类型正确性由 `npm run typecheck`（tsc）保证，lint 只负责语法/风格/明显错误，
 * 这样 `npm run lint` 快且不会因为类型信息缺失而误报。
 */
export default tseslint.config(
  {
    ignores: ['dist/**', 'coverage/**', 'node_modules/**', 'prisma/migrations/**'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    rules: {
      // 骨架阶段允许显式 any：Prisma delegate 的结构化抽象需要它
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // NestJS 依赖注入靠构造函数参数属性，空构造函数是有意的
      '@typescript-eslint/no-empty-function': 'off',
    },
  },
  {
    // 纯 Node 脚本（如 `prisma/seed.mjs`）：没有 TS 类型系统兜底，
    // 但 `console` / `process` 是 Node 全局，必须显式声明，否则 no-undef 全红。
    files: ['**/*.mjs'],
    languageOptions: {
      globals: { console: 'readonly', process: 'readonly', URL: 'readonly' },
    },
  },
);
