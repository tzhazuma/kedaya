import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotFoundError } from '../../common/errors/app-error';
import { encodeCursor } from '../../common/pagination/cursor';
import type { PrismaService } from '../../prisma/prisma.service';
import { WildlifeSpotPrismaRepository } from './data/wildlife.repository';
import { WildlifeSpotService } from './wildlife.service';
import type {
  CreateWildlifeSpotInput,
  WildlifeSpotModel,
  WildlifeSpotRepository,
} from './domain/wildlife.domain';

/**
 * 观察点用例与筛选翻译的可执行规格。
 *
 * 这一轮把这个模块从"通用 CRUD 骨架"变成可用切片，两处最容易悄悄坏掉的地方是：
 *   1. **筛选**：`filters` 是外部输入，翻译成 Prisma `where` 时必须显式列字段。
 *      写错成 `{ [key]: value }` 也能跑通、也不会报错 —— 只是把「谁上报过」
 *      这种查询能力顺手开放了。所以这里断言 where 的**精确形状**。
 *   2. **排序**：只看 `createdAt` 会在同一毫秒落库的两行之间漏读/重读，
 *      游标翻页因此不稳定。所以这里断言必须带 `id` 兜底。
 *
 * `confirm` 的语义（改状态而不是计数、幂等、不校验主体）也在覆盖范围内 ——
 * 客户端的「我也看到了」按钮完全依赖它。
 */

const CREATED_AT = new Date('2026-10-01T08:00:00.000Z');

const BASE: WildlifeSpotModel = {
  species: '黑天鹅',
  place: '湖畔东侧',
  lat: 31.180_215,
  lng: 121.593_118,
  note: '一对，常在上午出现，不要投喂面包。',
  reportedBy: null,
  status: 'active',
  createdAt: CREATED_AT,
  updatedAt: CREATED_AT,
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
    update: vi.fn().mockResolvedValue({ ...BASE, status: 'confirmed' }),
    remove: vi.fn().mockResolvedValue(undefined),
  };
}

function makeService(repo: FakeRepo): WildlifeSpotService {
  return new WildlifeSpotService(repo as unknown as WildlifeSpotRepository);
}

describe('WildlifeSpotService', () => {
  let repo: FakeRepo;
  let service: WildlifeSpotService;

  beforeEach(() => {
    repo = makeRepo();
    service = makeService(repo);
  });

  describe('list（筛选只透传，不加工）', () => {
    it('把 controller 白名单校验过的 filters 原样交给仓储', async () => {
      const params = { limit: 10, cursor: 'c1', filters: { species: '天鹅' } };

      await service.list(params);

      // 原样透传（同一份值，不是"看起来差不多"的新对象）
      expect(repo.list).toHaveBeenCalledTimes(1);
      expect(repo.list).toHaveBeenCalledWith(params);
    });

    it('没有筛选时不凭空造条件（避免"默认只看 active"这类隐性过滤）', async () => {
      await service.list({ limit: 20 });

      expect(repo.list).toHaveBeenCalledWith({ limit: 20 });
    });
  });

  describe('create（本模块匿名）', () => {
    it('忽略登录主体：请求体里有什么就写什么，不把 actorId 塞进 reportedBy', async () => {
      const input: CreateWildlifeSpotInput = {
        species: '橘猫',
        place: '生活区 5 号楼门口',
        lat: 31.178_902,
        lng: 121.591_764,
        note: null,
      };

      await service.create(input, 'user-A');

      expect(repo.create).toHaveBeenCalledWith(input);
      expect(repo.create.mock.calls[0]?.[0]).not.toHaveProperty('reportedBy');
    });
  });

  describe('confirm（领域动作：改状态，不是计数）', () => {
    it('先读后写：不存在统一 NOT_FOUND，且不发出更新', async () => {
      repo.findById.mockResolvedValue(null);

      await expect(service.confirm('ghost')).rejects.toThrow(NotFoundError);
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('把 status 改成 confirmed 并返回最新实体', async () => {
      const confirmed = await service.confirm('ws-1');

      expect(repo.findById).toHaveBeenCalledWith('ws-1');
      expect(repo.update).toHaveBeenCalledWith('ws-1', { status: 'confirmed' });
      expect(confirmed.status).toBe('confirmed');
    });

    it('幂等：已经是 confirmed 时再确认一次仍然成功（不是个人投票，没有"重复确认"冲突）', async () => {
      repo.findById.mockResolvedValue({ ...BASE, status: 'confirmed' });

      await expect(service.confirm('ws-1')).resolves.toMatchObject({ status: 'confirmed' });
      expect(repo.update).toHaveBeenCalledWith('ws-1', { status: 'confirmed' });
    });

    it('不校验主体：未登录（actorId 为 undefined）也能确认', async () => {
      const confirmed = await service.confirm('ws-1');

      expect(repo.update).toHaveBeenCalledTimes(1);
      expect(confirmed.status).toBe('confirmed');
    });
  });
});

/* ------------------------------------------------------------------ *
 * 筛选 / 排序翻译（用假 Prisma delegate 断言真正下发的查询）
 * ------------------------------------------------------------------ */

type WildlifeRow = WildlifeSpotModel & { id: string };

function row(overrides: Partial<WildlifeRow> = {}): WildlifeRow {
  return { id: 'ws-1', ...BASE, ...overrides };
}

function makePrismaRepository(rows: WildlifeRow[] = []) {
  const findMany = vi.fn().mockResolvedValue(rows);
  const delegate = {
    findMany,
    findUnique: vi.fn().mockResolvedValue(null),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };
  // 只用到 `prisma.wildlifeSpot` 这一个 delegate：测试不碰真数据库，也不 import 真连接
  const prisma = { wildlifeSpot: delegate } as unknown as PrismaService;
  return { repository: new WildlifeSpotPrismaRepository(prisma), findMany };
}

/** 取 `findMany` 第一次调用的参数 */
function firstArgs(findMany: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const args = findMany.mock.calls[0]?.[0];
  return (args ?? {}) as Record<string, unknown>;
}

/** 领域模型是 Prisma 行的子集（不含 id），断言行形状时显式还原 */
function asRows(items: readonly WildlifeSpotModel[]): WildlifeRow[] {
  return items as unknown as WildlifeRow[];
}

describe('WildlifeSpotPrismaRepository · 筛选与排序', () => {
  it('species 翻译成 contains + insensitive', async () => {
    const { repository, findMany } = makePrismaRepository();

    await repository.list({ limit: 20, filters: { species: '天鹅' } });

    expect(firstArgs(findMany)).toMatchObject({
      where: { species: { contains: '天鹅', mode: 'insensitive' } },
    });
  });

  it('白名单之外的外部 key 一概不进 where（不是"顺手拼一下"）', async () => {
    const { repository, findMany } = makePrismaRepository();

    await repository.list({
      limit: 20,
      // controller 只放行 species；这里模拟"有人绕过校验塞了额外 key"
      filters: { species: '橘猫', reportedBy: 'user-A', id: 'ws-9', status: 'active' },
    });

    expect(firstArgs(findMany)).toMatchObject({
      where: { species: { contains: '橘猫', mode: 'insensitive' } },
    });
    expect(firstArgs(findMany).where).toEqual({
      species: { contains: '橘猫', mode: 'insensitive' },
    });
  });

  it('空串 / 纯空白 / 没有筛选时完全不传 where', async () => {
    const { repository, findMany } = makePrismaRepository();

    await repository.list({ limit: 20, filters: { species: '   ' } });
    await repository.list({ limit: 20 });
    await repository.list({ limit: 20, filters: {} });

    expect(findMany).toHaveBeenCalledTimes(3);
    for (const call of findMany.mock.calls) {
      expect(call[0]).not.toHaveProperty('where');
    }
  });

  it('排序：最新在前，id 兜底保证游标翻页不漏读', async () => {
    const { repository, findMany } = makePrismaRepository();

    await repository.list({ limit: 20 });

    expect(firstArgs(findMany).orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
  });

  it('翻页：多取一条判断 hasMore，游标解码成记录 id', async () => {
    const { repository, findMany } = makePrismaRepository([
      row({ id: 'ws-3' }),
      row({ id: 'ws-2' }),
      row({ id: 'ws-1' }),
    ]);

    const page = await repository.list({ limit: 2, cursor: encodeCursor('ws-3') });

    expect(firstArgs(findMany)).toMatchObject({
      take: 3,
      cursor: { id: 'ws-3' },
      skip: 1,
    });
    // 脚手架生成的领域模型**不含 id**（它是 Prisma 行的子集），因此显式按行形状断言
    expect(asRows(page.items).map((item) => item.id)).toEqual(['ws-3', 'ws-2']);
    expect(page.nextCursor).toBe(encodeCursor('ws-2'));
  });

  it('最后一页 nextCursor 为 null，且行字段被原样映射成领域模型', async () => {
    const { repository } = makePrismaRepository([row({ id: 'ws-1' })]);

    const page = await repository.list({ limit: 20 });

    expect(page.nextCursor).toBeNull();
    expect(page.items[0]).toMatchObject({ id: 'ws-1', species: '黑天鹅', status: 'active' });
  });
});
