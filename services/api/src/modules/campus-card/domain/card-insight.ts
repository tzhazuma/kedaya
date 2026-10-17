/**
 * 校园卡 · 纯领域规则（无 IO、无框架依赖，可直接单测）。
 *
 * 校园卡这个模块最容易做成"把流水打印出来"，但用户真正的三个痛点不是"看流水"：
 *   1. 卡里还剩多少、**还能撑几天**（避免刷到一半尴尬地卡在食堂窗口）；
 *   2. **这笔钱是不是我刷的**（异常扣款 / 被人捡到卡刷了）；
 *   3. 丢了怎么办（挂失路径），以及**先别把余额显示成 0**。
 *
 * 因此本文件只做与数值有关的判断：低余额、日均消费、异常扣款、消费榜。
 * 全部是纯函数 —— 它们决定"什么时候该提醒用户"，必须能稳定回归。
 */

import type { CampusCardTransactionModel } from './campus-card.domain';

/**
 * 低余额阈值（分）。
 *
 * 为什么是「常量 + 可覆盖」而不是用户设置项：阈值属于「提醒策略」，
 * 而 `ProfileSetting` 表当前没有该字段，为了不在这个阶段动数据库 schema，
 * 先给一个符合食堂客单价的默认值（20 元 ≈ 两顿正餐），
 * 客户端可在请求里覆盖 `thresholdFen` 做本地偏好。
 */
export const LOW_BALANCE_THRESHOLD_FEN = 2000;

/** 判定为"异常扣款"的最小金额（分）：低于 30 元的波动不值得打扰用户 */
const ANOMALY_MIN_FEN = 3000;
/** 异常判定倍数：超过中位消费的 3 倍 */
const ANOMALY_RATIO = 3;

export interface CardSpendingInsight {
  /** 今日支出（分）/ 笔数 */
  todayOutFen: number;
  todayOutCount: number;
  /** 近 7 日支出（分）/ 笔数 */
  weekOutFen: number;
  weekOutCount: number;
  /** 近 7 日日均支出（分），无消费为 0 */
  avgDailyOutFen: number;
  /**
   * 按日均消费推算，余额还能撑多少天（向上取整）。
   * 无消费记录时为 null —— 不要瞎猜一个数字。
   */
  estimatedDaysLeft: number | null;
  /** 中位消费（分），异常判定基准 */
  medianOutFen: number;
  /** 疑似异常扣款：明显高于中位消费的大额支出 */
  anomalies: CampusCardAnomaly[];
  /** 近 7 日消费去向 Top 3（"钱都花哪了"） */
  topMerchants: { merchant: string; totalFen: number; count: number }[];
}

export interface CampusCardAnomaly {
  merchant: string;
  amountFen: number;
  happenedAt: string;
  /** 相对中位消费的倍数，UI 用来说明"为什么判定异常" */
  ratioToMedian: number;
}

/** 低余额判定（严格小于阈值 —— 余额恰好等于阈值时不必打扰用户） */
export function isLowBalance(
  balanceFen: number,
  thresholdFen: number = LOW_BALANCE_THRESHOLD_FEN,
): boolean {
  return balanceFen < thresholdFen;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] as number)
    : Math.round(((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2);
}

function startOfLocalDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/**
 * 生成消费洞察。
 *
 * @param transactions 已按时间倒序的流水（最新在前）
 * @param now          服务端"现在"（由 CLOCK 注入，保证可测）
 */
export function buildInsight(
  transactions: readonly CampusCardTransactionModel[],
  now: Date,
): CardSpendingInsight {
  const outs = transactions.filter((tx) => tx.direction === 'out');
  const dayStart = startOfLocalDay(now);
  const weekStart = dayStart - 6 * 24 * 3600 * 1000;

  const todayOuts = outs.filter((tx) => tx.happenedAt.getTime() >= dayStart);
  const weekOuts = outs.filter((tx) => tx.happenedAt.getTime() >= weekStart);

  const todayOutFen = todayOuts.reduce((sum, tx) => sum + tx.amountFen, 0);
  const weekOutFen = weekOuts.reduce((sum, tx) => sum + tx.amountFen, 0);
  const avgDailyOutFen = Math.round(weekOutFen / 7);

  const outAmounts = outs.map((tx) => tx.amountFen);
  const medianOutFen = median(outAmounts);

  // 异常：金额同时满足「绝对值够大」与「相对中位数够突出」，避免把正常聚餐标红
  const anomalies: CampusCardAnomaly[] =
    medianOutFen === 0
      ? []
      : outs
          .filter((tx) => tx.amountFen >= ANOMALY_MIN_FEN && tx.amountFen > medianOutFen * ANOMALY_RATIO)
          .map((tx) => ({
            merchant: tx.merchant,
            amountFen: tx.amountFen,
            happenedAt: tx.happenedAt.toISOString(),
            ratioToMedian: Math.round((tx.amountFen / medianOutFen) * 10) / 10,
          }));

  const byMerchant = new Map<string, { totalFen: number; count: number }>();
  for (const tx of weekOuts) {
    const current = byMerchant.get(tx.merchant) ?? { totalFen: 0, count: 0 };
    byMerchant.set(tx.merchant, {
      totalFen: current.totalFen + tx.amountFen,
      count: current.count + 1,
    });
  }

  const topMerchants = [...byMerchant.entries()]
    .map(([merchant, value]) => ({ merchant, ...value }))
    .sort((left, right) => right.totalFen - left.totalFen)
    .slice(0, 3);

  return {
    todayOutFen,
    todayOutCount: todayOuts.length,
    weekOutFen,
    weekOutCount: weekOuts.length,
    avgDailyOutFen,
    estimatedDaysLeft: null, // 由 withBalance 补上（需要余额，本函数不持有）
    medianOutFen,
    anomalies,
    topMerchants,
  };
}

/** 把「余额」这一项补进洞察：还能撑几天（余额 ÷ 日均消费，向上取整） */
export function withBalanceForecast(
  insight: CardSpendingInsight,
  balanceFen: number,
): CardSpendingInsight {
  return {
    ...insight,
    estimatedDaysLeft:
      insight.avgDailyOutFen <= 0 ? null : Math.ceil(balanceFen / insight.avgDailyOutFen),
  };
}
