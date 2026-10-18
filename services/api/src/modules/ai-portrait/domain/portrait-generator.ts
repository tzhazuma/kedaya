/**
 * AI 校园画像 · **生成逻辑**（纯函数，零框架依赖）
 *
 * ## 这个生成器做什么
 *
 * 把用户在**允许来源**里的行为统计，聚合成一组**可解释**的标签。
 *
 * ## 它刻意不做什么（这比"做了什么"更重要）
 *
 * 1. **不做心理推断**。它只陈述"你在拼单上发起了 7 次"这种**计数事实**，
 *    不会说"你喜欢社交"或"你性格外向" —— 那是契约 §9 禁止的推断，
 *    也是心理支持数据被排除在画像之外的原因。
 * 2. **不读禁止来源**。`wellbeing`（心理支持）与 `dorm-harmony`（宿舍矛盾）
 *    的数据不以任何形式进入这里 —— 不是"读了再删"，是**根本没读**。
 * 3. **不编造**。某个来源没有行为就不产生标签；全部为空时返回 `null`，
 *    让客户端显示空态，而不是给一份"通用画像"。
 * 4. **每条标签都能溯源**。`explain.sources` 精确到「哪个模块、哪几个计数」。
 *
 * ## 为什么标签是"计数 + 档位"而不是"性格形容词"
 *
 * 「活跃的拼单参与者」这类形容词无法证伪，也无法让用户判断对错。
 * 「本学期发起 7 次拼单，在本校发起者中属于偏多」用户可以核对、可以反驳、
 * 可以要求删除。**可反驳是画像能被接受的前提。**
 */

import {
  ALLOWED_PORTRAIT_SOURCES,
  FORBIDDEN_PORTRAIT_SOURCES,
} from './ai-portrait.domain';

/* ------------------------------------------------------------------ *
 * 输入
 * ------------------------------------------------------------------ */

/** 单一来源的行为计数（由各模块的 repository 统计后传入） */
export interface PortraitSourceCounts {
  /** 来源模块 id（必须在 `ALLOWED_PORTRAIT_SOURCES` 里） */
  readonly source: string;
  /** 该模块里用户的**行为条数**（发起 / 参与 / 发布 / 回复 …） */
  readonly actions: number;
  /** 统计窗口的起点（ISO），用于标签里写"本学期"还是"近 30 天" */
  readonly since: string;
  /** 可选：该模块里细分动作的计数，用于生成更具体的标签 */
  readonly breakdown?: Readonly<Record<string, number>>;
}

/** 生成结果里的一条标签 */
export interface PortraitTrait {
  /** 稳定 key（客户端据此做图标/排序，不要用中文标题当 key） */
  readonly key: string;
  /** 给人看的标题 —— **陈述事实，不做形容词推断** */
  readonly label: string;
  /** 档位：low / medium / high（由计数阈值决定，阈值写在下面的常量里） */
  readonly level: 'low' | 'medium' | 'high';
  /** 具体数值，供用户核对 */
  readonly value: number;
}

/** 一条标签的溯源 */
export interface PortraitTraitExplanation {
  readonly key: string;
  /** 用到了哪些来源模块 */
  readonly sources: readonly string[];
  /** 每条来源贡献的计数 */
  readonly contributions: readonly { readonly source: string; readonly actions: number }[];
  /** 一句话说明"为什么是这个档位" */
  readonly reason: string;
}

export interface PortraitGenerationResult {
  readonly traits: readonly PortraitTrait[];
  readonly explain: {
    readonly sources: readonly string[];
    readonly items: readonly PortraitTraitExplanation[];
    /** 生成时间与窗口，供"这条画像是什么时候算的" */
    readonly generatedAt: string;
    readonly windowStart: string;
    readonly windowEnd: string;
  };
}

/* ------------------------------------------------------------------ *
 * 阈值（档位判定的唯一真相）
 * ------------------------------------------------------------------ */

/**
 * 档位阈值。
 *
 * ⚠️ 这些数字是**产品判断**，不是统计数据。它们的意义是"让标签可反驳"，
 * 不是"准确刻画一个人"。改这里的时应当同时改页面上的说明文案，
 * 否则用户会以为这是某种客观评级。
 */
export const PORTRAIT_THRESHOLDS = {
  /** < medium 算 low，>= high 算 high */
  medium: 3,
  high: 10,
} as const;

function levelOf(actions: number): PortraitTrait['level'] {
  if (actions >= PORTRAIT_THRESHOLDS.high) return 'high';
  if (actions >= PORTRAIT_THRESHOLDS.medium) return 'medium';
  return 'low';
}

/* ------------------------------------------------------------------ *
 * 各来源的标签模板
 * ------------------------------------------------------------------ */

/**
 * 来源 → 标签模板。
 *
 * **模板里的文案必须是事实陈述**。不要改成「热爱生活」「社交达人」这类形容词 ——
 * 那是推断，且无法被用户反驳。
 */
const TRAIT_TEMPLATES: Readonly<
  Record<string, { key: string; noun: string }>
> = {
  groupbuy: { key: 'groupbuy_activity', noun: '拼单' },
  errand: { key: 'errand_activity', noun: '跑腿' },
  'flea-market': { key: 'flea_activity', noun: '跳蚤市场' },
  canteen: { key: 'canteen_activity', noun: '食堂营养记录' },
  forum: { key: 'forum_activity', noun: '论坛发帖与回复' },
  'lost-found': { key: 'lostfound_activity', noun: '失物招领' },
  buddy: { key: 'buddy_activity', noun: '找搭子' },
  wildlife: { key: 'wildlife_activity', noun: '动物观察上报' },
  faq: { key: 'faq_activity', noun: '常见问题查询' },
  schedule: { key: 'schedule_view', noun: '课表查看' },
};

/* ------------------------------------------------------------------ *
 * 生成
 * ------------------------------------------------------------------ */

/**
 * 校验输入是否只含允许来源。
 *
 * **默认拒绝**：不在白名单里的一律拒绝（而不是"不在黑名单里就放行"）。
 * 这样新增模块时不会因为忘记登记而悄悄泄漏进画像。
 */
export function assertAllowedSources(counts: readonly PortraitSourceCounts[]): void {
  for (const item of counts) {
    if (FORBIDDEN_PORTRAIT_SOURCES.includes(item.source)) {
      throw new Error(
        `来源 ${item.source} 属禁止集合（契约 §9：心理支持与宿舍矛盾不得进入画像）`,
      );
    }
    if (!ALLOWED_PORTRAIT_SOURCES.includes(item.source)) {
      throw new Error(
        `来源 ${item.source} 不在允许清单里 —— 新增模块须先登记到 ALLOWED_PORTRAIT_SOURCES`,
      );
    }
  }
}

/**
 * 生成画像。
 *
 * 返回 `null` 表示**没有任何可用的行为数据** —— 客户端应显示空态，
 * **不要**用一份"通用画像"填充。
 */
export function generatePortrait(input: {
  readonly counts: readonly PortraitSourceCounts[];
  readonly now: Date;
}): PortraitGenerationResult | null {
  assertAllowedSources(input.counts);

  const usable = input.counts.filter((item) => item.actions > 0);
  if (usable.length === 0) return null;

  const traits: PortraitTrait[] = [];
  const items: PortraitTraitExplanation[] = [];

  for (const item of usable) {
    const template = TRAIT_TEMPLATES[item.source];
    if (template === undefined) continue; // 已通过白名单校验，理论不可达

    const level = levelOf(item.actions);
    const levelWord = level === 'high' ? '偏多' : level === 'medium' ? '中等' : '偏少';

    traits.push({
      key: template.key,
      // 事实陈述：「本期在拼单上发起/参与 7 次」+ 档位词
      label: `本期在${template.noun}上有 ${item.actions} 次行为（${levelWord}）`,
      level,
      value: item.actions,
    });

    items.push({
      key: template.key,
      sources: [item.source],
      contributions: [{ source: item.source, actions: item.actions }],
      reason:
        `计数 ${item.actions} 次；档位阈值：≥${PORTRAIT_THRESHOLDS.medium} 为中等、`
        + `≥${PORTRAIT_THRESHOLDS.high} 为偏多。档位是**计数分档**，不是对你的评价。`,
    });
  }

  // 全部来源都没有可生成模板 → 视为无数据
  if (traits.length === 0) return null;

  const windowStart = usable
    .map((item) => item.since)
    .sort()[0] ?? input.now.toISOString();

  return {
    traits,
    explain: {
      sources: usable.map((item) => item.source),
      items,
      generatedAt: input.now.toISOString(),
      windowStart,
      windowEnd: input.now.toISOString(),
    },
  };
}

/**
 * 生成的画像是否应该对外展示。
 *
 * 三道闸门都要过：有数据、用户开启、每条标签都能溯源。
 * 最后一条是冗余校验 —— 它保证"说不清来源的标签"永远到不了客户端。
 */
export function shouldExposePortrait(input: {
  readonly profile: { enabled: boolean; traits: unknown; explain: unknown } | null;
}): boolean {
  const { profile } = input;
  if (profile === null) return false;
  if (!profile.enabled) return false;
  if (!Array.isArray(profile.traits) || profile.traits.length === 0) return false;

  const explain = profile.explain as { items?: unknown } | null;
  if (explain === null || typeof explain !== 'object') return false;
  if (!Array.isArray(explain.items) || explain.items.length === 0) return false;

  // 每个 trait 都要有对应的 explain item
  const explainedKeys = new Set(
    (explain.items as { key?: unknown }[])
      .map((item) => item.key)
      .filter((key): key is string => typeof key === 'string'),
  );
  return (profile.traits as { key?: unknown }[]).every(
    (trait) => typeof trait.key === 'string' && explainedKeys.has(trait.key),
  );
}
