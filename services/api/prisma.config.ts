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
 */
const DEV_FALLBACK_URL = 'postgresql://kedaya:kedaya@localhost:5432/kedaya?schema=public';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: process.env.DATABASE_URL ?? DEV_FALLBACK_URL,
  },
  migrations: {
    seed: 'node prisma/seed.ts',
  },
});
