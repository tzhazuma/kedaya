/**
 * 常见问题（faq）领域模型 —— 纯逻辑，零框架、零 IO（契约 §7）。
 *
 * 对齐 `docs/architecture/02-domain-model.md` §2.8：
 * - `FaqArticle.status` ∈ DRAFT | PUBLISHED | ARCHIVED，`helpfulCount` / `unhelpfulCount`
 * - `FaqTicket.status` ∈ OPEN | ANSWERED | CLOSED（状态机见该节 mermaid）
 * - `FaqTicket.userId` **可为 null**：未登录也能提交工单
 * - `contact` 是邮箱或微信，**不存明文手机号**（隐私硬规则）
 *
 * 时间一律 ISO-8601 UTC 字符串；本层不做本地化。
 */
import { isChinaMobile, isLengthWithin } from '@kedaya/shared';

/* ------------------------------------------------------------------ *
 * 实体
 * ------------------------------------------------------------------ */

export type FaqArticleStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';

export interface FaqArticle {
  id: string;
  /** 唯一 slug */
  slug: string;
  /** 1–120 字 */
  question: string;
  /** Markdown 子集，≤10000 字 */
  answer: string;
  /** 分类 id（契约里是自由 string，Web 侧用 FAQ_CATEGORIES 收敛） */
  category: string;
  status: FaqArticleStatus;
  helpfulCount: number;
  unhelpfulCount: number;
  updatedAt: string;
}

export type FaqTicketStatus = 'OPEN' | 'ANSWERED' | 'CLOSED';

export interface FaqTicket {
  id: string;
  /** 未登录提交时为 null（契约 §2.8） */
  userId: string | null;
  /** 邮箱或微信；**绝不存明文手机号** */
  contact: string;
  /** ≤2000 字 */
  question: string;
  status: FaqTicketStatus;
  createdAt: string;
  updatedAt: string;
  /** 管理员回复 */
  answer?: string;
  answeredAt?: string;
}

export type FaqVote = 'helpful' | 'unhelpful';

/* ------------------------------------------------------------------ *
 * 文案表
 * ------------------------------------------------------------------ */

export const FAQ_ARTICLE_STATUS_LABELS: Record<FaqArticleStatus, string> = {
  DRAFT: '草稿',
  PUBLISHED: '已发布',
  ARCHIVED: '已归档',
};

export const FAQ_TICKET_STATUS_LABELS: Record<FaqTicketStatus, string> = {
  OPEN: '待回复',
  ANSWERED: '已回复',
  CLOSED: '已关闭',
};

export interface FaqCategory {
  id: string;
  label: string;
  description: string;
}

/** 分类导航（顺序即展示顺序）。契约里 category 是自由 string，这里给出 Web 侧收敛表。 */
export const FAQ_CATEGORIES: readonly FaqCategory[] = [
  { id: 'account', label: '账号与登录', description: '统一身份认证、校园系统绑定、登录异常' },
  { id: 'modules', label: '功能使用', description: '拼单 / 跑腿 / 论坛等各模块怎么用' },
  { id: 'privacy', label: '隐私与数据', description: '匿名、审计、数据导出与删除' },
  { id: 'governance', label: '内容治理', description: '举报、申诉、版主处理时限' },
  { id: 'other', label: '其他', description: '不属于以上分类的问题' },
] as const;

export const FAQ_ALL_CATEGORY_ID = 'all';

export function categoryLabel(categoryId: string): string {
  return FAQ_CATEGORIES.find((c) => c.id === categoryId)?.label ?? categoryId;
}

export const FAQ_LIMITS = {
  questionMin: 1,
  questionMax: 120,
  answerMax: 10_000,
  ticketQuestionMax: 2_000,
  contactMax: 120,
} as const;

/** 工单自动关闭窗口（域模型 §2.8：ANSWERED 后 7 天自动关闭） */
export const TICKET_AUTO_CLOSE_DAYS = 7;

/* ------------------------------------------------------------------ *
 * 工单状态机（严格对齐 §2.8 mermaid）
 * ------------------------------------------------------------------ */

const TICKET_TRANSITIONS: Record<FaqTicketStatus, readonly FaqTicketStatus[]> = {
  OPEN: ['ANSWERED'],
  ANSWERED: ['CLOSED', 'OPEN'],
  CLOSED: [],
};

export function canTransitionTicket(from: FaqTicketStatus, to: FaqTicketStatus): boolean {
  return TICKET_TRANSITIONS[from].includes(to);
}

export function transitionTicket(ticket: FaqTicket, to: FaqTicketStatus): FaqTicket | null {
  if (!canTransitionTicket(ticket.status, to)) return null;
  return { ...ticket, status: to };
}

export function nextTicketStatuses(from: FaqTicketStatus): FaqTicketStatus[] {
  return [...TICKET_TRANSITIONS[from]];
}

/** 是否还在等提问者追问/确认（已回复但未关闭） */
export function ticketNeedsReply(ticket: Pick<FaqTicket, 'status'>): boolean {
  return ticket.status === 'ANSWERED';
}

/* ------------------------------------------------------------------ *
 * 检索
 * ------------------------------------------------------------------ */

export interface FaqArticleQueryShape {
  category?: string;
  keyword?: string;
  status?: FaqArticleStatus;
}

function normalize(text: string): string {
  return text.trim().toLowerCase();
}

/** 关键词是否命中条目（问题 / 答案 / 分类名） */
export function matchesKeyword(article: FaqArticle, keyword: string): boolean {
  const needle = normalize(keyword);
  if (!needle) return true;
  const haystack = [article.question, article.answer, categoryLabel(article.category)]
    .map(normalize)
    .join('\n');
  // 逐字包含：中文没有词边界，按子串匹配最符合预期
  return haystack.includes(needle);
}

function categoryOrder(categoryId: string): number {
  const index = FAQ_CATEGORIES.findIndex((c) => c.id === categoryId);
  return index === -1 ? FAQ_CATEGORIES.length : index;
}

/**
 * 检索排序：问题命中优先 → 分类顺序 → 有用数降序 → 更新时间降序。
 * 关键词为空时退化为「分类顺序 + 有用数」。
 */
export function searchArticles(
  articles: readonly FaqArticle[],
  keyword = '',
  options: { status?: FaqArticleStatus; category?: string } = {},
): FaqArticle[] {
  const needle = normalize(keyword);
  const filtered = articles.filter((article) => {
    if (options.status && article.status !== options.status) return false;
    if (options.category && options.category !== FAQ_ALL_CATEGORY_ID && article.category !== options.category) {
      return false;
    }
    return matchesKeyword(article, needle);
  });

  return filtered.sort((a, b) => {
    if (needle) {
      const aTitle = normalize(a.question).includes(needle) ? 0 : 1;
      const bTitle = normalize(b.question).includes(needle) ? 0 : 1;
      if (aTitle !== bTitle) return aTitle - bTitle;
    }
    const byCategory = categoryOrder(a.category) - categoryOrder(b.category);
    if (byCategory !== 0) return byCategory;
    if (a.helpfulCount !== b.helpfulCount) return b.helpfulCount - a.helpfulCount;
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });
}

export interface FaqCategoryGroup {
  category: FaqCategory;
  articles: FaqArticle[];
}

/** 按分类分组（空分类也保留，便于导航展示计数 0） */
export function groupArticlesByCategory(
  articles: readonly FaqArticle[],
): FaqCategoryGroup[] {
  return FAQ_CATEGORIES.map((category) => ({
    category,
    articles: articles.filter((a) => a.category === category.id),
  }));
}

/** 分类计数（分类导航用） */
export function countByCategory(
  articles: readonly FaqArticle[],
): Record<string, number> {
  const acc: Record<string, number> = {};
  for (const category of FAQ_CATEGORIES) acc[category.id] = 0;
  for (const article of articles) acc[article.category] = (acc[article.category] ?? 0) + 1;
  return acc;
}

/* ------------------------------------------------------------------ *
 * 有用 / 无用投票（乐观更新的纯逻辑核心）
 * ------------------------------------------------------------------ */

export interface VoteCounts {
  helpfulCount: number;
  unhelpfulCount: number;
}

/** 有用占比（0–100 整数）；总票数为 0 时返回 0 */
export function helpfulPercent(counts: VoteCounts): number {
  const total = counts.helpfulCount + counts.unhelpfulCount;
  if (total <= 0) return 0;
  const raw = Math.round((counts.helpfulCount / total) * 100);
  return Math.min(100, Math.max(0, raw));
}

/**
 * 把「我的一票」从 `previous` 改成 `next`，返回**新的计数**（纯函数，不可变）。
 *
 * 语义（乐观更新与后端必须一致）：
 * - `previous === next` → 计数不变（重复点击同一按钮是幂等的，不能重复 +1）
 * - `previous === null` → 给 `next` 那一侧 +1
 * - `previous !== null && previous !== next` → 旧侧 -1、新侧 +1（改票）
 * - `next === null` → 撤回我的一票（旧侧 -1）
 * - 计数不会降到 0 以下
 */
export function applyVote(
  counts: VoteCounts,
  previous: FaqVote | null,
  next: FaqVote | null,
): VoteCounts {
  let helpful = counts.helpfulCount;
  let unhelpful = counts.unhelpfulCount;

  if (previous === next) return { helpfulCount: helpful, unhelpfulCount: unhelpful };

  if (previous === 'helpful') helpful -= 1;
  if (previous === 'unhelpful') unhelpful -= 1;
  if (next === 'helpful') helpful += 1;
  if (next === 'unhelpful') unhelpful += 1;

  return {
    helpfulCount: Math.max(0, helpful),
    unhelpfulCount: Math.max(0, unhelpful),
  };
}

/* ------------------------------------------------------------------ *
 * 工单联系方式（隐私硬规则：不存明文手机号）
 * ------------------------------------------------------------------ */

export interface ContactValidation {
  ok: boolean;
  /** 通过校验时给后端存的值（可能已脱敏） */
  contact: string;
  problems: string[];
}

/**
 * 联系方式校验 + 手机号脱敏。
 *
 * 契约 §2.8 明确「邮箱或微信，**不存明文手机号**」，因此：
 * - 纯手机号 → 拒绝，并提示改用邮箱 / 微信
 * - 邮箱 → 保留原样（后端仍需加密存储）
 * - 其它（微信号等）→ 保留原样
 */
export function validateTicketContact(raw: string): ContactValidation {
  const contact = raw.trim();
  const problems: string[] = [];
  if (!contact) {
    problems.push('请填写联系方式（邮箱或微信号）');
    return { ok: false, contact, problems };
  }
  if ([...contact].length > FAQ_LIMITS.contactMax) {
    problems.push(`联系方式不能超过 ${FAQ_LIMITS.contactMax} 字`);
  }
  if (isChinaMobile(contact)) {
    problems.push('出于隐私考虑不保存明文手机号，请改用邮箱或微信号');
  }
  return { ok: problems.length === 0, contact, problems };
}

/** 展示用脱敏：邮箱保留首字符与域名，微信号保留首尾各 1 个字符 */
export function maskContact(contact: string): string {
  const at = contact.lastIndexOf('@');
  if (at > 0) {
    const name = contact.slice(0, at);
    const domain = contact.slice(at);
    const head = [...name][0] ?? '';
    return `${head}${'*'.repeat(Math.max(1, Math.min(6, [...name].length - 1)))}${domain}`;
  }
  const chars = [...contact];
  if (chars.length <= 2) return `${chars[0] ?? ''}*`;
  return `${chars[0]}${'*'.repeat(chars.length - 2)}${chars[chars.length - 1]}`;
}

/* ------------------------------------------------------------------ *
 * 工单草稿校验
 * ------------------------------------------------------------------ */

export interface FaqTicketDraft {
  contact: string;
  question: string;
}

export function validateTicketDraft(draft: FaqTicketDraft): string[] {
  const problems: string[] = [...validateTicketContact(draft.contact).problems];
  const question = draft.question.trim();
  if (!question) problems.push('请描述你遇到的问题');
  if ([...question].length > FAQ_LIMITS.ticketQuestionMax) {
    problems.push(`问题描述不能超过 ${FAQ_LIMITS.ticketQuestionMax} 字`);
  }
  return problems;
}

/** 是否已过自动关闭窗口（ANSWERED 且超 7 天） */
export function shouldAutoCloseTicket(ticket: FaqTicket, now: Date): boolean {
  if (ticket.status !== 'ANSWERED') return false;
  const base = new Date(ticket.answeredAt ?? ticket.updatedAt).getTime();
  if (Number.isNaN(base)) return false;
  return now.getTime() - base > TICKET_AUTO_CLOSE_DAYS * 24 * 60 * 60_000;
}

/** 条目是否对外可见（DRAFT / ARCHIVED 不出现在搜索里） */
export function isArticlePublished(article: Pick<FaqArticle, 'status'>): boolean {
  return article.status === 'PUBLISHED';
}
