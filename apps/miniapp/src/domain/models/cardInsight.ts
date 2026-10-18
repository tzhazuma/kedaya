/**
 * 校园卡消费洞察 · **纯函数**（零框架依赖，三端可复用）
 *
 * ## 为什么需要它
 *
 * `CardOverview.insight` 这个字段此前**没有任何生产者** ——
 * 服务端不算、mock 不造、`@kedaya/shared` 里也没有对应的函数。
 * 它只是存在于类型里。于是页面要么拿到 `undefined`，要么自己临时算一遍。
 *
 * 这个文件把它补齐：输入一批流水，输出结构化的洞察。
 *
 * ## 三条设计约束
 *
 * 1. **金额全程整数分**。任何除法都在最后一步做，且结果按需取整 ——
 *    中途转浮点会让 `0.1 + 0.2` 那一类误差出现在余额上。
 * 2. **"今天 / 本周"按本地日历日算，不是滚动 24 小时**。
 *    用户说"今天花了多少"，指的是自然日；用 `now - 24h` 会把昨天晚上的算进来。
 * 3. **样本不足时给 `null`，不猜**。没有消费记录时 `estimatedDaysLeft` 是 `null`，
 *    不是 `Infinity`，也不是一个编出来的数字。
 *
 * 另外：**异常检测用中位数而非平均数**。单笔大额消费会把平均数拉高，
 * 导致真正异常的那笔反而"看起来正常"。
 */

import type { CardAnomaly, CardInsight, CardTransactionView } from './campusCard';

const DAY_MS = 24 * 60 * 60 * 1000;

/** 一笔支出的金额（分，正整数）。收入（CREDIT）不计入消费洞察。 */
function outFen(txn: CardTransactionView): number {
  return txn.direction === 'DEBIT' ? Math.abs(txn.amountFen) : 0;
}

/** 本地日历日的开始时刻 */
function startOfLocalDay(now: Date): number {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

/** 从周一开始的本周开始时刻 */
function startOfLocalWeek(now: Date): number {
  const dayStart = startOfLocalDay(now);
  // getDay(): 0=周日 … 6=周六。换算成"距本周一几天"
  const weekday = (now.getDay() + 6) % 7;
  return dayStart - weekday * DAY_MS;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[mid] as number)
    : Math.round(((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2);
}

/**
 * 异常检测：单笔支出超过 `median * multiplier` 且绝对值超过 `minFen` 才算异常。
 *
 * 两个门限都要过。只用一个的话：小额流水里 3 倍的"2 元 vs 6 元"会被误报为异常。
 */
export const ANOMALY_MULTIPLIER = 3;
export const ANOMALY_MIN_FEN = 5000;

export function computeCardInsight(
  transactions: readonly CardTransactionView[],
  now: Date = new Date(),
): CardInsight {
  const dayStart = startOfLocalDay(now);
  const weekStart = startOfLocalWeek(now);

  const debits = transactions.filter((txn) => txn.direction === 'DEBIT');
  const amounts = debits.map(outFen).filter((fen) => fen > 0);

  let todayOutFen = 0;
  let todayOutCount = 0;
  let weekOutFen = 0;
  let weekOutCount = 0;

  const byMerchant = new Map<string, { totalFen: number; count: number }>();

  for (const txn of debits) {
    const fen = outFen(txn);
    if (fen === 0) continue;
    const at = Date.parse(txn.happenedAt);
    if (Number.isNaN(at)) continue;

    if (at >= dayStart) {
      todayOutFen += fen;
      todayOutCount += 1;
    }
    if (at >= weekStart) {
      weekOutFen += fen;
      weekOutCount += 1;
    }

    const bucket = byMerchant.get(txn.merchant) ?? { totalFen: 0, count: 0 };
    bucket.totalFen += fen;
    bucket.count += 1;
    byMerchant.set(txn.merchant, bucket);
  }

  // 日均：按**有记录的天数**算，不是按固定 7 天 —— 否则新用户会被严重低估
  const daysWithData = new Set(
    debits
      .map((txn) => {
        const at = Date.parse(txn.happenedAt);
        return Number.isNaN(at) ? null : new Date(at).toDateString();
      })
      .filter((key): key is string => key !== null),
  ).size;
  const avgDailyOutFen = daysWithData === 0 ? 0 : Math.round(weekOutFen / Math.max(1, Math.min(7, daysWithData)));

  const balance = transactions.length > 0 ? (transactions[0] as CardTransactionView).balanceAfterFen : null;
  const estimatedDaysLeft =
    balance === null || avgDailyOutFen === 0 ? null : Math.max(0, Math.floor(balance / avgDailyOutFen));

  const medianOutFen = median(amounts);

  const anomalies: CardAnomaly[] = [];
  if (medianOutFen > 0) {
    for (const txn of debits) {
      const fen = outFen(txn);
      if (fen <= ANOMALY_MIN_FEN) continue;
      if (fen < medianOutFen * ANOMALY_MULTIPLIER) continue;
      anomalies.push({
        merchant: txn.merchant,
        amountFen: fen,
        happenedAt: txn.happenedAt,
        // 用**倍数**解释"为什么算异常"，而不是一句话 —— 倍数可被用户核对
        ratioToMedian: Math.round((fen / medianOutFen) * 10) / 10,
      });
    }
  }

  const topMerchants = [...byMerchant.entries()]
    .map(([merchant, bucket]) => ({ merchant, totalFen: bucket.totalFen, count: bucket.count }))
    .sort((a, b) => b.totalFen - a.totalFen || a.merchant.localeCompare(b.merchant))
    .slice(0, 5);

  return {
    todayOutFen,
    todayOutCount,
    weekOutFen,
    weekOutCount,
    avgDailyOutFen,
    estimatedDaysLeft,
    medianOutFen,
    anomalies,
    topMerchants,
  };
}
