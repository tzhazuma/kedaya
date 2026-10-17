/**
 * 联系方式交换 · 测试夹具：真实 PostgreSQL（PGlite）+ 真实 PrismaClient
 *
 * ## 为什么不用内存假 Prisma
 *
 * 本模块有三件事只能在真库上证明：
 *   1. 手写迁移里的**部分唯一索引**（同一对用户最多一条活跃申请）真的生效；
 *   2. AES-256-GCM 密文列里**真的**搜不到明文；
 *   3. `ON DELETE CASCADE` / `@@unique` 这些约束不是摆设。
 *
 * ## 为什么不用共享的 `test/fixtures/pglite-prisma.ts`
 *
 * 那个夹具硬编码了 `20261017070000_campus_card`（当前工作树里不存在），
 * 会先于本模块的断言失败。本夹具只执行**本模块需要的两份迁移**：
 * `20261017030000_init`（User 表）与 `20261017190000_contact_exchange`。
 * 这不改变任何被验证的语义 —— 只是把依赖面缩到最小。
 *
 * ## PGlite 限制
 *
 * PGlite 的 socket 服务端把查询全局串行化。这里用与共享夹具相同的串行代理，
 * 让并发调用表现为"单连接数据库"。它不改变任何一条 SQL 的语义。
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

const MIGRATION_DIRS = ['20261017030000_init', '20261017190000_contact_exchange'];

function migrationsRoot(): string {
  const candidates = [
    join(process.cwd(), 'prisma', 'migrations'),
    join(process.cwd(), 'services', 'api', 'prisma', 'migrations'),
  ];
  for (const candidate of candidates) {
    if (existsSync(join(candidate, MIGRATION_DIRS[0] as string))) return candidate;
  }
  throw new Error(`找不到 prisma/migrations（cwd=${process.cwd()}）`);
}

function serializeQueries<T extends object>(client: T): T {
  let queue: Promise<unknown> = Promise.resolve();

  const enqueue = <R>(run: () => Promise<R>): Promise<R> => {
    const next = queue.then(run, run);
    queue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };

  const wrapMethods = (target: object): object =>
    new Proxy(target, {
      get(inner, prop, receiver) {
        const value = Reflect.get(inner, prop, receiver);
        if (typeof value === 'function') {
          return (...args: unknown[]) =>
            enqueue(() => (value as (...a: unknown[]) => Promise<unknown>).apply(inner, args));
        }
        return value;
      },
    });

  return new Proxy(client, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value === 'function') {
        return (...args: unknown[]) =>
          enqueue(() => (value as (...a: unknown[]) => Promise<unknown>).apply(target, args));
      }
      if (value !== null && typeof value === 'object') return wrapMethods(value);
      return value;
    },
  }) as T;
}

export interface ContactPglite {
  prisma: PrismaClient;
  db: PGlite;
  dispose(): Promise<void>;
}

export async function createContactPglite(): Promise<ContactPglite> {
  const db = new PGlite();
  const root = migrationsRoot();

  for (const dir of MIGRATION_DIRS) {
    await db.exec(readFileSync(join(root, dir, 'migration.sql'), 'utf8'));
  }

  const server = new PGLiteSocketServer({ db, port: 0, host: '127.0.0.1' });
  await server.start();
  const connectionString = `postgresql://postgres:postgres@${server.getServerConn()}/postgres?sslmode=disable`;

  const raw = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  const prisma = serializeQueries(raw) as PrismaClient;

  return {
    prisma,
    db,
    async dispose() {
      await raw.$disconnect();
      await server.stop();
      await db.close();
    },
  };
}

/** 插入一个最小用户（联系方式条目与会话都有外键指向 User） */
export async function seedContactUser(
  prisma: PrismaClient,
  id: string,
  displayName = '鸭鸭',
): Promise<void> {
  await prisma.user.create({ data: { id, displayName, department: '信息学院' } });
}

/**
 * 等连接恢复。
 *
 * PGlite 的 socket 服务端在**语句级错误**（例如唯一约束冲突）之后会关闭当前连接；
 * Prisma 会自动重连，但"下一条语句"可能撞在关闭中的连接上。这是夹具的已知特性，
 * 不是被测代码的问题。因此在**故意制造数据库错误**的断言之后显式等一次重连。
 */
export async function reconnect(prisma: PrismaClient, attempts = 10): Promise<void> {
  for (let i = 0; i < attempts; i += 1) {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
  }
  throw new Error('PGlite 连接在重试后仍未恢复');
}
