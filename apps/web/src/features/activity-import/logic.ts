/**
 * 校园活动导入 · 纯逻辑层（Web）。
 *
 * 抽取与 ICS 都复用 `@kedaya/shared` 的三端共享实现：
 * - `extractActivityCandidates`：公众号单篇 → 候选（不猜时间、不存全文）；
 * - `truncateActivityEvidence`：证据片段 ≤200 字；
 * - `buildActivityIcs`：只有 `confirmed` 能导出，且不编时长/开始时间。
 *
 * 本文件只做 Web 需要的**适配**：补上 `source` / `status` / `sourceLabel` /
 * `publishedAt` / 稳定 id，并提供「编辑后必须重新确认」与字段校验。
 *
 * Web 没有真实登录：确认只在当前页面内有效，不写存储、不创建日程。
 */

import {
  ACTIVITY_EVIDENCE_MAX_CHARS,
  buildActivityIcs as buildSharedActivityIcs,
  extractActivityCandidates,
  sanitizeSourceUrl,
  truncateActivityEvidence,
  type ActivityArticleLike,
  type IcsActivityBuildOptions,
} from '@kedaya/shared';

import {
  ACTIVITY_TIMEZONE,
  type ActivityItem,
  type ActivityKind,
} from '@/domain/models/activities';

/** 文章输入：共享解析器的结构 + 可选的来源展示名 */
export interface ActivityArticle extends ActivityArticleLike {
  /** 直接粘贴正文时用「用户粘贴的公众号正文」覆盖账号名 */
  readonly sourceLabel?: string;
}

export interface ExtractActivitiesOptions {
  readonly now: Date;
  readonly timeZone?: string;
  readonly sourceLabel?: string;
  /** 单篇最多产出多少条候选，默认 10（与共享实现一致） */
  readonly maxCandidates?: number;
}

export type ArticleTextResult =
  | { readonly ok: true; readonly article: ActivityArticle }
  | { readonly ok: false; readonly message: string };

const MAX_TEXT_LINES = 500;

/** 单篇公众号链接上限（与 `validateWechatArticleUrl` 一致） */
export const ACTIVITY_URL_MAX_CHARS = 2048;
/** 活动标题 / 地点 / 主办方的输入上限；导出前仍会按契约字段校验 */
export const ACTIVITY_TEXT_FIELD_MAX_CHARS = 200;
/** 报名截止原文的输入上限（原文通常只有一行日期） */
export const ACTIVITY_DEADLINE_RAW_MAX_CHARS = 120;
/** 粘贴正文的上限：避免把整本电子书塞进浏览器内存；超出部分不会被解析 */
export const ACTIVITY_ARTICLE_TEXT_MAX_CHARS = 50_000;

/**
 * 正文 → 文章视图。
 *
 * ⚠️ 这条路径完全在本机完成：不请求服务端、不上传正文。抽取完调用方应立即
 * 清空 textarea，页面只保留抽出的活动字段。
 */
export function articleFromPastedText(text: string): ArticleTextResult {
  const normalized = text.replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ').trim();
  if (normalized === '') {
    return { ok: false, message: '请先粘贴文章正文。' };
  }

  const lines = normalized
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line !== '');
  if (lines.length < 2 || lines.join('').length < 20) {
    return {
      ok: false,
      message: '正文太短，至少需要标题 + 几行通知内容；建议直接粘贴公众号文章的完整正文。',
    };
  }

  return {
    ok: true,
    article: {
      title: truncateActivityEvidence(lines[0] ?? '', 120),
      accountName: '',
      publishedAt: null,
      bodyLines: lines.slice(0, MAX_TEXT_LINES),
      sourceUrl: '',
      sourceLabel: '用户粘贴的公众号正文',
    },
  };
}

export interface SubmitPastedTextOptions {
  readonly now: Date;
  readonly timeZone?: string;
  readonly maxCandidates?: number;
}

export interface PastedTextSubmission {
  /**
   * 提交后 textarea 应显示的内容。
   *
   * 只有**成功抽到候选**时才清空；空正文、太短、抽不到可靠时间都保留用户原文，
   * 否则用户刚粘好的正文会被一次失败清掉，只能重新找文章。
   */
  readonly draft: string;
  readonly error: string | null;
  readonly candidates: readonly ActivityItem[];
  readonly title: string;
}

/**
 * 粘贴正文的完整提交结果（纯函数）。
 *
 * 组件只负责把 `draft` / `error` / `candidates` 落到 state —— 清空时机由这里决定，
 * 这样「抽取失败保留 textarea」可以被单测锁住，而不是靠 UI 手测。
 */
export function submitPastedText(
  text: string,
  options: SubmitPastedTextOptions,
): PastedTextSubmission {
  const parsed = articleFromPastedText(text);
  if (!parsed.ok) {
    return { draft: text, error: parsed.message, candidates: [], title: '' };
  }

  const candidates = extractActivities(parsed.article, options);
  if (candidates.length === 0) {
    return {
      draft: text,
      error:
        '正文里没有找到可靠的活动时间或报名截止（例如只写了「本周五下午两点」）。'
        + '正文已保留，请补上明确日期与时刻后重试，或点「手动新增活动」自己填一条。',
      candidates: [],
      title: parsed.article.title,
    };
  }

  return { draft: '', error: null, candidates, title: parsed.article.title };
}

/**
 * 手动新增一条空白候选。
 *
 * 抽取失败（或文章里根本没有活动）时的兜底路径：字段全部留空，由用户自己填。
 * 不预填时间、不编证据；仍然从 `candidate` 开始，必须确认后才能导出。
 */
export function createManualActivity(now: Date): ActivityItem {
  const stamp = Number.isFinite(now.getTime()) ? now.getTime().toString(36) : 'now';
  const random =
    globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2, 10);
  return {
    id: `manual-${stamp}-${random}`,
    source: 'manual',
    kind: 'other',
    title: '',
    startsAt: null,
    endsAt: null,
    location: null,
    organizer: null,
    registrationDeadlineAt: null,
    registrationDeadlineRaw: null,
    registrationUrl: null,
    evidenceText: '',
    confidence: 1,
    status: 'candidate',
    sourceUrl: null,
    sourceLabel: '手动添加',
    publishedAt: null,
    stale: false,
  };
}

function toUtcIso(value: string | null): string | null {
  if (value === null || value.trim() === '') return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/** 证据是原文片段，但其中的链接仍要去掉会话参数，避免把 token 带进导出 */
function redactSessionUrls(text: string): string {
  return text.replace(/https?:\/\/[^\s"'<>，,。;；）)】]+/g, (raw) => {
    const trailing = /[.,;:]+$/.exec(raw)?.[0] ?? '';
    const core = trailing === '' ? raw : raw.slice(0, -trailing.length);
    const safe = sanitizeSourceUrl(core);
    return safe === null ? '[链接已移除]' : `${safe}${trailing}`;
  });
}

function stableActivityId(seed: string): string {
  let hash = 2_166_136_261;
  for (const char of seed) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619);
  }
  return `act-${(hash >>> 0).toString(36)}`;
}

const EVENT_TIME_HINT_RE = /(\d{1,2}\s*[:：]\s*\d{2})|(\d{1,2}\s*月\s*\d{1,2})|(\d{4}\s*[-/年]\s*\d{1,2})/;
const EVENT_PLACE_HINT_RE = /(地点|地址|场地|教室|楼|馆|报告厅|会议室|线上|腾讯会议|zoom)/i;

/**
 * 共享抽取器要求「时间 + 地点」出现在同一段。公众号通知常把它们拆成两行，
 * 于是 `pickEventCandidateLines` 一段都选不出来。这里只做**相邻行合并**，
 * 不改写任何文字；合并后再交给共享抽取器。
 */
function mergeAdjacentEventLines(lines: readonly string[]): readonly string[] {
  const merged: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]?.trim() ?? '';
    if (line === '') continue;
    const next = lines[index + 1]?.trim() ?? '';
    if (
      EVENT_TIME_HINT_RE.test(line)
      && !EVENT_PLACE_HINT_RE.test(line)
      && next !== ''
      && !EVENT_TIME_HINT_RE.test(next)
      && EVENT_PLACE_HINT_RE.test(next)
    ) {
      merged.push(`${line}；${next}`);
      index += 1;
      continue;
    }
    merged.push(line);
  }
  return merged;
}

function inferKind(text: string): ActivityKind {
  if (/运动|球赛|健身|跑步|瑜伽|运动会|sports/i.test(text)) return 'sports';
  if (/工作坊|培训|workshop/i.test(text)) return 'lecture';
  if (/演出|音乐会|晚会|电影|话剧|放映|志愿|公益|义卖|社团|performance|volunteer|club/i.test(text)) {
    return 'club';
  }
  if (/招新|纳新|招募|招聘|宣讲|recruit/i.test(text)) return 'info-session';
  if (/会议|研讨|meeting/i.test(text)) return 'meeting';
  if (/讲座|报告|论坛|沙龙|分享会|lecture/i.test(text)) return 'lecture';
  return 'other';
}

/**
 * 抽候选活动。
 *
 * 只把共享候选补成 `ActivityItem`，**不改写**它的时间/地点/证据结论：
 * 共享实现说「没有可靠时间」就不产出候选，说「只有日期」就保留原文。
 */
export function extractActivities(
  article: ActivityArticle,
  options: ExtractActivitiesOptions,
): readonly ActivityItem[] {
  const timeZone = options.timeZone ?? ACTIVITY_TIMEZONE;
  let candidates = extractActivityCandidates(article, {
    now: options.now,
    timeZone,
    ...(options.maxCandidates === undefined ? {} : { maxCandidates: options.maxCandidates }),
  });
  if (candidates.length === 0) {
    const mergedLines = mergeAdjacentEventLines(article.bodyLines);
    if (mergedLines.length !== article.bodyLines.length) {
      candidates = extractActivityCandidates(
        { ...article, bodyLines: mergedLines },
        {
          now: options.now,
          timeZone,
          ...(options.maxCandidates === undefined ? {} : { maxCandidates: options.maxCandidates }),
        },
      );
    }
  }

  const sourceUrl = sanitizeSourceUrl(article.sourceUrl);
  const sourceLabel =
    options.sourceLabel?.trim()
    || article.sourceLabel?.trim()
    || article.accountName.trim()
    || '微信公众号（用户提供）';
  const publishedAt = toUtcIso(article.publishedAt);

  return candidates.map((candidate, index) => ({
    id: stableActivityId(
      `${sourceUrl ?? ''}\u0000${candidate.title}\u0000${candidate.startsAt ?? ''}\u0000${index}`,
    ),
    source: 'wechat-mp',
    kind: inferKind(`${candidate.title}\n${candidate.evidenceText}`),
    title: candidate.title,
    startsAt: candidate.startsAt,
    endsAt: candidate.endsAt,
    location: candidate.location,
    organizer: candidate.organizer,
    registrationDeadlineAt: candidate.registrationDeadlineAt,
    registrationDeadlineRaw: candidate.registrationDeadlineRaw,
    registrationUrl: candidate.registrationUrl,
    evidenceText: truncateActivityEvidence(redactSessionUrls(candidate.evidenceText)),
    confidence: candidate.confidence,
    status: 'candidate',
    sourceUrl,
    sourceLabel,
    publishedAt,
    stale: false,
  }));
}

export type ActivityPatch = Partial<
  Pick<
    ActivityItem,
    | 'title'
    | 'kind'
    | 'startsAt'
    | 'endsAt'
    | 'location'
    | 'organizer'
    | 'registrationDeadlineAt'
    | 'registrationDeadlineRaw'
    | 'registrationUrl'
  >
>;

/** 编辑后若原本已确认，必须重新确认 —— 用户确认的是他看过的那一版 */
export function updateActivity(item: ActivityItem, patch: ActivityPatch): ActivityItem {
  return {
    ...item,
    ...patch,
    status: item.status === 'confirmed' ? 'candidate' : item.status,
  };
}

export function confirmActivity(item: ActivityItem): ActivityItem {
  return { ...item, status: 'confirmed' };
}

export function dismissActivity(item: ActivityItem): ActivityItem {
  return { ...item, status: 'dismissed' };
}

/** 取消确认：回到候选，必须再次核对后才能导出 */
export function unconfirmActivity(item: ActivityItem): ActivityItem {
  return { ...item, status: 'candidate' };
}

/** 撤销忽略：回到候选，不自动恢复为已确认 */
export function restoreActivity(item: ActivityItem): ActivityItem {
  return { ...item, status: 'candidate' };
}

export function confirmedActivities(items: readonly ActivityItem[]): readonly ActivityItem[] {
  return items.filter((item) => item.status === 'confirmed');
}

/** 多次导入时追加候选；按 id 去重，保留用户已经编辑过的那一条 */
export function mergeActivityCandidates(
  current: readonly ActivityItem[],
  incoming: readonly ActivityItem[],
): readonly ActivityItem[] {
  const existing = new Set(current.map((item) => item.id));
  return [...current, ...incoming.filter((item) => !existing.has(item.id))];
}

export type ActivityValidationErrors = Readonly<Record<string, string>>;

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

/** 导出/确认前的字段校验。空对象 = 可导出 */
export function validateActivity(item: ActivityItem): ActivityValidationErrors {
  const errors: Record<string, string> = {};

  if (item.title.trim() === '') errors.title = '请填写活动标题。';

  const startsMs = item.startsAt === null ? null : Date.parse(item.startsAt);
  const endsMs = item.endsAt === null ? null : Date.parse(item.endsAt);
  const deadlineMs =
    item.registrationDeadlineAt === null ? null : Date.parse(item.registrationDeadlineAt);

  if (item.startsAt !== null && !Number.isFinite(startsMs)) {
    errors.startsAt = '开始时间格式不正确。';
  }
  if (item.endsAt !== null && !Number.isFinite(endsMs)) {
    errors.endsAt = '结束时间格式不正确。';
  }
  if (item.registrationDeadlineAt !== null && !Number.isFinite(deadlineMs)) {
    errors.registrationDeadlineAt = '报名截止时间格式不正确。';
  }
  if (item.startsAt === null && item.registrationDeadlineAt === null) {
    errors.time = '至少填写开始时间或报名截止时间，否则导出的日历里没有可提醒的时刻。';
  }
  if (
    startsMs !== null
    && endsMs !== null
    && Number.isFinite(startsMs)
    && Number.isFinite(endsMs)
    && endsMs < startsMs
  ) {
    errors.endsAt = '结束时间不能早于开始时间。';
  }
  if (
    item.registrationUrl !== null
    && item.registrationUrl.trim() !== ''
    && !isHttpUrl(item.registrationUrl)
  ) {
    errors.registrationUrl = '报名链接必须是 http(s) 地址。';
  }

  return errors;
}

export type ActivityIcsOptions = IcsActivityBuildOptions;

/**
 * 导出前的统一清洗。
 *
 * 用户可以在表单里编辑报名链接，粘贴的来源也可能带会话参数；JSON 是原样序列化，
 * 所以不能只在抽取时清洗一次。这里把两个 URL 字段与证据片段一起过
 * `sanitizeSourceUrl` / 会话参数清洗，ICS 与 JSON 共用同一条出口。
 */
export function sanitizeActivityForExport(item: ActivityItem): ActivityItem {
  return {
    ...item,
    registrationUrl: sanitizeSourceUrl(item.registrationUrl),
    sourceUrl: sanitizeSourceUrl(item.sourceUrl),
    evidenceText: truncateActivityEvidence(redactSessionUrls(item.evidenceText)),
  };
}

/** 复用共享 ICS：只有 confirmed 会进日历；没有开始时间不编一个 */
export function buildActivityIcs(
  items: readonly ActivityItem[],
  options: ActivityIcsOptions,
): string {
  return buildSharedActivityIcs(
    items.map((item) => ({
      ...sanitizeActivityForExport(item),
      // 契约允许 sourceLabel 为 null（例如来源不明）；ICS 描述需要一个可读标签
      sourceLabel: item.sourceLabel ?? '来源未知',
    })),
    options,
  );
}

/** 已确认活动 → JSON（契约字段原样，不含正文；URL 与证据统一清洗） */
export function buildActivityJson(items: readonly ActivityItem[]): string {
  return JSON.stringify(
    confirmedActivities(items).map(sanitizeActivityForExport),
    null,
    2,
  );
}

export { ACTIVITY_EVIDENCE_MAX_CHARS, truncateActivityEvidence };
