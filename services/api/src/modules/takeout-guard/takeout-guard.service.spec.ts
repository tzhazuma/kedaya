import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ConflictError,
  NotFoundError,
  UnauthenticatedError,
  ValidationError,
} from '../../common/errors/app-error';
import { TakeoutReportService } from './takeout-guard.service';
import {
  TAKEOUT_REPORT_DEFAULT_STATUS,
  TAKEOUT_REPORT_STATUS,
  TAKEOUT_REPORT_STATUSES,
  type TakeoutReportModel,
  type TakeoutReportRepository,
} from './domain/takeout-guard.domain';

/**
 * 偷外卖用例测试。
 *
 * 这个模块的风险不在 CRUD 能不能跑，而在**三条"能跑但会惹祸"的规则**：
 *   1. 归属必须来自 JWT。请求体里塞 `reporterId` / `status` 都不能生效，
 *      否则任何人都能替别人"举报"、或者直接把状态改成已解决；
 *   2. 记录只给本人看。列表强制收窄，别人的记录连"存在"都不能被确认；
 *   3. 状态只能走白名单与领域动作（pending → escalated → resolved）。
 *
 * 因此这里用假仓储断言"服务层到底写了什么、拒了什么"，而不是断言能返回数据。
 */

const OWNER = 'user-owner';
const OTHER = 'user-other';

/** 相对当前时间构造，避免测试随着真实日期推移而失效（发生时间不能晚于现在） */
function hourAgo(): Date {
  return new Date(Date.now() - 60 * 60 * 1000);
}

function report(overrides: Partial<TakeoutReportModel> = {}): TakeoutReportModel {
  return {
    id: 'tr-1',
    reporterId: OWNER,
    anonHandle: null,
    orderNo: 'KD2026101501',
    place: '生活区 5 号楼一层外卖架',
    happenedAt: hourAgo(),
    detail: '取餐时发现袋子被拆开，主食不见了。',
    evidenceUrl: null,
    status: TAKEOUT_REPORT_STATUS.pending,
    createdAt: hourAgo(),
    updatedAt: hourAgo(),
    ...overrides,
  };
}

interface FakeRepo {
  list: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
  findById: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
  applyStatus: ReturnType<typeof vi.fn>;
}

function makeRepo(base: TakeoutReportModel = report()): FakeRepo {
  return {
    list: vi.fn().mockResolvedValue({ items: [base], nextCursor: null }),
    create: vi.fn().mockImplementation(async (input: Record<string, unknown>) => ({
      ...base,
      ...input,
    })),
    findById: vi.fn().mockResolvedValue(base),
    update: vi.fn().mockImplementation(async (_id: string, input: Record<string, unknown>) => ({
      ...base,
      ...input,
    })),
    remove: vi.fn().mockResolvedValue(undefined),
    applyStatus: vi.fn().mockImplementation(async (_id: string, status: string) => ({
      ...base,
      status,
    })),
  };
}

function makeService(repo: FakeRepo): TakeoutReportService {
  return new TakeoutReportService(repo as unknown as TakeoutReportRepository);
}

const VALID_INPUT = {
  orderNo: '  KD2026101501  ',
  place: '  生活区 5 号楼一层外卖架  ',
  happenedAt: hourAgo(),
  detail: '  取餐时发现袋子被拆开，主食不见了。  ',
};

describe('TakeoutReportService', () => {
  let repo: FakeRepo;
  let service: TakeoutReportService;

  beforeEach(() => {
    repo = makeRepo();
    service = makeService(repo);
  });

  describe('归属只来自 JWT', () => {
    it('create 把 reporterId 写成登录主体，并顺带 trim 文本', async () => {
      await service.create(VALID_INPUT, OWNER);

      expect(repo.create).toHaveBeenCalledTimes(1);
      const written = repo.create.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(written.reporterId).toBe(OWNER);
      expect(written.orderNo).toBe('KD2026101501');
      expect(written.place).toBe('生活区 5 号楼一层外卖架');
      expect(written.detail).toBe('取餐时发现袋子被拆开，主食不见了。');
    });

    it('请求体里硬塞 reporterId / status 都不生效（服务层覆盖）', async () => {
      // 类型上这两个字段根本不存在；用 `as never` 模拟"有人绕过类型直接发请求"
      await service.create(
        { ...VALID_INPUT, reporterId: OTHER, status: 'resolved' } as never,
        OWNER,
      );

      const written = repo.create.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(written.reporterId).toBe(OWNER);
      expect(written.status).toBe(TAKEOUT_REPORT_DEFAULT_STATUS);
      expect(written.anonHandle).toBeUndefined();
    });

    it('未登录不能创建，且不触碰仓储', async () => {
      await expect(service.create(VALID_INPUT)).rejects.toThrow(UnauthenticatedError);
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('详情 / 修改 / 删除 / 升级 / 解决都要求是本人：非本人一律 NOT_FOUND（不透露存在）', async () => {
      repo.findById.mockResolvedValue(report({ reporterId: OWNER }));

      await expect(service.detail('tr-1', OTHER)).rejects.toThrow(NotFoundError);
      await expect(service.update('tr-1', { detail: '改一下' }, OTHER)).rejects.toThrow(NotFoundError);
      await expect(service.remove('tr-1', OTHER)).rejects.toThrow(NotFoundError);
      await expect(service.escalate('tr-1', OTHER)).rejects.toThrow(NotFoundError);
      await expect(service.resolve('tr-1', OTHER)).rejects.toThrow(NotFoundError);

      expect(repo.update).not.toHaveBeenCalled();
      expect(repo.remove).not.toHaveBeenCalled();
      expect(repo.applyStatus).not.toHaveBeenCalled();
    });

    it('未登录读 / 写都是 401（不是 404 —— 未登录时连归属都还没有）', async () => {
      await expect(service.detail('tr-1')).rejects.toThrow(UnauthenticatedError);
      await expect(service.list({}, undefined)).rejects.toThrow(UnauthenticatedError);
      await expect(service.escalate('tr-1')).rejects.toThrow(UnauthenticatedError);
      expect(repo.list).not.toHaveBeenCalled();
    });

    it('不存在的记录对本人也是 NOT_FOUND', async () => {
      repo.findById.mockResolvedValue(null);
      await expect(service.detail('ghost', OWNER)).rejects.toThrow(NotFoundError);
    });
  });

  describe('列表：强制只看自己 + status 白名单', () => {
    it('无论查询传什么，reporterId 恒为登录主体', async () => {
      await service.list({ limit: 20 }, OWNER);
      expect(repo.list).toHaveBeenCalledWith({
        limit: 20,
        filters: { reporterId: OWNER },
      });
    });

    it('status 作为精确筛选透传（与 reporterId 叠加）', async () => {
      await service.list({ limit: 10, cursor: 'cursor-1', status: 'escalated' }, OWNER);
      expect(repo.list).toHaveBeenCalledWith({
        limit: 10,
        cursor: 'cursor-1',
        filters: { reporterId: OWNER, status: 'escalated' },
      });
    });

    it('非白名单状态（旧自由字符串 / 拼错）直接 VALIDATION_FAILED', async () => {
      for (const bad of ['reported', 'closed', '']) {
        await expect(service.list({ status: bad }, OWNER)).rejects.toThrow(ValidationError);
      }
      expect(repo.list).not.toHaveBeenCalled();
    });

    it('白名单就是 pending | escalated | resolved', () => {
      expect([...TAKEOUT_REPORT_STATUSES]).toEqual(['pending', 'escalated', 'resolved']);
    });
  });

  describe('状态机：pending → escalated → resolved', () => {
    it('escalate 从 pending 置为 escalated（走 applyStatus，不走 update）', async () => {
      const result = await service.escalate('tr-1', OWNER);
      expect(repo.applyStatus).toHaveBeenCalledWith('tr-1', TAKEOUT_REPORT_STATUS.escalated);
      expect(result.status).toBe(TAKEOUT_REPORT_STATUS.escalated);
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('escalate 已升级 → CONFLICT（幂等冲突可见，而不是静默改写）', async () => {
      repo.findById.mockResolvedValue(report({ status: TAKEOUT_REPORT_STATUS.escalated }));
      await expect(service.escalate('tr-1', OWNER)).rejects.toThrow(ConflictError);
      expect(repo.applyStatus).not.toHaveBeenCalled();
    });

    it('escalate 已解决 → CONFLICT（终态不可再升级）', async () => {
      repo.findById.mockResolvedValue(report({ status: TAKEOUT_REPORT_STATUS.resolved }));
      await expect(service.escalate('tr-1', OWNER)).rejects.toThrow(ConflictError);
      expect(repo.applyStatus).not.toHaveBeenCalled();
    });

    it('resolve 可从 pending 或 escalated 走到 resolved', async () => {
      await service.resolve('tr-1', OWNER);
      expect(repo.applyStatus).toHaveBeenLastCalledWith('tr-1', TAKEOUT_REPORT_STATUS.resolved);

      repo.findById.mockResolvedValue(report({ status: TAKEOUT_REPORT_STATUS.escalated }));
      await service.resolve('tr-1', OWNER);
      expect(repo.applyStatus).toHaveBeenLastCalledWith('tr-1', TAKEOUT_REPORT_STATUS.resolved);
    });

    it('重复 resolve → CONFLICT', async () => {
      repo.findById.mockResolvedValue(report({ status: TAKEOUT_REPORT_STATUS.resolved }));
      await expect(service.resolve('tr-1', OWNER)).rejects.toThrow(ConflictError);
      expect(repo.applyStatus).not.toHaveBeenCalled();
    });

    it('update 无法改状态：patch 里只有经过类字段', async () => {
      await service.update('tr-1', { detail: '  补充：拍了监控截图  ' }, OWNER);
      const patch = repo.update.mock.calls[0]?.[1] as Record<string, unknown>;
      expect(patch).toEqual({ detail: '补充：拍了监控截图' });
      expect('status' in patch).toBe(false);
      expect('reporterId' in patch).toBe(false);
    });
  });

  describe('字段校验', () => {
    it('订单号 / 取餐点 / 经过都必填且限长', async () => {
      const cases = [
        { ...VALID_INPUT, orderNo: '   ' },
        { ...VALID_INPUT, orderNo: 'x'.repeat(65) },
        { ...VALID_INPUT, place: '' },
        { ...VALID_INPUT, place: 'x'.repeat(61) },
        { ...VALID_INPUT, detail: '   ' },
        { ...VALID_INPUT, detail: 'x'.repeat(1001) },
        { ...VALID_INPUT, happenedAt: 'not-a-date' as unknown as Date },
      ];

      for (const input of cases) {
        await expect(service.create(input, OWNER)).rejects.toThrow(ValidationError);
      }
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('发生时间不能晚于当前时间（留 5 分钟时钟偏差）', async () => {
      const soon = new Date(Date.now() + 4 * 60 * 1000);
      await expect(service.create({ ...VALID_INPUT, happenedAt: soon }, OWNER)).resolves.toBeTruthy();

      const future = new Date(Date.now() + 30 * 60 * 1000);
      await expect(service.create({ ...VALID_INPUT, happenedAt: future }, OWNER)).rejects.toThrow(
        ValidationError,
      );
    });

    it('证据图只接受本平台上传的地址（外链被拒）', async () => {
      await expect(
        service.create({ ...VALID_INPUT, evidenceUrl: 'https://evil.example/track.gif' }, OWNER),
      ).rejects.toThrow(ValidationError);

      await expect(
        service.create(
          { ...VALID_INPUT, evidenceUrl: '/api/v1/media/files/media-20261015-11111111-2222-3333-4444-555555555555.jpg' },
          OWNER,
        ),
      ).resolves.toBeTruthy();
    });
  });
});
