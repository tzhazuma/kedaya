/**
 * 找搭子 · 可用时段重叠判定（规格 §3.3 的 F7 硬过滤）
 *
 * ⚠️ 这是最容易写错的一处：**跨零点的活动**。
 * 例如"22:30 开始、踢 90 分钟"→ end = 22*60+30 + 90 = 1440，等于次日 00:00；
 * 若是 23:30 + 90min → end = 1500 > 1440，落在**次日**。
 * 只比较当天时段会漏掉这类活动，导致"明明有空却被过滤掉"。
 */

/** 一段每周重复的可用时间（dow: 0=周日 … 6=周六；分钟从 00:00 起算） */
export interface AvailabilitySlot {
  dow: number;
  startMin: number;
  endMin: number;
}

/** 把"分钟数"拆成 (星期偏移, 当日内分钟) */
function normalizeMinute(totalMin: number): { dayOffset: number; minute: number } {
  const dayOffset = Math.floor(totalMin / 1440);
  return { dayOffset, minute: ((totalMin % 1440) + 1440) % 1440 };
}

/**
 * 活动时间窗是否与我的可用时段有交集（规格 §3.3 F7）。
 *
 * @param availability 我的可用时段
 * @param startMinOfWeek 活动开始时刻，表示为「**周日 00:00 起的分钟数**」（由调用方按时区算好）
 * @param durationMin 活动时长（分钟）
 *
 * 约定：`dow` 0=周日…6=周六；`startMinOfWeek` 从周日 00:00 起算。
 * 采用「周内分钟数」作为输入，避免在纯函数里引入时区库依赖 ——
 * 时区换算由调用方（服务端用 date-fns-tz，客户端用各自的本地时间）完成。
 */
export function overlapsAvailabilityMinutes(
  availability: readonly AvailabilitySlot[],
  startMinOfWeek: number,
  durationMin: number,
): boolean {
  if (durationMin <= 0) return false;
  if (availability.length === 0) return false;

  const endMinOfWeek = startMinOfWeek + durationMin;

  // 活动窗口最多跨越一周；按分钟逐段检查代价高，改为检查每个 slot 与活动窗口是否相交。
  for (const slot of availability) {
    // 把 slot 展开成「周内分钟区间」；slot 可能跨零点，故用长度判断
    const slotLen =
      slot.endMin > slot.startMin ? slot.endMin - slot.startMin : 1440 - slot.startMin + slot.endMin;
    if (slotLen <= 0) continue;

    const slotStartOfWeek = slot.dow * 1440 + slot.startMin;

    // 检查活动窗口 [start, end) 与 slot 区间是否相交，考虑「周环绕」：
    // 把 slot 平移到活动窗口附近的若干周（-1、0、+1 周）
    for (const weekOffset of [-1, 0, 1]) {
      const s = slotStartOfWeek + weekOffset * 7 * 1440;
      const e = s + slotLen;
      if (s < endMinOfWeek && startMinOfWeek < e) return true;
    }
  }
  return false;
}

/**
 * 便捷包装：给定 Date 与时长，先按时区算出「周内分钟数」，再判定。
 *
 * 不引入 date-fns-tz —— 用 `Intl.DateTimeFormat` 取目标时区的本地星期与时刻，
 * 这样 `@kedaya/shared` 仍然是**零依赖**的纯 TS 包（三端都能用）。
 */
export function overlapsAvailability(
  availability: readonly AvailabilitySlot[],
  startsAt: Date,
  durationMin: number,
  tz = 'Asia/Shanghai',
): boolean {
  const { dow, minuteOfDay } = zonedDowAndMinute(startsAt, tz);
  // ⚠️ 约定统一：dow 一律 **0=周日 … 6=周六**（与 JS `getDay()` 一致），
  // 「周内分钟数」从**周日 00:00** 起算。早先版本在这里多做了一次 Mon0 转换，
  // 与 AvailabilitySlot.dow 的约定冲突，导致跨零点用例全线失败 —— 已统一。
  return overlapsAvailabilityMinutes(availability, dow * 1440 + minuteOfDay, durationMin);
}

/** 取某时刻在指定时区的「星期（0=周日）」与「当日内分钟」 */
export function zonedDowAndMinute(
  at: Date,
  tz = 'Asia/Shanghai',
): { dow: number; minuteOfDay: number } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(at);
  const wd = parts.find((p) => p.type === 'weekday')?.value ?? 'Sun';
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { dow: map[wd] ?? 0, minuteOfDay: (hour % 24) * 60 + minute };
}
