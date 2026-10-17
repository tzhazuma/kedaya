import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConflictError, NotFoundError, ValidationError } from '../../common/errors/app-error';
import {
  REPORT_ESCALATION_THRESHOLD,
  REPORT_REASONS,
  REPORT_TARGET_TYPES,
  truncateReportDetail,
  type ReportTarget,
} from './domain/reports.domain';
import { ReportService } from './reports.service';
import type { ReportRecord, ReportRepository } from './data/reports.repository';

/**
 * 举报用例测试。
 *
 * 这一层最该守住的不是"能写进去"，而是四条**出错时不会报错、只会静默坏掉**的规则：
 *   1. 举报必须指向真实存在的内容（否则队列会被垃圾淹没 → 值班的人直接不看队列）；
 *   2. 同一个人不能对同一对象刷举报（否则"3 个人"的阈值形同虚设）；
 *   3. 不能举报自己（没有治理意义，只会污染统计）；
 *   4. 阈值升级只**打标 + 告警**，绝不下架内容（自动下架是可以被武器化的）。
 */

const TARGET: ReportTarget = { authorId: 'seller-1', title: '出一台 iPad' };

interface FakeRepo {
  resolveTarget: ReturnType<typeof vi.fn>;
  findExisting: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
  countDistinctReporters: ReturnType<typeof vi.fn>;
  markEscalated: ReturnType<typeof vi.fn>;
  listByReporter: ReturnType<typeof vi.fn>;
}

function makeRepo(overrides: Partial<FakeRepo> = {}): FakeRepo {
  return {
    resolveTarget: vi.fn().mockResolvedValue(TARGET),
    findExisting: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockImplementation((record: Record<string, unknown>) =>
      Promise.resolve({
        id: 'report-1',
        targetType: record.targetType as string,
        targetId: record.targetId as string,
        targetTitle: record.targetTitle as string,
        reason: record.reason as string,
        detail: (record.detail ?? null) as string | null,
        escalated: false,
        createdAt: new Date('2026-10-17T00:00:00.000Z'),
      } satisfies ReportRecord),
    ),
    countDistinctReporters: vi.fn().mockResolvedValue(1),
    markEscalated: vi.fn().mockResolvedValue(1),
    listByReporter: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

function makeService(repo: FakeRepo): ReportService {
  return new ReportService(repo as unknown as ReportRepository);
}

const VALID = { targetType: 'flea-item', targetId: 'item-1', reason: 'fraud' };

describe('白名单（白名单本身就是安全边界）', () => {
  it('覆盖十个可举报对象类型与七种原因', () => {
    expect([...REPORT_TARGET_TYPES]).toEqual([
      'flea-item',
      'errand-task',
      'buddy-group',
      'lost-found-item',
      'forum-post',
      'forum-reply',
      'canteen-dish',
      'faq-entry',
      'wildlife-spot',
      'techpie-link',
    ]);
    expect([...REPORT_REASONS]).toEqual([
      'illegal',
      'porn',
      'harassment',
      'fraud',
      'privacy',
      'spam',
      'other',
    ]);
  })

  it('非法的 targetType 立刻拒绝，且**不查库**（不让无效请求消耗数据库）', async () => {
    const repo = makeRepo();
    await expect(
      makeService(repo).create('user-A', { ...VALID, targetType: 'not-a-type' }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(repo.resolveTarget).not.toHaveBeenCalled();
  })

  it('非法的 reason 被拒绝', async () => {
    await expect(
      makeService(makeRepo()).create('user-A', { ...VALID, reason: '我不喜欢他' }),
    ).rejects.toBeInstanceOf(ValidationError);
  })

  it('空 targetId 被拒绝', async () => {
    await expect(
      makeService(makeRepo()).create('user-A', { ...VALID, targetId: '   ' }),
    ).rejects.toBeInstanceOf(ValidationError);
  })
});

describe('create', () => {
  let repo: FakeRepo;

  beforeEach(() => {
    repo = makeRepo();
  });

  it('正常举报：落库并返回可读形状', async () => {
    const result = await makeService(repo).create('user-A', VALID);

    expect(result).toMatchObject({
      id: 'report-1',
      targetType: 'flea-item',
      targetId: 'item-1',
      targetTitle: '出一台 iPad',
      reason: 'fraud',
    });
    const [record] = repo.create.mock.calls[0] as [Record<string, unknown>];
    expect(record).toMatchObject({ reporterId: 'user-A', targetAuthorId: 'seller-1' });
  })

  it('内容不存在 → 404（而不是默默收下，让用户以为举报成功了）', async () => {
    repo.resolveTarget.mockResolvedValue(null);
    await expect(makeService(repo).create('user-A', VALID)).rejects.toBeInstanceOf(NotFoundError);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('不能举报自己的内容（自己的内容自己举报没有治理意义）', async () => {
    repo.resolveTarget.mockResolvedValue({ authorId: 'user-A', title: 'x' });
    await expect(makeService(repo).create('user-A', VALID)).rejects.toBeInstanceOf(ValidationError);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('匿名内容（authorId 为 null）仍然可以被举报', async () => {
    repo.resolveTarget.mockResolvedValue({ authorId: null, title: '匿名帖' });
    const result = await makeService(repo).create('user-A', {
      ...VALID,
      targetType: 'forum-post',
    });
    expect(result.targetTitle).toBe('匿名帖');
    expect(repo.create).toHaveBeenCalledTimes(1);
  });

  it('重复举报 → 409（否则「3 个不同的人」的阈值形同虚设）', async () => {
    repo.findExisting.mockResolvedValue({ id: 'old', escalated: false } as ReportRecord);
    await expect(makeService(repo).create('user-A', VALID)).rejects.toBeInstanceOf(ConflictError);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('补充说明按码点截断（不切坏 emoji，也不让超长文本落库）', async () => {
    await makeService(repo).create('user-A', { ...VALID, detail: '🦆'.repeat(400) });
    const [record] = repo.create.mock.calls[0] as [{ detail: string }];
    expect([...record.detail].length).toBeLessThanOrEqual(301);
    expect(record.detail.endsWith('…')).toBe(true);
  })

  it('未填补充说明时为 null（不写空串）', async () => {
    await makeService(repo).create('user-A', VALID);
    const [record] = repo.create.mock.calls[0] as [{ detail: string | null }];
    expect(record.detail).toBeNull();
  })
});

describe('阈值升级（只打标 + 告警，绝不下架）', () => {
  let repo: FakeRepo;

  beforeEach(() => {
    repo = makeRepo();
  });

  it('人数不够时不升级、不打标', async () => {
    repo.countDistinctReporters.mockResolvedValue(REPORT_ESCALATION_THRESHOLD - 1);
    const result = await makeService(repo).create('user-A', VALID);
    expect(result.escalated).toBe(false);
    expect(repo.markEscalated).not.toHaveBeenCalled();
  })

  it('达到阈值 → 一次性给该对象的全部举报记录打标，并把本次结果标为已升级', async () => {
    repo.countDistinctReporters.mockResolvedValue(REPORT_ESCALATION_THRESHOLD);
    const result = await makeService(repo).create('user-A', VALID);
    expect(result.escalated).toBe(true);
    expect(repo.markEscalated).toHaveBeenCalledWith('flea-item', 'item-1');
  })

  it('已经升级过的对象再被举报不再重复打标（否则每条举报都刷一遍告警）', async () => {
    repo.countDistinctReporters.mockResolvedValue(REPORT_ESCALATION_THRESHOLD + 5);
    repo.markEscalated.mockResolvedValue(0);
    const result = await makeService(repo).create('user-A', VALID);
    expect(result.escalated).toBe(false);
  })

  it('**绝不下架内容**：服务层没有任何写业务表的调用', async () => {
    repo.countDistinctReporters.mockResolvedValue(99);
    const service = makeService(repo);
    await service.create('user-A', VALID);

    // 仓储接口里唯一的写操作是 `markEscalated`；没有 updateFleaItem / deletePost 之类
    const writeCalls = Object.keys(repo).filter((key) =>
      /update|delete|hide|remove|ban|block/i.test(key),
    );
    expect(writeCalls).toEqual([]);
  })
});

describe('listMine', () => {
  it('按举报人查询并透传 limit', async () => {
    const repo = makeRepo();
    await makeService(repo).listMine('user-A', 20);
    expect(repo.listByReporter).toHaveBeenCalledWith('user-A', 20);
  })

  it('库里的未知 reason（历史数据）回落成 other，不让客户端拿到空标签', async () => {
    const repo = makeRepo({
      listByReporter: vi.fn().mockResolvedValue([
        {
          id: 'r1',
          targetType: 'flea-item',
          targetId: 'i1',
          targetTitle: 'x',
          reason: 'legacy-reason-not-in-whitelist',
          detail: null,
          escalated: false,
          createdAt: new Date('2026-10-01T00:00:00.000Z'),
        } satisfies ReportRecord,
      ]),
    });

    const [report] = await makeService(repo).listMine('user-A', 20);
    expect(report?.reason).toBe('other');
  })
});

describe('truncateReportDetail', () => {
  it('短文本原样返回', () => {
    expect(truncateReportDetail('他就是个骗子')).toBe('他就是个骗子');
  })
})
