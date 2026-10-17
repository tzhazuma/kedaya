import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CampusBindingRequiredError, UpstreamUnavailableError } from '../../common/errors/app-error';
import { CampusCardTransactionService } from './campus-card.service';
import type { CampusCardTransactionModel, CampusCardTransactionRepository } from './domain/campus-card.domain';
import type { CampusSessionPort } from '../auth/domain/auth.domain';
import type { CampusDataPort } from '../auth/domain/campus-data.domain';

/**
 * 校园卡用例测试。
 *
 * 最关键的一条：**上游挂了不能把余额显示成 0**。
 * 因此专门覆盖「有缓存 → 退回缓存并标 stale」与「无缓存 → 如实报错」两条路径。
 */

const USER = 'user-1';
const NOW = new Date(2026, 9, 17, 15, 0, 0);

function cachedRow(partial: Partial<CampusCardTransactionModel> = {}): CampusCardTransactionModel {
  return {
    id: 'tx-1',
    userId: USER,
    amountFen: 1500,
    direction: 'out',
    merchant: '第一食堂 · 二楼',
    happenedAt: new Date(2026, 9, 17, 12, 0),
    balanceAfterFen: 2350,
    createdAt: new Date(2026, 9, 17, 12, 5),
    ...partial,
  };
}

function build(options: {
  cached?: CampusCardTransactionModel[];
  session?: { platform: 'CARD'; sessionRef: string; expiresAt: Date } | null;
  snapshot?: Awaited<ReturnType<CampusDataPort['fetchCard']>>;
  fetchError?: Error;
  mode?: 'mock' | 'live';
} = {}) {
  const cached = options.cached ?? [];
  const repo = {
    list: vi.fn(),
    create: vi.fn(),
    findById: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    summarize: vi.fn().mockResolvedValue({ totalOutFen: 0, totalInFen: 0, count: 0 }),
    listRecent: vi.fn().mockResolvedValue(cached),
    replaceAll: vi.fn().mockResolvedValue(cached.length),
    lastCachedAt: vi.fn().mockResolvedValue(cached.length > 0 ? cached[0]?.createdAt ?? null : null),
  };

  const campusSession = {
    bind: vi.fn(),
    listBindings: vi.fn(),
    unbind: vi.fn(),
    acquireSession: vi.fn().mockResolvedValue(
      options.session === undefined
        ? { platform: 'CARD', sessionRef: 'demo:CARD:user-1', expiresAt: new Date(2027, 0, 1) }
        : options.session,
    ),
  } as unknown as CampusSessionPort;

  const campusData: CampusDataPort = {
    mode: options.mode ?? 'mock',
    fetchIdentity: vi.fn(),
    fetchSchedule: vi.fn(),
    fetchCard: vi.fn().mockImplementation(async () => {
      if (options.fetchError) throw options.fetchError;
      return (
        options.snapshot ?? {
          balanceFen: 2350,
          dataAsOf: NOW,
          transactions: [
            { amountFen: 1500, direction: 'out' as const, merchant: '第一食堂 · 二楼', happenedAt: new Date(2026, 9, 17, 12, 0), balanceAfterFen: 2350 },
            { amountFen: 20000, direction: 'in' as const, merchant: '充值', happenedAt: new Date(2026, 9, 16, 9, 0), balanceAfterFen: 3850 },
          ],
        }
      );
    }),
  };

  const audit = { record: vi.fn().mockResolvedValue(undefined), recordQuietly: vi.fn(), list: vi.fn() };

  const service = new CampusCardTransactionService(
    repo as unknown as CampusCardTransactionRepository,
    campusSession,
    campusData,
    () => NOW,
    audit as never,
  );

  return { service, repo, campusSession, campusData, audit };
}

describe('CampusCardTransactionService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('未绑定 CARD → CAMPUS_BINDING_REQUIRED（客户端展示"去绑定"）', async () => {
    const ctx = build({ session: null });
    await expect(ctx.service.overview(USER)).rejects.toBeInstanceOf(CampusBindingRequiredError);
  });

  it('正常路径：返回余额 / 流水 / 洞察，并刷新本地缓存', async () => {
    const ctx = build();
    const overview = await ctx.service.overview(USER);

    expect(overview.balanceFen).toBe(2350);
    expect(overview.lowBalance).toBe(false);
    expect(overview.stale).toBe(false);
    expect(overview.simulated).toBe(true);
    expect(overview.transactions.map((item) => item.amountLabel)).toEqual(['−15.00', '+200.00']);
    expect(ctx.repo.replaceAll).toHaveBeenCalledOnce();
  });

  it('低余额：低于阈值时给出提醒与"还能撑几天"', async () => {
    const ctx = build({
      snapshot: {
        balanceFen: 1500,
        dataAsOf: NOW,
        transactions: [
          { amountFen: 700, direction: 'out', merchant: '食堂', happenedAt: new Date(2026, 9, 17, 12, 0), balanceAfterFen: 1500 },
          { amountFen: 700, direction: 'out', merchant: '食堂', happenedAt: new Date(2026, 9, 16, 12, 0), balanceAfterFen: 2200 },
        ],
      },
    });

    const overview = await ctx.service.overview(USER);
    expect(overview.lowBalance).toBe(true);
    expect(overview.insight.estimatedDaysLeft).toBe(8); // 1500 / 200 = 7.5 → 向上取整 8
  });

  it('缓存写入失败不影响本次展示（上游数据已在手上）', async () => {
    const ctx = build();
    ctx.repo.replaceAll.mockRejectedValueOnce(new Error('db down'));

    const overview = await ctx.service.overview(USER);
    expect(overview.balanceFen).toBe(2350);
    expect(overview.stale).toBe(false);
  });

  it('上游失败但有缓存 → 退回缓存并标 stale（**绝不显示 0 元**）', async () => {
    const ctx = build({ cached: [cachedRow()], fetchError: new Error('校园卡系统 502') });

    const overview = await ctx.service.overview(USER);

    expect(overview.stale).toBe(true);
    expect(overview.staleReason).toContain('502');
    expect(overview.balanceFen).toBe(2350); // 来自缓存里最新一笔的余额快照
    expect(overview.syncedAt).not.toBeNull();
    expect(overview.transactions).toHaveLength(1);
  });

  it('上游失败且无缓存 → 如实抛 UPSTREAM_UNAVAILABLE（客户端展示重试）', async () => {
    const ctx = build({ cached: [], fetchError: new UpstreamUnavailableError('校园卡系统暂时不可用') });
    await expect(ctx.service.overview(USER)).rejects.toBeInstanceOf(UpstreamUnavailableError);
  });

  it('挂失：返回官方路径 + 写审计，且**不谎称**已挂失', async () => {
    const ctx = build();
    const report = await ctx.service.lostReport(USER, '食堂丢的');

    expect(report.accepted).toBe(true);
    expect(report.note).toContain('无法替你挂失');
    expect(report.channels.length).toBeGreaterThan(0);
    expect(ctx.audit.record).toHaveBeenCalledOnce();
  });
});
