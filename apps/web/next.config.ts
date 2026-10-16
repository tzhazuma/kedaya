import type { NextConfig } from 'next';

/**
 * 可达鸭 Web 门户 —— Next.js 16 App Router 配置。
 *
 * `transpilePackages`：`@kedaya/*` 三个共享包是 **TypeScript 源码包**
 * （package.json 的 main/types 直接指向 src/*.ts），Next 必须先转译它们，
 * 否则 webpack 会因为遇到 .ts 语法而报错。
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ['@kedaya/design-tokens', '@kedaya/contracts', '@kedaya/shared'],
  // 注意：Next 16 已移除 `eslint` 配置键（`next lint` 被移除，lint 走独立 eslint CLI）。
  typescript: {
    // 类型错误必须在 `npm run typecheck` 里显式暴露，不允许被 build 静默吞掉
    ignoreBuildErrors: false,
  },
};

export default nextConfig;
