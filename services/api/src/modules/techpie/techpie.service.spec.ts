import { DEFAULT_PAGE_SIZE } from '@kedaya/contracts';
import { describe, expect, it, vi } from 'vitest';
import { NotFoundError } from '../../common/errors/app-error';
import { encodeCursor } from '../../common/pagination/cursor';
import type { PrismaService } from '../../prisma/prisma.service';
import { TechpieController } from './techpie.controller';
import { TechpieLinkService } from './techpie.service';
import { TechpieLinkPrismaRepository } from './data/techpie.repository';
import type { TechpieLinkModel, TechpieLinkRepository } from './domain/techpie.domain';

/**
 * TechPie 整合「筛选 + 排序 + sync 语义」的可执行规格。
 *
 * 这一层最容易出三类**不报错但会静默坏事**的问题：
 *   1. 筛选没进 `where` → 用户点了「教务」却还是看到全部条目；
 *   2. 排序没有 id 兜底 → 同一毫秒落库的两行在翻页时漏读 / 重读；
 *   3. `sync` 被说成/写成"去对端同步" → 页面对用户撒谎。
 * 所以断言直接落在仓储真正发给 Prisma 的参数、以及 `sync` 真正写库的内容上。
 *
 * 依赖一律用假仓储 / 假 Prisma delegate（参照 notifications.service.spec.ts），
 * 不连数据库、不起 Nest 容器。
 */

const BASE: TechpieLinkModel = {
  id: 'tp-1',
  key: 'techpie-jwc',
  name: '教务系统',
  category: 'academic',
  url: 'https://jwc.shanghaitech.edu.cn/',
  status: 'active',
  createdAt: new Date('2026-10-01T00:00:00.000Z'),
  updatedAt: new Date('2026-10-01T00:00:00.000Z'),
};

interface FakeRepo {
  list: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
  findById: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
}

function makeRepo(): FakeRepo {
  return {
    list: vi.fn().mockResolvedValue({ items: [BASE], nextCursor: null }),
    create: vi.fn().mockResolvedValue(BASE),
    findById: vi.fn().mockResolvedValue(BASE),
    update: vi.fn().mockResolvedValue(BASE),
    remove: vi.fn().mockResolvedValue(undefined),
  };
}

function makeService(repo: FakeRepo): TechpieLinkService {
  return new TechpieLinkService(repo as unknown as TechpieLinkRepository);
}

/** 最小 Prisma 替身：只提供 techpieLink 上的 findMany */
function makePrisma() {
  const findMany = vi.fn().mockResolvedValue([]);
  const prisma = { techpieLink: { findMany } } as unknown as PrismaService;
  return { prisma, findMany };
}

describe('TechpieLinkService.list（筛选透传）', () => {
  it('把 category / q 组装出的 filters 原样交给仓储，不吞不改', async () => {
    const repo = makeRepo();
    const service = makeService(repo);

    await service.list({ limit: 10, filters: { category: 'academic', q: 'vpn' } });

    expect(repo.list).toHaveBeenCalledWith({
      limit: 10,
      filters: { category: 'academic', q: 'vpn' },
    });
  });

  it('没有筛选时不凭空造一个 filters', async () => {
    const repo = makeRepo();
    const service = makeService(repo);

    await service.list({ limit: DEFAULT_PAGE_SIZE });

    expect(repo.list).toHaveBeenCalledWith({ limit: DEFAULT_PAGE_SIZE });
  });
});

describe('TechpieController.list（查询参数 → filters 映射）', () => {
  function makeController() {
    const service = { list: vi.fn().mockResolvedValue({ items: [], nextCursor: null }) };
    const controller = new TechpieController(service as unknown as TechpieLinkService);
    return { service, controller };
  }

  it('category + q 组装成 filters，limit 缺省用默认页大小', async () => {
    const { service, controller } = makeController();

    await controller.list({ category: 'academic', q: '教务' });

    expect(service.list).toHaveBeenCalledWith({
      limit: DEFAULT_PAGE_SIZE,
      filters: { category: 'academic', q: '教务' },
    });
  });

  it('只给 category 时不混入 q', async () => {
    const { service, controller } = makeController();

    await controller.list({ category: 'network' });

    expect(service.list).toHaveBeenCalledWith({
      limit: DEFAULT_PAGE_SIZE,
      filters: { category: 'network' },
    });
  });

  it('没有任何筛选时连 filters 都不传（避免空对象进 where）', async () => {
    const { service, controller } = makeController();

    await controller.list({});

    expect(service.list).toHaveBeenCalledWith({ limit: DEFAULT_PAGE_SIZE });
  });

  it('cursor 与 limit 原样透传（游标分页靠它续页）', async () => {
    const { service, controller } = makeController();

    await controller.list({ cursor: 'abc', limit: 5 });

    expect(service.list).toHaveBeenCalledWith({ cursor: 'abc', limit: 5 });
  });
});

describe('TechpieLinkService.sync（真实语义：只写 status，不做同步）', () => {
  it('先查详情、再把 status 写成 synced（顺序也断言：不存在的 id 不该被写）', async () => {
    const repo = makeRepo();
    const service = makeService(repo);

    await service.sync('tp-1');

    expect(repo.findById).toHaveBeenCalledWith('tp-1');
    expect(repo.update).toHaveBeenCalledWith('tp-1', { status: 'synced' });
    // 写入内容里除了 status 没有任何其它字段（没有假装去对端拿数据）
    expect(repo.update.mock.calls[0]?.[1]).toEqual({ status: 'synced' });
  });

  it('不存在的 id → NotFoundError，且**不写库**', async () => {
    const repo = makeRepo();
    repo.findById.mockResolvedValue(null);
    const service = makeService(repo);

    await expect(service.sync('ghost')).rejects.toBeInstanceOf(NotFoundError);
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('幂等：已经是 synced 再点一次仍然写同一个值，不报冲突', async () => {
    const repo = makeRepo();
    repo.findById.mockResolvedValue({ ...BASE, status: 'synced' });
    const service = makeService(repo);

    await expect(service.sync('tp-1')).resolves.toEqual(BASE);
    expect(repo.update).toHaveBeenCalledWith('tp-1', { status: 'synced' });
  });
});

describe('TechpieLinkPrismaRepository（where / orderBy）', () => {
  it('category 精确 + q 同时模糊 name 与 url，排序固定最新在前且带 id 兜底', async () => {
    const { prisma, findMany } = makePrisma();
    const repository = new TechpieLinkPrismaRepository(prisma);

    await repository.list({ limit: 20, filters: { category: 'academic', q: 'vpn' } });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          category: 'academic',
          OR: [
            { name: { contains: 'vpn', mode: 'insensitive' } },
            { url: { contains: 'vpn', mode: 'insensitive' } },
          ],
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        // 多取一条用于判断"还有没有下一页"
        take: 21,
      }),
    );
  });

  it('只给 q 时在 name / url 里模糊匹配，并去掉首尾空格', async () => {
    const { prisma, findMany } = makePrisma();
    const repository = new TechpieLinkPrismaRepository(prisma);

    await repository.list({ limit: 20, filters: { q: '  图书馆  ' } });

    const args = findMany.mock.calls[0]?.[0] as { where: unknown; orderBy: unknown };
    expect(args.where).toEqual({
      OR: [
        { name: { contains: '图书馆', mode: 'insensitive' } },
        { url: { contains: '图书馆', mode: 'insensitive' } },
      ],
    });
  });

  it('没有筛选时不下发 where，但排序仍是 createdAt desc + id desc', async () => {
    const { prisma, findMany } = makePrisma();
    const repository = new TechpieLinkPrismaRepository(prisma);

    await repository.list({ limit: 20 });

    const args = findMany.mock.calls[0]?.[0] as { where?: unknown; orderBy: unknown };
    expect(args.where).toBeUndefined();
    expect(args.orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
  });

  it('白名单之外的 key 与空白值都被忽略（不能变成任意字段查询）', async () => {
    const { prisma, findMany } = makePrisma();
    const repository = new TechpieLinkPrismaRepository(prisma);

    await repository.list({
      limit: 20,
      // 混入未登记的键，以及被清空的 q
      filters: { category: 'service', q: '   ', evil: 'drop table' },
    });

    const args = findMany.mock.calls[0]?.[0] as { where: unknown };
    expect(args.where).toEqual({ category: 'service' });
  });

  it('游标解码后作为 Prisma cursor 并 skip 1', async () => {
    const { prisma, findMany } = makePrisma();
    const repository = new TechpieLinkPrismaRepository(prisma);

    await repository.list({ cursor: encodeCursor('tp-42'), limit: 20 });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: { id: 'tp-42' }, skip: 1 }),
    );
  });
});
