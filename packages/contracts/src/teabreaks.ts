/**
 * 学术会议茶歇分享（`teabreak`）
 *
 * ## 一句话
 *
 * 同学把**校内学术会议**的时间、地点、有没有茶歇**报上来**，
 * 其他人据此判断「现在这栋楼里哪间会议室正在发点心」。
 *
 * ## 为什么这个功能需要小心设计
 *
 * 1. **茶歇有保质期**。一个 20 分钟的茶歇，昨天的信息等于没有。
 *    所以本模块的核心不是「列表」，是「**多久没被确认了**」。
 * 2. **蹭会是常见需求，但要不要说破**。
 *    真实情况：有些会议茶歇对全楼开放，有些只对注册者。
 *    我们不谴责也不鼓励，但**必须标注** `access` 让用户自己判断风险 ——
 *    被工作人员请出去的场面比少吃一块蛋糕难受得多。
 * 3. **不能变成骚扰工具**。所以不提供「会议室实时人数」，
 *    也不做「预约茶歇」—— 只做「这里有个会、大概什么时间有茶歇」。
 */

/* ------------------------------------------------------------------ *
 * 1. 开放程度
 * ------------------------------------------------------------------ */

/**
 * 茶歇的开放程度。
 *
 * 这是本模块**最有价值的一个字段** —— 它决定了「去不去」的决策，
 * 也决定了用户承担的风险。
 */
export const TEABREAK_ACCESS = ['open', 'registered', 'unknown'] as const;

export type TeabreakAccess = (typeof TEABREAK_ACCESS)[number];

export const TEABREAK_ACCESS_LABELS: Readonly<Record<TeabreakAccess, string>> = Object.freeze({
  open: '对外开放（不需注册）',
  registered: '仅限注册参会者',
  unknown: '不确定',
});

/**
 * 给每个开放程度的**风险提示**。
 *
 * 不写「请勿蹭会」这种说教 —— 用户是成年人。
 * 只陈述事实：去了可能被问「你是哪位」。
 */
export const TEABREAK_ACCESS_HINTS: Readonly<Record<TeabreakAccess, string>> = Object.freeze({
  open: '通常会有人指引，可以直接过去。',
  registered: '需要会议注册证或胸牌，可能被工作人员询问。',
  unknown: '发布者也不确定。建议在门口观察一下，或找认识的参会者带进去。',
});

/* ------------------------------------------------------------------ *
 * 2. 时效：茶歇的「保质期」
 * ------------------------------------------------------------------ */

/**
 * 茶歇信息多久算「过期」。
 *
 * 20 分钟是**实测经验值**：一个会议茶歇通常 15–30 分钟。
 * 超过这个时长还没人再确认，默认已经收摊。
 */
export const TEABREAK_FRESHNESS_MS = 20 * 60 * 1000;

/**
 * 一条茶歇信息的可信度。
 *
 * | 状态 | 含义 |
 * | --- | --- |
 * | `fresh` | 20 分钟内有人确认过「还有」—— 现在去大概率有 |
 * | `stale` | 超过 20 分钟没确认 —— 可能还有，可能没了 |
 * | `over` | 茶歇结束时间已过 —— 别去了 |
 * | `notStarted` | 茶歇还没开始 |
 */
export const TEABREAK_FRESHNESS = ['fresh', 'stale', 'over', 'notStarted'] as const;

export type TeabreakFreshness = (typeof TEABREAK_FRESHNESS)[number];

export const TEABREAK_FRESHNESS_LABELS: Readonly<Record<TeabreakFreshness, string>> = Object.freeze({
  fresh: '刚确认还有',
  stale: '20 分钟没人确认了',
  over: '已结束',
  notStarted: '还没开始',
});

/* ------------------------------------------------------------------ *
 * 3. 数据模型
 * ------------------------------------------------------------------ */

/** 一次「确认还有茶歇」—— 比附议更轻，只说明「刚才我去看了，有」 */
export interface TeabreakConfirm {
  /** 随机标识（不是用户 id），仅用于去重 */
  readonly confirmId: string;
  readonly confirmedAt: string;
}

/** 一条学术会议茶歇信息 */
export interface Teabreak {
  readonly id: string;
  /** 会议名称（要能认出来，比如「第七届信息科学前沿论坛」） */
  readonly conferenceName: string;
  /** 地点（楼 + 房间，比如「信息学院 1-101」） */
  readonly venue: string;
  /** 会议开始时间（ISO-8601） */
  readonly conferenceStartsAt: string;
  /** 会议结束时间（ISO-8601） */
  readonly conferenceEndsAt: string;
  /**
   * 茶歇时间窗。
   *
   * ⚠️ 允许与会议时间窗不同 —— 茶歇通常在会议中途，
   * 而且**发布者经常只知道大概**（「下午三点多」）。
   * 所以这里用 `{ startsAt, endsAt }` 而不是单个时刻，
   * 且允许 `endsAt - startsAt` 短到 15 分钟。
   */
  readonly teaStartsAt: string;
  readonly teaEndsAt: string;
  readonly access: TeabreakAccess;
  /** 发布者显示名 */
  readonly postedBy: string;
  readonly createdAt: string;
  /** 「我去看了，还有」的确认记录 */
  readonly confirms: readonly TeabreakConfirm[];
  /** 补充说明（比如「有咖啡和可颂」「在二楼走廊」） */
  readonly note: string | null;
}

/* ------------------------------------------------------------------ *
 * 4. 时效判定
 * ------------------------------------------------------------------ */

export interface TeabreakStatus {
  readonly freshness: TeabreakFreshness;
  /** 最近一次确认距今多久（毫秒）；从未确认则为 `null` */
  readonly sinceLastConfirmMs: number | null;
  /** 值不值得现在跑一趟 */
  readonly worthGoing: boolean;
}

/**
 * 算一条茶歇信息的当前状态。
 *
 * @param now 当前时刻（注入而不是读时钟，便于测试）
 */
export function teabreakStatus(
  teabreak: Pick<Teabreak, 'teaStartsAt' | 'teaEndsAt' | 'confirms'>,
  now: Date,
): TeabreakStatus {
  const nowMs = now.getTime();
  const startMs = Date.parse(teabreak.teaStartsAt);
  const endMs = Date.parse(teabreak.teaEndsAt);

  const lastConfirm = teabreak.confirms.reduce<number | null>((latest, c) => {
    const t = Date.parse(c.confirmedAt);
    if (Number.isNaN(t)) return latest;
    return latest === null || t > latest ? t : latest;
  }, null);

  const sinceLastConfirmMs = lastConfirm === null ? null : nowMs - lastConfirm;

  // 已过结束时间 → 一定没了
  if (nowMs > endMs) {
    return { freshness: 'over', sinceLastConfirmMs, worthGoing: false };
  }

  // 还没到开始时间
  if (nowMs < startMs) {
    return { freshness: 'notStarted', sinceLastConfirmMs, worthGoing: false };
  }

  // 时间窗内：看多久没被确认
  const fresh = sinceLastConfirmMs !== null && sinceLastConfirmMs <= TEABREAK_FRESHNESS_MS;
  return {
    freshness: fresh ? 'fresh' : 'stale',
    sinceLastConfirmMs,
    // ⚠️ `stale` 也算「值得去」—— 但要在 UI 上说清楚是「可能还有」。
    // 判断标准不是「新鲜」，而是「时间窗内」。新鲜度只影响文案的确定性。
    worthGoing: true,
  };
}

/**
 * 按「值不值得现在跑一趟」排序。
 *
 * 排序规则（依次比较）：
 * 1. `worthGoing` 为真的排前面
 * 2. 同样值得去时，`fresh` 排在 `stale` 前面
 * 3. 同样新鲜度时，茶歇**结束得早**的排前面（快没了，先冲这个）
 * 4. 最后按开始时间
 */
export function sortTeabreaks(teabreaks: readonly Teabreak[], now: Date): readonly Teabreak[] {
  const rank = (freshness: TeabreakFreshness): number => {
    switch (freshness) {
      case 'fresh':
        return 0;
      case 'stale':
        return 1;
      case 'notStarted':
        return 2;
      case 'over':
        return 3;
      default:
        return 4;
    }
  };

  return [...teabreaks].sort((a, b) => {
    const sa = teabreakStatus(a, now);
    const sb = teabreakStatus(b, now);

    if (sa.worthGoing !== sb.worthGoing) return sa.worthGoing ? -1 : 1;
    if (rank(sa.freshness) !== rank(sb.freshness)) return rank(sa.freshness) - rank(sb.freshness);

    // 同样值得去：结束得早的先冲
    const ea = Date.parse(a.teaEndsAt);
    const eb = Date.parse(b.teaEndsAt);
    if (ea !== eb) return ea - eb;

    return Date.parse(a.teaStartsAt) - Date.parse(b.teaStartsAt);
  });
}

/* ------------------------------------------------------------------ *
 * 5. 校验（与 UI 共用）
 * ------------------------------------------------------------------ */

export const TEABREAK_CONFERENCE_MIN = 3;
export const TEABREAK_CONFERENCE_MAX = 80;
export const TEABREAK_VENUE_MIN = 2;
export const TEABREAK_VENUE_MAX = 60;
/** 茶歇窗口最短 10 分钟（再短就不是茶歇了） */
export const TEABREAK_MIN_WINDOW_MS = 10 * 60 * 1000;
/** 茶歇窗口最长 3 小时（再长说明填错了，或者那是午餐） */
export const TEABREAK_MAX_WINDOW_MS = 3 * 60 * 60 * 1000;

export type TeabreakDraftProblem =
  | 'conference-too-short'
  | 'conference-too-long'
  | 'venue-too-short'
  | 'venue-too-long'
  | 'conference-end-before-start'
  | 'tea-window-too-short'
  | 'tea-window-too-long'
  | 'tea-outside-conference'
  | 'in-the-past';

export interface TeabreakDraftInput {
  readonly conferenceName: string;
  readonly venue: string;
  readonly conferenceStartsAt: string;
  readonly conferenceEndsAt: string;
  readonly teaStartsAt: string;
  readonly teaEndsAt: string;
}

/**
 * 校验草稿；返回问题列表（空 = 通过）。
 *
 * 用**问题码**而不是布尔：UI 要给具体提示。
 */
export function validateTeabreakDraft(
  draft: TeabreakDraftInput,
  now: Date,
): readonly TeabreakDraftProblem[] {
  const problems: TeabreakDraftProblem[] = [];

  const name = draft.conferenceName.trim();
  const venue = draft.venue.trim();
  if (name.length < TEABREAK_CONFERENCE_MIN) problems.push('conference-too-short');
  if (name.length > TEABREAK_CONFERENCE_MAX) problems.push('conference-too-long');
  if (venue.length < TEABREAK_VENUE_MIN) problems.push('venue-too-short');
  if (venue.length > TEABREAK_VENUE_MAX) problems.push('venue-too-long');

  const cStart = Date.parse(draft.conferenceStartsAt);
  const cEnd = Date.parse(draft.conferenceEndsAt);
  const tStart = Date.parse(draft.teaStartsAt);
  const tEnd = Date.parse(draft.teaEndsAt);

  const bad = [cStart, cEnd, tStart, tEnd].some((v) => Number.isNaN(v));
  if (bad) {
    // 时间解析不了，后面的时间比较没有意义
    problems.push('tea-window-too-short');
    return problems;
  }

  if (cEnd <= cStart) problems.push('conference-end-before-start');

  const windowMs = tEnd - tStart;
  if (windowMs < TEABREAK_MIN_WINDOW_MS) problems.push('tea-window-too-short');
  if (windowMs > TEABREAK_MAX_WINDOW_MS) problems.push('tea-window-too-long');

  // 茶歇必须在会议时间窗内（允许贴边）
  if (tStart < cStart || tEnd > cEnd) problems.push('tea-outside-conference');

  // 已经结束的会不能再发
  if (cEnd < now.getTime()) problems.push('in-the-past');

  return problems;
}

/** 问题码 → 中文提示 */
export function describeTeabreakProblem(problem: TeabreakDraftProblem): string {
  const table: Readonly<Record<TeabreakDraftProblem, string>> = {
    'conference-too-short': `会议名称至少 ${TEABREAK_CONFERENCE_MIN} 个字，要能认出来是哪个会`,
    'conference-too-long': `会议名称最多 ${TEABREAK_CONFERENCE_MAX} 个字`,
    'venue-too-short': '地点至少 2 个字，请写清楼和房间号',
    'venue-too-long': `地点最多 ${TEABREAK_VENUE_MAX} 个字`,
    'conference-end-before-start': '会议结束时间必须晚于开始时间',
    'tea-window-too-short': '茶歇时间窗至少 10 分钟',
    'tea-window-too-long': '茶歇时间窗最多 3 小时（再长可能不是茶歇）',
    'tea-outside-conference': '茶歇必须在会议时间之内',
    'in-the-past': '这个会议已经结束了，发出来也没人去',
  };
  return table[problem];
}

/* ------------------------------------------------------------------ *
 * 6. 「还能撑多久」的文案
 * ------------------------------------------------------------------ */

/** 把剩余时间说成人话（用于「还有 X 分钟结束」） */
export function describeRemaining(endIso: string, now: Date): string {
  const remainMs = Date.parse(endIso) - now.getTime();
  if (Number.isNaN(remainMs)) return '';
  if (remainMs <= 0) return '已结束';

  const minutes = Math.round(remainMs / 60000);
  if (minutes < 1) return '不到 1 分钟';
  if (minutes < 60) return `还有 ${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `还有 ${hours} 小时` : `还有 ${hours} 小时 ${rest} 分钟`;
}

/** 把「多久没确认」说成人话 */
export function describeSinceConfirm(sinceMs: number | null): string {
  if (sinceMs === null) return '还没有人确认';
  if (sinceMs < 60000) return '刚刚确认';
  const minutes = Math.floor(sinceMs / 60000);
  if (minutes < 60) return `${minutes} 分钟前确认`;
  const hours = Math.floor(minutes / 60);
  return `${hours} 小时前确认`;
}
