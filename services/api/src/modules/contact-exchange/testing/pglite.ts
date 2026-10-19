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

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
// 自动发现会把**全部**迁移都跑一遍，其中 `..._buddy` 需要 pgvector。
// 不带扩展建库会在那一步报 `extension "vector" is not available`。
import { vector } from '@electric-sql/pglite/vector';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

/**
 * 迁移目录：**自动发现**，按文件名排序执行。
 *
 * ⚠️ 这里曾经是一份硬编码的两项清单
 * （`['20261017030000_init', '20261017190000_contact_exchange']`）。
 * 它在本模块自己的测试里一直是对的，直到**别人**给 `User` 加了一列
 * （`deletedAt`，账号注销用）：
 *
 *   Prisma 客户端是按**完整** schema 生成的，所以 `prisma.user.create()`
 *   会带上 `deletedAt`；而数据库里只有那两份迁移建出来的表 → 
 *   `The column User.deletedAt does not exist in the current database`。
 *
 * 失败点在**别人的模块**里，看起来像"我给 User 加列把联系方式测试搞挂了"，
 * 实际根因是这份清单不会跟着 `prisma/migrations/` 长。
 *
 * `test/fixtures/pglite-prisma.ts` 早就改成自动发现了，注释里写着同一句话：
 * 「曾经硬编码的清单在'新增迁移忘了同步'时会静默失效」。
 * 这里改成同样的做法。
 */
function discoverMigrationDirs(root: string): string[] {
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

function migrationsRoot(): string {
  const candidates = [
    join(process.cwd(), 'prisma', 'migrations'),
    join(process.cwd(), 'services', 'api', 'prisma', 'migrations'),
  ];
  for (const candidate of candidates) {
    // 用"这个目录下有没有 `migration_lock.toml`"来判断，而不是拿某个
    // 具体迁移名当探针 —— 后者会在迁移改名/合并时静默失效。
    if (existsSync(join(candidate, 'migration_lock.toml'))) return candidate;
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
  const db = new PGlite({ extensions: { vector } });
  const root = migrationsRoot();

  for (const dir of discoverMigrationDirs(root)) {
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
