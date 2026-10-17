/**
 * 服务端「一天」的口径（ADR 0006 D8）。
 *
 * 为什么不能直接用 `shared/time.ts` 的 `dayRange()`：
 * 它按**进程本地时区**切天。开发机在东八区，容器默认 UTC，
 * 于是「北京时间 08:00 之前的早餐」在部署环境会被算进昨天，
 * 而小程序的「今天」仍按本机时区算 —— 两端对不上。
 *
 * 这里把时区偏移显式化：`APP_TZ_OFFSET_MINUTES`（分钟，东八区 = 480），
 * 默认 480（上科大所在地）。小程序按本机时区调用 `dayRange()`，
 * 只要用户在同一个时区，两端口径一致。
 */
import { dateKeyAtOffset, dayRangeWithOffset, parseDateKeyAtOffset } from '@kedaya/shared';

/** 默认时区偏移：东八区 */
export const DEFAULT_TZ_OFFSET_MINUTES = 480;

/** 偏移上限（±14 小时，覆盖所有真实时区） */
const MAX_OFFSET_MINUTES = 14 * 60;

/** 读取并校验 `APP_TZ_OFFSET_MINUTES`，非法值回落到默认值（不静默变成 0） */
export function appTzOffsetMinutes(): number {
  const raw = process.env.APP_TZ_OFFSET_MINUTES;
  if (raw === undefined || raw.trim() === '') return DEFAULT_TZ_OFFSET_MINUTES;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || Math.abs(parsed) > MAX_OFFSET_MINUTES) {
    return DEFAULT_TZ_OFFSET_MINUTES;
  }
  return Math.round(parsed);
}

/** 某一时刻所属的自然日（含起止边界与 YYYY-MM-DD key） */
export function appDayRange(date: Date): { key: string; from: Date; to: Date } {
  return dayRangeWithOffset(date, appTzOffsetMinutes());
}

/** 某一时刻在本项目口径下的 YYYY-MM-DD */
export function appDateKey(date: Date): string {
  return dateKeyAtOffset(date, appTzOffsetMinutes());
}

/**
 * 把 `YYYY-MM-DD` 解析成该项目口径下当天的零点。
 * 非法输入返回 null（调用方负责报 400）—— 不再让 `new Date(2026, 1, 31)`
 * 静默进位到 3 月 3 日。
 */
export function parseAppDateKey(dateKey: string): Date | null {
  return parseDateKeyAtOffset(dateKey, appTzOffsetMinutes());
}
