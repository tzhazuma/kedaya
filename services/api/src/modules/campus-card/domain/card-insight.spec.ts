import { describe, expect, it } from 'vitest';
import { LOW_BALANCE_THRESHOLD_FEN, buildInsight, isLowBalance, withBalanceForecast } from './card-insight';
import type { CampusCardTransactionModel } from './campus-card.domain';

/**
 * 校园卡洞察测试：**低余额 / 还能撑几天 / 异常扣款**。
 * 这三条决定了"什么时候值得打扰用户"，必须可回归。
 */

const NOW = new Date(2026, 9, 17, 15, 0, 0); // 2026-10-17 15:00

function tx(
  partial: Partial<CampusCardTransactionModel> & { amountFen: number; happenedAt: Date },
): CampusCardTransactionModel {
  return {
    id: `tx-${partial.amountFen}-${partial.happenedAt.getTime()}`,
    userId: 'u1',
    amountFen: partial.amountFen,
    direction: partial.direction ?? 'out',
    merchant: partial.merchant ?? '第一食堂 · 二楼',
    happenedAt: partial.happenedAt,
    balanceAfterFen: partial.balanceAfterFen ?? 1000,
    createdAt: partial.happenedAt,
  };
}

describe('校园卡 · 低余额判定', () => {
  it('严格小于阈值才算低（等于阈值不打扰）', () => {
    expect(LOW_BALANCE_THRESHOLD_FEN).toBe(2000);
    expect(isLowBalance(1999)).toBe(true);
    expect(isLowBalance(2000)).toBe(false);
    expect(isLowBalance(2000, 3000)).toBe(true);
  });
});

describe('校园卡 · 消费洞察', () => {
  it('区分今日与近 7 日消费，并给出中位数', () => {
    const rows = [
      tx({ amountFen: 1200, happenedAt: new Date(2026, 9, 17, 12, 10) }),
      tx({ amountFen: 800, happenedAt: new Date(2026, 9, 17, 8, 30) }),
      tx({ amountFen: 1500, happenedAt: new Date(2026, 9, 15, 12, 0) }),
      tx({ amountFen: 7000, happenedAt: new Date(2026, 9, 14, 19, 0), merchant: '校园超市' }),
      // 8 天前：不计入近 7 日
      tx({ amountFen: 9999, happenedAt: new Date(2026, 9, 9, 12, 0) }),
      // 充值不计入支出
      tx({ amountFen: 20000, direction: 'in', happenedAt: new Date(2026, 9, 16, 12, 0), merchant: '充值' }),
    ];

    const insight = buildInsight(rows, NOW);

    expect(insight.todayOutFen).toBe(2000);
    expect(insight.todayOutCount).toBe(2);
    expect(insight.weekOutFen).toBe(1200 + 800 + 1500 + 7000);
    expect(insight.medianOutFen).toBe(1500); // 支出：800,1200,1500,7000,9999 → 中位是 1500
    expect(insight.topMerchants[0]?.merchant).toBe('校园超市');
    expect(insight.topMerchants[0]?.totalFen).toBe(7000);
  });

  it('异常扣款：金额同时"够大"且"远超中位数"才标记（正常聚餐不误报）', () => {
    const daily = [1000, 1100, 1200, 1300, 1050].map((amount, index) =>
      tx({ amountFen: amount, happenedAt: new Date(2026, 9, 12 + index, 12, 0) }),
    );
    const normalMeal = tx({ amountFen: 3500, happenedAt: new Date(2026, 9, 17, 18, 0), merchant: '第三食堂' });
    const suspicious = tx({ amountFen: 48000, happenedAt: new Date(2026, 9, 17, 2, 13), merchant: '未知终端' });

    const insight = buildInsight([...daily, normalMeal, suspicious], NOW);

    expect(insight.anomalies.map((item) => item.merchant)).toEqual(['未知终端']);
    expect(insight.anomalies[0]?.ratioToMedian).toBeGreaterThan(3);
  });

  it('没有支出记录时不产生异常（median 为 0 会让一切"异常"）', () => {
    const insight = buildInsight([tx({ amountFen: 20000, direction: 'in', happenedAt: NOW })], NOW);
    expect(insight.anomalies).toEqual([]);
    expect(insight.medianOutFen).toBe(0);
  });

  it('"还能撑几天"：按近 7 日日均消费推算；无消费时为 null（不瞎猜）', () => {
    const rows = [
      tx({ amountFen: 700, happenedAt: new Date(2026, 9, 17, 12, 0) }),
      tx({ amountFen: 700, happenedAt: new Date(2026, 9, 16, 12, 0) }),
    ];
    const insight = withBalanceForecast(buildInsight(rows, NOW), 1400);
    // 近 7 日共 1400 分 → 日均 200 分 → 余额 1400 / 200 = 7 天
    expect(insight.avgDailyOutFen).toBe(200);
    expect(insight.estimatedDaysLeft).toBe(7);

    const noSpend = withBalanceForecast(buildInsight([], NOW), 5000);
    expect(noSpend.estimatedDaysLeft).toBeNull();
  });
});
