/**
 * 校园活动 —— Web 侧的领域适配。
 *
 * 类型与冻结枚举**全部来自** `@kedaya/contracts`（`activities.ts`）：
 * 来源只有 campus-mail / wechat-mp / manual，状态从 candidate 开始，
 * 时间字段是 UTC ISO，无法确定就是 `null`。这里只补 Web 需要的纯展示/输入换算，
 * 不复制、不改写契约字段。
 *
 * 时间约定：传输与存储一律 UTC ISO-8601；`datetime-local` 输入与页面展示
 * 显式按 `Asia/Shanghai` 换算，**不依赖浏览器本地时区**。
 */

import { ACTIVITY_TIMEZONE } from '@kedaya/contracts';

export {
  ACTIVITY_BASE_PATH,
  ACTIVITY_DEFAULT_REMINDER_LEADS,
  ACTIVITY_EVIDENCE_MAX_CHARS,
  ACTIVITY_KINDS,
  ACTIVITY_KIND_LABELS,
  ACTIVITY_REMINDER_CHANNELS,
  ACTIVITY_REMINDER_KINDS,
  ACTIVITY_REMINDER_STATUSES,
  ACTIVITY_ROUTES,
  ACTIVITY_SOURCES,
  ACTIVITY_SOURCE_LABELS,
  ACTIVITY_STATUSES,
  ACTIVITY_STATUS_LABELS,
  ACTIVITY_TIMEZONE,
  type ActivityItem,
  type ActivityKind,
  type ActivityReminderChannel,
  type ActivityReminderItem,
  type ActivityReminderKind,
  type ActivityReminderStatus,
  type ActivitySource,
  type ActivityStatus,
} from '@kedaya/contracts';

const SHANGHAI_OFFSET_MINUTES = 8 * 60;
const DATE_TIME_LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/**
 * UTC ISO → `datetime-local` 值（北京时间墙上时间）。
 * 非法/缺失返回空串，让调用方显示空输入框，而不是填一个假时间。
 */
export function toShanghaiDateTimeLocal(iso: string | null): string {
  if (iso === null || iso.trim() === '') return '';
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  const shifted = new Date(ms + SHANGHAI_OFFSET_MINUTES * 60 * 1000);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return (
    `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`
    + `T${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`
  );
}

/**
 * `datetime-local` 值（按北京时间理解）→ UTC ISO。
 *
 * 上海 1991 年后无夏令时，显式 `+08:00` 换算是确定的；回读校验会拒绝
 * `2026-13-40T99:99` 这类会被 `Date` 静默进位的值。
 */
export function fromShanghaiDateTimeLocal(value: string): string | null {
  const match = DATE_TIME_LOCAL_RE.exec(value.trim());
  if (match === null) return null;
  const parsed = Date.parse(`${value.trim()}:00+08:00`);
  if (!Number.isFinite(parsed)) return null;
  const iso = new Date(parsed).toISOString();
  return toShanghaiDateTimeLocal(iso) === value.trim() ? iso : null;
}

/** 展示用：明确标注北京时间的完整时刻 */
export function formatShanghaiInstant(iso: string | null): string {
  if (iso === null) return '';
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: ACTIVITY_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(ms));
}

export type WechatUrlValidation =
  | { readonly ok: true; readonly url: string }
  | { readonly ok: false; readonly message: string };

/**
 * 单篇公众号链接的客户端预校验。
 *
 * 与服务端 `WechatArticleService.normalizeUrl` 对齐：只认 `https` +
 * `mp.weixin.qq.com` + 文章路径（`/s/…` 或历史写法 `/mp/appmsg/show…`）。
 * 真正的白名单仍在服务端 —— 这里只是让用户在发请求前就看到可执行的提示。
 */
export function validateWechatArticleUrl(raw: string): WechatUrlValidation {
  const trimmed = raw.trim();
  if (trimmed === '') {
    return { ok: false, message: '请先粘贴一篇公众号文章链接。' };
  }
  if (trimmed.length > 2048) {
    return { ok: false, message: '链接过长（超过 2048 个字符），请确认粘贴的是单篇文章链接。' };
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return {
      ok: false,
      message: '这不是一个完整链接。请粘贴以 https://mp.weixin.qq.com/s/ 开头的地址。',
    };
  }

  if (url.protocol !== 'https:') {
    return { ok: false, message: '只接受 https 链接；http 链接会被拒绝。' };
  }
  if (url.username !== '' || url.password !== '') {
    return { ok: false, message: '链接里不能带用户名或密码。' };
  }
  if (url.hostname.toLowerCase() !== 'mp.weixin.qq.com') {
    return { ok: false, message: '只支持公众号文章：域名必须是 mp.weixin.qq.com。' };
  }
  if (url.port !== '') {
    return { ok: false, message: '公众号链接不支持自定义端口。' };
  }
  if (!/^\/(?:s\/|mp\/appmsg\/show)/.test(url.pathname)) {
    return {
      ok: false,
      message: '这不像单篇文章链接。请打开具体文章后复制地址（路径以 /s/ 开头）。',
    };
  }

  url.hash = '';
  return { ok: true, url: url.toString() };
}
