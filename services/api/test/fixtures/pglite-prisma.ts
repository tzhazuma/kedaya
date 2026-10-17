/**
 * 测试夹具：**真实的 PostgreSQL + pgvector + 真实的 PrismaClient**（离线）
 *
 * ## 为什么不用内存假 Prisma
 *
 * `wildlife` 的 HTTP e2e 用了一个内存版假 Prisma，那是合理的取舍 ——
 * 但 buddy 有两件事**只能**在真库上验证：
 *   1. `embedding` 是 `Unsupported("vector(768)")`，写入/读取只能走
 *      `$executeRaw` / `$queryRaw` 的 `<=>` 算子 —— 假 Prisma 里的"假 `<=>`"
 *      只能证明"我按我自己的理解实现了 `<=>`"，什么都证明不了；
 *   2. `join` / `decide` 的并发正确性依赖 `SELECT ... FOR UPDATE` 行锁 ——
 *      行锁是数据库能力，不是应用逻辑。
 *
 * 所以这里用 **PGlite**（PostgreSQL 的 WASM 构建，node_modules 里已有）
 * 起一个真实的 PostgreSQL，把三份迁移**真的执行一遍**，
 * 再通过 `@electric-sql/pglite-socket` 暴露 TCP，让**真实的 PrismaClient**
 * （`@prisma/adapter-pg`）连上去。于是测试跑的是真 SQL、真约束、真锁。
 *
 * ## 两条必须知道的限制（如实声明）
 *
 * 1. **PGlite 的 socket 服务端把查询全局串行化**（`QueryQueueManager`）。
 *    因此"20 个并发 decide"在本夹具下是**串行**执行的 ——
 *    它仍然验证了"锁内重新检查名额"的逻辑（超员的那次会拿到 `POST_FULL`），
 *    但**不能**证明"真并发下不会超员"。后者需要真实的多连接 PostgreSQL。
 * 2. PGlite 是单数据库实例，没有 `CREATE DATABASE`，因此不能跑
 *    `prisma migrate dev` 的影子库流程 —— 迁移用 `db.exec` 直接执行 SQL 文件。
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

/** 迁移目录（按顺序执行）。顺序不能改 —— 后面依赖前面建的 `User` 表。 */
const MIGRATION_DIRS = [
  '20261017030000_init',
  '20261017040000_wildlife',
  '20261017050000_buddy',
  // TechPie 整合 Phase 0（规格 §5 / §9.1）：重塑 TechpieLink + 新增
  // TechpieSyncJob / CampusSession。**建表，不产生任何凭证副本**。
  '20261017060000_techpie',
  // 校园卡（契约 §11.21-B / §11.19-A）：happenedAt → occurredAt、
  // TechpieLink.status 默认值 UNLINKED → PENDING。
  '20261017070000_campus_card',
];

/** 定位 `services/api/prisma/migrations`（从仓库根或从 services/api 调用都能找到） */
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

export interface PglitePrisma {
  /** 真实 PrismaClient（通过 pg driver adapter 连到 PGlite） */
  prisma: PrismaClient;
  /** 直连句柄，用于执行夹具自身的 DDL/DML 与原生断言 */
  db: PGlite;
  connectionString: string;
  dispose(): Promise<void>;
}

/**
 * 把所有查询**串行化**的代理。
 *
 * ## 为什么必须这样做（这是一个真实的、已实测的 PGlite 限制）
 *
 * PGlite 的 socket 服务端用 `QueryQueueManager` 把查询**全局串行化**，
 * 它**不能**处理同一个客户端上并发的多条查询。实测：
 *
 * ```js
 * await Promise.all([$queryRaw`SELECT 1`, $queryRaw`SELECT 2`, $queryRaw`SELECT 3`])
 * // → Raw query failed. Message: `Server has closed the connection.`
 * //   下一条查询又能成功（连接会被重连）
 * ```
 *
 * 于是任何在生产代码里**完全正确**的 `Promise.all([...3 个查询])`
 * （真实 PostgreSQL + Prisma 连接池下是标准写法，能省两次往返）
 * 在这个夹具里都会偶发失败。
 *
 * **修法选择**：不改生产代码去迁就测试环境，而是让夹具**如实地**
 * 表现为"一个把查询串行执行的数据库" —— 这正是 PGlite 的真实语义。
 * 串行化只改变并发度，不改变任何一条 SQL 的语义或结果。
 *
 * `$transaction(callback)` 不受影响：回调里的 `tx` 是 Prisma 自己的事务客户端，
 * 不走本代理，因此不会与队列互相等待。
 */
function serializeQueries<T extends object>(client: T): T {
  let queue: Promise<unknown> = Promise.resolve();

  const enqueue = <R>(run: () => Promise<R>): Promise<R> => {
    const next = queue.then(run, run);
    // 队列本身必须吞掉错误，否则一次失败会卡死后续所有查询
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
          return (...args: unknown[]) => enqueue(() => (value as (...a: unknown[]) => Promise<unknown>).apply(inner, args));
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
      // Prisma 的模型 delegate（prisma.buddyPost 等）是对象，需要再包一层
      if (value !== null && typeof value === 'object') {
        return wrapMethods(value);
      }
      return value;
    },
  }) as T;
}

export async function createPglitePrisma(): Promise<PglitePrisma> {
  const db = new PGlite({ extensions: { vector } });
  const root = migrationsRoot();

  for (const dir of MIGRATION_DIRS) {
    await db.exec(readFileSync(join(root, dir, 'migration.sql'), 'utf8'));
  }

  const server = new PGLiteSocketServer({ db, port: 0, host: '127.0.0.1' });
  await server.start();
  // `sslmode=disable` 是必需的：PGlite 的 socket 不实现 SSLRequest 协商，
  // 而 Prisma 的 Rust 引擎默认 sslmode=prefer 会先发 SSLRequest 然后连接失败。
  const connectionString = `postgresql://postgres:postgres@${server.getServerConn()}/postgres?sslmode=disable`;

  const raw = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  // 见 `serializeQueries` 的注释：PGlite 只能串行执行查询，
  // 因此夹具把客户端包成串行代理（生产代码里的 Promise.all 是正确写法，不改）。
  const prisma = serializeQueries(raw) as PrismaClient;

  return {
    prisma,
    db,
    connectionString,
    async dispose() {
      await raw.$disconnect();
      await server.stop();
      await db.close();
    },
  };
}

/** 造一个最小的 ConfigService 替身（仓储只读几个键） */
export function fakeConfig(values: Record<string, string> = {}): {
  get: (key: string) => string | undefined;
} {
  return { get: (key: string) => values[key] };
}

/**
 * 等连接恢复。
 *
 * ⚠️ PGlite 的 socket 服务端在**语句级错误**之后会关闭当前连接；
 * Prisma 会自动重连，但"下一条语句"有可能撞在关闭中的连接上，
 * 表现为 `Server has closed the connection`。这是夹具的已知特性，
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

/** 插入一个用户（帖子与资料都有外键指向它） */
export async function seedUser(
  prisma: PrismaClient,
  id: string,
  displayName = '鸭鸭',
): Promise<void> {
  await prisma.user.create({
    data: { id, displayName, avatarUrl: null, department: '信息学院' },
  });
}
