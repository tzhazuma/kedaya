import next from 'eslint-config-next';

/**
 * ESLint 10 扁平配置。
 * `eslint-config-next`（16.4.2）已导出扁平配置数组，直接展开即可。
 */
const config = [
  ...next,
  {
    ignores: ['.next/**', 'node_modules/**', 'public/**', 'next-env.d.ts'],
  },
];

export default config;
