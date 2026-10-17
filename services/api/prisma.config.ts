import { defineConfig } from 'prisma/config';

/**
 * Prisma 7 配置（`prisma.config.ts` 是 Prisma 7 起的新配置入口）。
 *
 * 为什么需要这个文件：
 *   Prisma 7 移除了 schema 里的 `datasource.url`。连接串改由两处提供：
 *     1. CLI（migrate / db / introspect）→ 本文件的 `datasource.url`
 *     2. 运行时 PrismaClient → driver adapter（`@prisma/adapter-pg`）
 *   详见 https://pris.ly/d/config-datasource
 */

// Prisma 7 不再自动读取 .env；这里用 Node 内置能力加载，避免引入 dotenv 依赖。
try {
  process.loadEnvFile('.env');
} catch {
  // .env 不存在（CI / 容器里直接用环境变量注入）时静默跳过
}

/**
 * 离线/本地开发兜底连接串。
 * 仅用于让 `prisma validate` / `prisma migrate diff` / `prisma generate`
 * 在没有 .env 的环境下也能跑通；真实部署必须显式设置 DATABASE_URL。
 *
 * ⚠️ 生产环境**不允许**使用兜底值：容器里 NODE_ENV=production，
 * 若 DATABASE_URL 没注入，回落到 localhost 只会得到一句"connection refused"，
 * 让人以为是数据库挂了。这里直接报错，把问题指向真正的成因（配置缺失）。
 */
const DEV_FALLBACK_URL = 'postgresql://kedaya:kedaya@localhost:5432/kedaya?schema=public';

function resolveDatasourceUrl(): string {
  const configured = process.env.DATABASE_URL;
  if (configured !== undefined && configured.trim() !== '') return configured;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'DATABASE_URL 未配置：生产环境必须显式提供数据库连接串（见 docs/deploy.md）。',
    );
  }
  return DEV_FALLBACK_URL;
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: resolveDatasourceUrl(),
  },
  migrations: {
    seed: 'node prisma/seed.mjs',
  },
});
