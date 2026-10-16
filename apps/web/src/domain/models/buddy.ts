/**
 * 找搭子（buddy）领域模型 —— 纯逻辑，零框架、零 IO（契约 §7）。
 *
 * 规格：`docs/features/buddy-matching.md` §2（领域模型）、§3.2（封闭标签）、§3.3（硬过滤）、§6（隐私）。
 * 契约：§4.1（模块 ID）、§6.1（CRUD 形状）、§11.2（动作名 join/leave/close/decide/feedback）、
 *       §11.10-D（joinedCount 初值 1）、§11.10-E（游标不透明）、§11.10-G（不做约会/交友板块）。
 *
 * 三条**刻意的设计约束**（写在这里，避免后人推翻）：
 * 1. **封闭标签**：`interestTags` / `activityTags` / `post.tags` 只能取自本文件的标签表，
 *    自由文本一律 `VALIDATION_FAILED`。理由见规格 §3.2 —— 自由文本的"共同兴趣"靠字符串
 *    精确相等，`"羽毛球"` / `"打羽毛球"` / `"badminton"` 互不匹配，匹配特征直接失效。
 * 2. **板块由 activity 派生**，不新增 `section` 字段（规格 §2.3）：同一信息两处存储必然漂移。
 * 3. **不采集性别用于打分**（规格 §1.2 N5）：`genderPreference` 只是发起人的**准入约束**，
 *    它不进匹配特征、不进向量；`genderCompatible()` 是唯一的用法。
 */
import { overlapsAvailability, type AvailabilitySlot } from '@kedaya/shared';
import { BUDDY_TAGS, CAMPUS_LOCATION_DEFS } from '@kedaya/contracts';

/* ------------------------------------------------------------------ *
 * 枚举与文案
 * ------------------------------------------------------------------ */

export type BuddySection = 'academic' | 'daily' | 'sport';

export type BuddyActivity = 'sport' | 'study' | 'meal' | 'travel' | 'game' | 'other';

export type BuddyPostStatus = 'OPEN' | 'FULL' | 'CLOSED' | 'EXPIRED' | 'CANCELLED';

export type BuddyApplicationStatus = 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'WITHDRAWN';

export type BuddyGenderPreference = 'any' | 'same' | 'other';

export type BuddyGender = 'male' | 'female' | 'unspecified';

export type BuddySkillLevel = 'beginner' | 'casual' | 'regular' | 'competitive';

export type BuddyFeedbackAction = 'like' | 'dislike' | 'skip';

/** 三个板块（契约 §11.10-G：**只有这三个**，不实现约会/交友板块） */
export const BUDDY_SECTIONS: readonly BuddySection[] = ['academic', 'daily', 'sport'];

export const BUDDY_SECTION_LABELS: Record<BuddySection, string> = {
  academic: '自习与学术',
  daily: '日常与出行',
  sport: '运动组队',
};

export const BUDDY_SECTION_DESCRIPTIONS: Record<BuddySection, string> = {
  academic: '自习、备考、小组作业 —— 需要坐得住的人。',
  daily: '吃饭、出行、杂事 —— 顺手就能一起做的事。',
  sport: '球类、跑步、健身 —— 需要凑够人数的活动。',
};

export const BUDDY_ACTIVITIES: readonly BuddyActivity[] = [
  'sport',
  'study',
  'meal',
  'travel',
  'game',
  'other',
];

export const BUDDY_ACTIVITY_LABELS: Record<BuddyActivity, string> = {
  sport: '运动',
  study: '自习',
  meal: '吃饭',
  travel: '出行',
  game: '游戏 / 桌游',
  other: '其他',
};

export const BUDDY_POST_STATUS_LABELS: Record<BuddyPostStatus, string> = {
  OPEN: '招募中',
  FULL: '已满员',
  CLOSED: '已关闭',
  EXPIRED: '已过期',
  CANCELLED: '已取消',
};

export const BUDDY_APPLICATION_STATUS_LABELS: Record<BuddyApplicationStatus, string> = {
  PENDING: '待审批',
  ACCEPTED: '已通过',
  REJECTED: '未通过',
  WITHDRAWN: '已撤回',
};

export const BUDDY_GENDER_PREFERENCE_LABELS: Record<BuddyGenderPreference, string> = {
  any: '不限性别',
  same: '仅同性',
  other: '仅异性',
};

export const BUDDY_GENDER_LABELS: Record<BuddyGender, string> = {
  male: '男',
  female: '女',
  unspecified: '未填写',
};

export const BUDDY_SKILL_LEVELS: readonly BuddySkillLevel[] = [
  'beginner',
  'casual',
  'regular',
  'competitive',
];

export const BUDDY_SKILL_LEVEL_LABELS: Record<BuddySkillLevel, string> = {
  beginner: '入门',
  casual: '休闲',
  regular: '规律',
  competitive: '竞技',
};

export const BUDDY_FEEDBACK_ACTION_LABELS: Record<BuddyFeedbackAction, string> = {
  like: '感兴趣',
  dislike: '不感兴趣',
  skip: '先跳过',
};

/** 面板筛选用的「全部板块」哨兵值（不参与领域校验） */
export const BUDDY_SECTION_ALL = 'all' as const;
export type BuddySectionFilter = BuddySection | typeof BUDDY_SECTION_ALL;

/* ------------------------------------------------------------------ *
 * 板块派生（规格 §2.3：section 由 activity 派生，不单独存储）
 * ------------------------------------------------------------------ */

const ACTIVITY_TO_SECTION: Record<BuddyActivity, BuddySection> = {
  study: 'academic',
  meal: 'daily',
  travel: 'daily',
  other: 'daily',
  sport: 'sport',
  game: 'sport',
};

/** `study → academic`；`meal/travel/other → daily`；`sport/game → sport`（验收 T2） */
export function sectionOf(activity: BuddyActivity): BuddySection {
  return ACTIVITY_TO_SECTION[activity];
}

/** 某板块包含哪些 activity（用于筛选） */
export function activitiesOf(section: BuddySection): BuddyActivity[] {
  return BUDDY_ACTIVITIES.filter((activity) => sectionOf(activity) === section);
}

export function isBuddySection(value: unknown): value is BuddySection {
  return typeof value === 'string' && (BUDDY_SECTIONS as readonly string[]).includes(value);
}

export function isBuddyActivity(value: unknown): value is BuddyActivity {
  return typeof value === 'string' && (BUDDY_ACTIVITIES as readonly string[]).includes(value);
}

/* ------------------------------------------------------------------ *
 * 封闭标签表（规格 §3.2）
 * ------------------------------------------------------------------ */

export type BuddyTagGroup = 'sport' | 'study' | 'meal' | 'travel' | 'interest';

export interface BuddyTagDef {
  /** 机器值，进匹配特征；**不得**在 UI 上展示为自由文本 */
  key: string;
  /** 中文显示名 */
  label: string;
  group: BuddyTagGroup;
  /** 别名词表，**仅用于搜索**，不用于匹配（规格 §3.2） */
  aliases: readonly string[];
  /** 下架标签不删除（历史数据仍引用），但不再可选 */
  isActive: boolean;
}

export const BUDDY_TAG_GROUPS: readonly BuddyTagGroup[] = [
  'sport',
  'study',
  'meal',
  'travel',
  'interest',
];

export const BUDDY_TAG_GROUP_LABELS: Record<BuddyTagGroup, string> = {
  sport: '运动',
  study: '学习',
  meal: '吃饭',
  travel: '出行',
  interest: '兴趣',
};

/**
 * 标签白名单 —— **来自唯一真相 `@kedaya/contracts`**。
 *
 * ⚠️ 这里**不再自己维护数据**。收敛前 Web 端自拟了 46 条，与服务端权威表的 62 条
 * 互不相同，后果是 **Web 用户选到的 23 个标签会被后端 `UNKNOWN_TAG` 拒**；
 * 而且那份表还把 `lab`/`metro`/`north-gate`/`lake-side` 这类**校园地点**
 * 混进了**标签**表（地点属于 `CAMPUS_LOCATIONS`，是另一个概念）。
 *
 * 根因不是"某端少写了几条"，而是**没有唯一真相** —— 所以修法是收敛到一处，
 * 而不是把 Web 补成 62 条（那样下次加标签还会漂移）。
 *
 * 规格 §3.2：标签表变更必须走 migration + 审计，**不得运行时改**（否则历史匹配不可复现）。
 */
export const BUDDY_TAG_TABLE: readonly BuddyTagDef[] = BUDDY_TAGS.map((tag) => ({
  key: tag.key,
  label: tag.label,
  group: tag.group,
  aliases: tag.aliases ?? [],
  // 唯一真相里 `isActive` 缺省即"上架"
  isActive: tag.isActive !== false,
}));

const TAG_BY_KEY = new Map(BUDDY_TAG_TABLE.map((tag) => [tag.key, tag]));

/** 可选标签（`isActive` 为 false 的下架标签不在其中） */
export const BUDDY_ACTIVE_TAGS: readonly BuddyTagDef[] = BUDDY_TAG_TABLE.filter((t) => t.isActive);

/** 全部标签 key（含已下架）—— 历史数据的合法性判定用这个 */
export const BUDDY_TAG_KEYS: readonly string[] = BUDDY_TAG_TABLE.map((t) => t.key);

/** 当前可选标签 key */
export const BUDDY_ACTIVE_TAG_KEYS: readonly string[] = BUDDY_ACTIVE_TAGS.map((t) => t.key);

export function findTag(key: string): BuddyTagDef | undefined {
  return TAG_BY_KEY.get(key);
}

/** 标签 key 是否登记在册（**含已下架** —— 历史数据不能因为下架就变非法） */
export function isKnownTag(key: string): boolean {
  return TAG_BY_KEY.has(key);
}

/** 标签 key 当前是否可选 */
export function isSelectableTag(key: string): boolean {
  return TAG_BY_KEY.get(key)?.isActive === true;
}

/** 标签显示名；未登记时回退为 key 本身（**不猜**中文） */
export function tagLabel(key: string): string {
  return TAG_BY_KEY.get(key)?.label ?? key;
}

export function tagsOfGroup(group: BuddyTagGroup): BuddyTagDef[] {
  return BUDDY_ACTIVE_TAGS.filter((tag) => tag.group === group);
}

/** 按别名 / 显示名 / key 搜索（规格 §3.2：别名仅用于搜索） */
export function searchTags(keyword: string): BuddyTagDef[] {
  const q = keyword.trim().toLowerCase();
  if (!q) return [...BUDDY_ACTIVE_TAGS];
  return BUDDY_ACTIVE_TAGS.filter(
    (tag) =>
      tag.key.toLowerCase().includes(q) ||
      tag.label.toLowerCase().includes(q) ||
      tag.aliases.some((alias) => alias.toLowerCase().includes(q)),
  );
}

/** 去重并保持首次出现顺序（不改变用户选择顺序，便于 UI 稳定） */
export function dedupeTags(tags: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tag of tags) {
    if (seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
  }
  return out;
}

/** 批量转显示名（UI 只渲染这个，不自己查表） */
export function tagLabels(tags: readonly string[]): string[] {
  return tags.map(tagLabel);
}

/* ------------------------------------------------------------------ *
 * 校园地点白名单（规格 §6.4 / 未决问题 U10）
 * ------------------------------------------------------------------ */

export interface BuddyLocationDef {
  key: string;
  label: string;
}

/**
 * 校园地点白名单 —— **来自唯一真相 `@kedaya/contracts` 的 `CAMPUS_LOCATION_DEFS`**。
 *
 * ⚠️ 收敛前本端自己维护了 15 个**英文 slug**（`gym`/`stadium`/`north-gate`…），
 * 而服务端白名单是 25 个**中文名**（`体育馆`/`田径场`/`校门口`…）——
 * 两个命名空间**完全不相交**：Web 用户选的任何地点，服务端都会判为不在白名单。
 * 这与标签表漂移是同一类 bug（用户提交被拒），根因同样是没有唯一真相。
 *
 * ⚠️ **`label` 才是提交给服务端的值**；`key` 只用于埋点/i18n/URL。
 * ⚠️ 规格未决问题 U10：这份清单**仍是占位**，需要产品 + 运营给权威版本。
 */
export const BUDDY_LOCATIONS: readonly BuddyLocationDef[] = CAMPUS_LOCATION_DEFS.map((d) => ({
  key: d.key,
  label: d.label,
}));

/**
 * ⚠️ **按 `label`（中文名）索引，不是按 `key`（英文 slug）** —— 因为
 * `label` 才是提交给服务端的**上线值**，服务端白名单校验的就是中文名。
 * 收敛前这里按 slug 索引，于是"用户选 `体育馆`"会被本端判为不在清单里，
 * 而"用户选 `gym`"会被本端放行、却被服务端拒 —— **两头都不对**。
 */
const LOCATION_BY_LABEL = new Map(BUDDY_LOCATIONS.map((l) => [l.label, l]));

/** 可提交的地点值（**中文名**，即上线值）。UI 的下拉/选项应当用这个。 */
export const BUDDY_LOCATION_KEYS: readonly string[] = BUDDY_LOCATIONS.map((l) => l.label);

export function isKnownLocation(value: string): boolean {
  // 去首尾空白后按**中文名**判定（地点是人工输入/选择，容错空白是合理的）
  return LOCATION_BY_LABEL.has(value.trim());
}

/**
 * 地点 → 显示名。
 * ⚠️ 因为**上线值就是中文名**，所以这基本是恒等函数 —— 保留它是为了让
 * 将来"上线值改为 slug"时只需改这一个函数，而不必去追所有调用点。
 * 未知值原样返回（不抛错、不返回 undefined）。
 */
export function locationLabel(value: string): string {
  return LOCATION_BY_LABEL.get(value.trim())?.label ?? value;
}

export function locationLabels(values: readonly string[]): string[] {
  return values.map(locationLabel);
}

/* ------------------------------------------------------------------ *
 * 院系（`department` 是唯一与 profile 模块重叠的字段，规格 §2.2）
 * ------------------------------------------------------------------ */

/** 院系建议清单。`department` 规格上只约束 ≤64 字，这里给的是 UI 下拉建议值。 */
export const BUDDY_DEPARTMENTS: readonly string[] = [
  '信息科学与技术学院',
  '物质科学与技术学院',
  '生命科学与技术学院',
  '数学科学研究所',
  '创业与管理学院',
  '生物医学工程学院',
  '创意与艺术学院',
  '人文科学研究院',
  '免疫化学研究所',
  '通识教育中心',
  '其他',
];

export const BUDDY_DEPARTMENT_MAX_LENGTH = 64;
export const BUDDY_BIO_MAX_LENGTH = 200;
export const BUDDY_TITLE_MAX_LENGTH = 60;
export const BUDDY_DESCRIPTION_MAX_LENGTH = 1000;
export const BUDDY_APPLICATION_MESSAGE_MAX_LENGTH = 200;

export const BUDDY_CAPACITY_MIN = 2;
export const BUDDY_CAPACITY_MAX = 20;
export const BUDDY_DURATION_MIN = 30;
export const BUDDY_DURATION_MAX = 480;

export const BUDDY_MAX_INTEREST_TAGS = 20;
export const BUDDY_MAX_ACTIVITY_TAGS = 10;
export const BUDDY_MAX_POST_TAGS = 8;
export const BUDDY_MAX_PREFERRED_AREAS = 5;
export const BUDDY_TAG_LABEL_MAX_LENGTH = 24;

/* ------------------------------------------------------------------ *
 * 状态机（契约 §2.3 冻结；本文件**不改动**）
 * ------------------------------------------------------------------ */

/**
 * `BuddyPost` 状态机。逐字对应规格 §2.8 的状态图：
 *
 * ```
 * OPEN  → FULL | CLOSED | EXPIRED | CANCELLED
 * FULL  → OPEN | CLOSED | EXPIRED
 * CLOSED / EXPIRED / CANCELLED → （终态）
 * ```
 *
 * 说明：`FULL → OPEN` 是"有人退出"；`FULL` **没有** `CANCELLED` 分支 ——
 * 这不是遗漏，是规格图里就没有，本实现**不擅自扩边**（扩了就等于改冻结状态机）。
 * 取消（`CANCELLED`）由 `DELETE /items/:id` 触发，与 `close`（→ `CLOSED`）语义不同（规格 §5.2）。
 */
const POST_TRANSITIONS: Record<BuddyPostStatus, readonly BuddyPostStatus[]> = {
  OPEN: ['FULL', 'CLOSED', 'EXPIRED', 'CANCELLED'],
  FULL: ['OPEN', 'CLOSED', 'EXPIRED'],
  CLOSED: [],
  EXPIRED: [],
  CANCELLED: [],
};

export const BUDDY_POST_STATUSES: readonly BuddyPostStatus[] = [
  'OPEN',
  'FULL',
  'CLOSED',
  'EXPIRED',
  'CANCELLED',
];

export function canTransitionPost(from: BuddyPostStatus, to: BuddyPostStatus): boolean {
  return POST_TRANSITIONS[from].includes(to);
}

/**
 * `BuddyApplication` 状态机（规格 §2.8）。
 * `WITHDRAWN → PENDING` 是为 `@@unique([postId, applicantId])` 服务的：
 * 撤回后想再申请，**复用同一行**而不是插新行。
 */
const APPLICATION_TRANSITIONS: Record<
  BuddyApplicationStatus,
  readonly BuddyApplicationStatus[]
> = {
  PENDING: ['ACCEPTED', 'REJECTED', 'WITHDRAWN'],
  WITHDRAWN: ['PENDING'],
  ACCEPTED: [],
  REJECTED: [],
};

export const BUDDY_APPLICATION_STATUSES: readonly BuddyApplicationStatus[] = [
  'PENDING',
  'ACCEPTED',
  'REJECTED',
  'WITHDRAWN',
];

export function canTransitionApplication(
  from: BuddyApplicationStatus,
  to: BuddyApplicationStatus,
): boolean {
  return APPLICATION_TRANSITIONS[from].includes(to);
}

/* ------------------------------------------------------------------ *
 * 实体
 * ------------------------------------------------------------------ */

export interface BuddyPostCreator {
  id: string;
  nickname: string;
  avatarUrl: string | null;
}

/**
 * `BuddyPost`（契约 §2.3 冻结字段 + 规格 §2.3 新增可选字段）。
 *
 * ⚠️ **没有 `section` 字段**：板块由 `sectionOf(activity)` 派生（规格 §2.3）。
 * ⚠️ **没有联系方式字段**：联系方式只在申请被接受后经 `notifications` 交换（规格 §6.2）。
 */
export interface BuddyPost {
  id: string;
  activity: BuddyActivity;
  status: BuddyPostStatus;
  title: string;
  description: string | null;
  /** 校园地点白名单的 key */
  location: string;
  /** ISO-8601 UTC */
  startsAt: string;
  durationMin: number;
  /** 含发起人的总人数（契约 §11.10-D：初值 1，capacity ≥ 2） */
  capacity: number;
  joinedCount: number;
  genderPreference: BuddyGenderPreference;
  /** 仅 sport；作为**硬过滤**而不是打分（规格 §3.3 F6） */
  minSkillLevel: BuddySkillLevel | null;
  tags: string[];
  creator: BuddyPostCreator;
  createdAt: string;
  autoCloseAt: string | null;
}

export interface BuddyApplication {
  id: string;
  postId: string;
  applicantId: string;
  applicantNickname: string;
  status: BuddyApplicationStatus;
  message: string | null;
  createdAt: string;
  decidedAt: string | null;
  /** 必须等于 `post.creatorId`（规格 §2.4） */
  decidedBy: string | null;
}

export interface BuddyAvailabilitySlot {
  /** 0=周日 … 6=周六（与 JS `getDay()` 一致） */
  dow: number;
  /** 当日内分钟，0–1439 */
  startMin: number;
  /** 当日内分钟，0–1439；**小于 `startMin` 表示跨零点到次日** */
  endMin: number;
}

/**
 * `BuddyProfile`（规格 §2.2）。
 * 与 `profile` 模块的 `User` 资料分离：`profile` 存"我是谁"，这里只存"匹配要用的特征"。
 * 撤回匹配只需删这一行，不影响账号资料。
 */
export interface BuddyProfile {
  userId: string;
  sections: BuddySection[];
  interestTags: string[];
  activityTags: string[];
  skillLevel: BuddySkillLevel;
  availability: BuddyAvailabilitySlot[];
  /** 常去区域（校园地点 key），**不是**精确坐标 */
  preferredAreas: string[];
  department: string | null;
  bio: string | null;
  /** **默认关闭**：不主动开启就不进推荐池（规格 §2.2 / §6.3） */
  matchEnabled: boolean;
  updatedAt: string;
}

export interface BuddyMatchFeedback {
  userId: string;
  targetPostId: string;
  section: BuddySection;
  action: BuddyFeedbackAction;
  createdAt: string;
}

/** 参与匹配的用户特征（只含算法要用的字段，规格 §6.3 最小化采集） */
export interface BuddyMatchSubject {
  department: string | null;
  interestTags: string[];
  activityTags: string[];
  preferredAreas: string[];
  skillLevel: BuddySkillLevel | null;
}

/* ------------------------------------------------------------------ *
 * 派生量
 * ------------------------------------------------------------------ */

/** 剩余名额（含发起人的总人数口径） */
export function remainingSlots(post: Pick<BuddyPost, 'capacity' | 'joinedCount'>): number {
  return Math.max(0, post.capacity - post.joinedCount);
}

/** 进度百分比（0–100 整数） */
export function progressPercent(post: Pick<BuddyPost, 'capacity' | 'joinedCount'>): number {
  if (post.capacity <= 0) return 0;
  const raw = Math.round((post.joinedCount / post.capacity) * 100);
  return Math.min(100, Math.max(0, raw));
}

/** 活动是否已开始（`startsAt` 已过） */
export function hasStarted(post: Pick<BuddyPost, 'startsAt'>, now: Date): boolean {
  const at = new Date(post.startsAt).getTime();
  if (Number.isNaN(at)) return true;
  return at <= now.getTime();
}

/** 硬过滤 F1+F2：还能不能被申请（`join` 的前置） */
export function isPostJoinable(
  post: Pick<BuddyPost, 'status' | 'capacity' | 'joinedCount' | 'startsAt'>,
  now: Date,
): boolean {
  if (post.status !== 'OPEN') return false;
  if (remainingSlots(post) <= 0) return false;
  return !hasStarted(post, now);
}

/**
 * 申请不可提交的原因（`null` = 可以申请）。
 * 与规格 §5.5 的 `details.reason` 一一对应，UI 直接展示这个中文。
 */
export function joinBlockedReason(
  post: Pick<BuddyPost, 'status' | 'capacity' | 'joinedCount' | 'startsAt'> & {
    creator: BuddyPostCreator;
  },
  viewerId: string,
  now: Date,
): string | null {
  if (post.creator.id === viewerId) return '不能申请自己发布的活动';
  // 先看名额：状态为 FULL 时「名额已满」比「状态为已满员，不能申请」更直白
  if (remainingSlots(post) <= 0) return '名额已满';
  if (post.status !== 'OPEN') return `活动当前状态为「${BUDDY_POST_STATUS_LABELS[post.status]}」，不能申请`;
  if (hasStarted(post, now)) return '活动已开始';
  return null;
}

/* ------------------------------------------------------------------ *
 * 准入约束（F5 / F6）—— 性别只做准入，不进打分（规格 §1.2 N5）
 * ------------------------------------------------------------------ */

/**
 * 性别准入是否相容。
 *
 * ⚠️ 诚实说明：性别是 `profile` 模块的字段，本端只有演示会话里的占位值。
 * 任一方为 `unspecified` 时**返回 true**（"无法判定"不等于"不相容"）——
 * 猜一个性别去拦人，比不拦更糟。
 */
export function genderCompatible(
  preference: BuddyGenderPreference,
  creatorGender: BuddyGender,
  viewerGender: BuddyGender,
): boolean {
  if (preference === 'any') return true;
  if (creatorGender === 'unspecified' || viewerGender === 'unspecified') return true;
  if (preference === 'same') return creatorGender === viewerGender;
  return creatorGender !== viewerGender;
}

export function genderMismatchReason(preference: BuddyGenderPreference): string {
  return preference === 'same' ? '该活动仅限发起人同性参加' : '该活动仅限发起人异性参加';
}

const SKILL_RANK: Record<BuddySkillLevel, number> = {
  beginner: 0,
  casual: 1,
  regular: 2,
  competitive: 3,
};

/** 技能等级序（越小越初级）；用于 F6 硬过滤 */
export function skillRank(level: BuddySkillLevel): number {
  return SKILL_RANK[level];
}

/** F6：`minSkillLevel` 存在时，我的水平必须 ≥ 它 */
export function meetsMinSkillLevel(
  viewerSkill: BuddySkillLevel | null,
  minSkill: BuddySkillLevel | null,
): boolean {
  if (!minSkill) return true;
  if (!viewerSkill) return true; // 未填写 → 不拦（不猜）
  return skillRank(viewerSkill) >= skillRank(minSkill);
}

export function skillTooLowReason(minSkill: BuddySkillLevel): string {
  return `该活动要求${BUDDY_SKILL_LEVEL_LABELS[minSkill]}及以上水平`;
}

/* ------------------------------------------------------------------ *
 * 可用时段（规格 §2.2 / §3.3 F7）—— **支持跨零点**
 * ------------------------------------------------------------------ */

export function isIntegerInRange(value: unknown, min: number, max: number): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

/**
 * 时段长度（分钟）。
 * `endMin > startMin` 时是当天长度；`endMin < startMin` 时按**跨零点到次日**计算
 * （与 `@kedaya/shared` 的 `overlapsAvailabilityMinutes` 同一套语义）。
 */
export function slotLengthMinutes(slot: BuddyAvailabilitySlot): number {
  return slot.endMin > slot.startMin
    ? slot.endMin - slot.startMin
    : 1440 - slot.startMin + slot.endMin;
}

/** 是否跨零点（`endMin` 小于 `startMin`） */
export function isCrossMidnight(slot: BuddyAvailabilitySlot): boolean {
  return slot.endMin < slot.startMin;
}

/** 分钟数 → `HH:MM`（0–1439） */
export function minutesToHHMM(totalMin: number): string {
  const normalized = ((Math.trunc(totalMin) % 1440) + 1440) % 1440;
  const hh = String(Math.floor(normalized / 60)).padStart(2, '0');
  const mm = String(normalized % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

/** `HH:MM` → 分钟数；非法返回 `null`（**不猜** 0） */
export function hhmmToMinutes(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hh = Number(match[1]);
  const mm = Number(match[2]);
  if (!Number.isInteger(hh) || !Number.isInteger(mm)) return null;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return hh * 60 + mm;
}

export const BUDDY_WEEKDAY_LABELS: readonly string[] = [
  '周日',
  '周一',
  '周二',
  '周三',
  '周四',
  '周五',
  '周六',
];

export function weekdayLabel(dow: number): string {
  return BUDDY_WEEKDAY_LABELS[dow] ?? `第 ${dow} 天`;
}

/** `周一 08:00–10:00`；跨零点追加「次日」前缀 */
export function formatAvailabilitySlot(slot: BuddyAvailabilitySlot): string {
  const start = minutesToHHMM(slot.startMin);
  const end = minutesToHHMM(slot.endMin);
  return `${weekdayLabel(slot.dow)} ${start}–${isCrossMidnight(slot) ? '次日 ' : ''}${end}`;
}

export function describeAvailability(slots: readonly BuddyAvailabilitySlot[]): string {
  if (slots.length === 0) return '未设置可用时段（不会被推荐，也不会被时间过滤掉）';
  const crossCount = slots.filter(isCrossMidnight).length;
  const totalMinutes = slots.reduce((sum, slot) => sum + slotLengthMinutes(slot), 0);
  const hours = Math.round((totalMinutes / 60) * 10) / 10;
  return `每周 ${slots.length} 段 · 共约 ${hours} 小时${crossCount > 0 ? ` · ${crossCount} 段跨零点` : ''}`;
}

/** 转成 `@kedaya/shared` 的 `AvailabilitySlot`（形状一致，显式映射以免将来漂移） */
export function toSharedSlots(slots: readonly BuddyAvailabilitySlot[]): AvailabilitySlot[] {
  return slots.map((slot) => ({ dow: slot.dow, startMin: slot.startMin, endMin: slot.endMin }));
}

/**
 * 活动时间窗是否与我的可用时段有交集（规格 §3.3 F7）。
 * 时区换算与跨零点处理都在 `@kedaya/shared` 里 —— **本端不重写算法**。
 */
export function availabilityOverlapsPost(
  slots: readonly BuddyAvailabilitySlot[],
  post: Pick<BuddyPost, 'startsAt' | 'durationMin'>,
  tz = 'Asia/Shanghai',
): boolean {
  const startsAt = new Date(post.startsAt);
  if (Number.isNaN(startsAt.getTime())) return false;
  return overlapsAvailability(toSharedSlots(slots), startsAt, post.durationMin, tz);
}

/* ------------------------------------------------------------------ *
 * 校验（纯函数 —— 前端预校验，权威校验仍在服务端）
 * ------------------------------------------------------------------ */

/** 契约错误码 + `details.reason`（规格 §5.4 / §5.5 冻结值） */
export const BUDDY_REASONS = {
  INVALID_TITLE: 'INVALID_TITLE',
  INVALID_DESCRIPTION: 'INVALID_DESCRIPTION',
  CONTACT_INFO_IN_DESCRIPTION: 'CONTACT_INFO_IN_DESCRIPTION',
  UNKNOWN_LOCATION: 'UNKNOWN_LOCATION',
  INVALID_STARTS_AT: 'INVALID_STARTS_AT',
  INVALID_DURATION: 'INVALID_DURATION',
  INVALID_CAPACITY: 'INVALID_CAPACITY',
  INVALID_ACTIVITY: 'INVALID_ACTIVITY',
  INVALID_GENDER_PREFERENCE: 'INVALID_GENDER_PREFERENCE',
  INVALID_SKILL_LEVEL: 'INVALID_SKILL_LEVEL',
  TOO_MANY_TAGS: 'TOO_MANY_TAGS',
  UNKNOWN_TAG: 'UNKNOWN_TAG',
  TOO_MANY_INTERESTS: 'TOO_MANY_INTERESTS',
  TOO_MANY_ACTIVITIES: 'TOO_MANY_ACTIVITIES',
  TOO_MANY_AREAS: 'TOO_MANY_AREAS',
  NO_SECTION: 'NO_SECTION',
  INVALID_AVAILABILITY: 'INVALID_AVAILABILITY',
  INVALID_DEPARTMENT: 'INVALID_DEPARTMENT',
  INVALID_BIO: 'INVALID_BIO',
  IDEMPOTENCY_KEY_REQUIRED: 'IDEMPOTENCY_KEY_REQUIRED',
  INVALID_CURSOR: 'INVALID_CURSOR',
  POST_FULL: 'POST_FULL',
  POST_NOT_OPEN: 'POST_NOT_OPEN',
  ALREADY_APPLIED: 'ALREADY_APPLIED',
  CANNOT_JOIN_OWN_POST: 'CANNOT_JOIN_OWN_POST',
  GENDER_PREFERENCE_MISMATCH: 'GENDER_PREFERENCE_MISMATCH',
  SKILL_LEVEL_TOO_LOW: 'SKILL_LEVEL_TOO_LOW',
  NOT_CREATOR: 'NOT_CREATOR',
  APPLICATION_NOT_PENDING: 'APPLICATION_NOT_PENDING',
} as const;

export interface BuddyDraftProblem {
  /** 表单字段名（UI 定位用） */
  field: string;
  /** 契约 `details.reason` */
  reason: string;
  /** 中文文案 */
  message: string;
}

export interface BuddyPostDraft {
  activity: BuddyActivity;
  title: string;
  description: string;
  location: string;
  startsAt: string;
  durationMin: number;
  capacity: number;
  genderPreference: BuddyGenderPreference;
  tags: string[];
  minSkillLevel: BuddySkillLevel | null;
}

export function emptyBuddyPostDraft(): BuddyPostDraft {
  return {
    activity: 'study',
    title: '',
    description: '',
    location: '图书馆',
    startsAt: '',
    durationMin: 120,
    capacity: 4,
    genderPreference: 'any',
    tags: [],
    minSkillLevel: null,
  };
}

/**
 * 联系方式模式检测（规格 §6.4）。
 * 命中即 `VALIDATION_FAILED` / `CONTACT_INFO_IN_DESCRIPTION` —— 联系方式放进公开正文
 * 会被爬取，正确路径是"申请通过后经站内信交换"（规格 §6.2）。
 */
export interface ContactInfoHit {
  kind: 'mobile' | 'wechat' | 'qq' | 'email';
  message: string;
}

const CONTACT_PATTERNS: readonly { kind: ContactInfoHit['kind']; pattern: RegExp; message: string }[] =
  [
    {
      kind: 'mobile',
      pattern: /(?:^|[^\d])1[3-9]\d{9}(?:[^\d]|$)/,
      message: '正文里不能写手机号：申请通过后系统会经站内信交换联系方式。',
    },
    {
      kind: 'wechat',
      pattern: /(微信|weixin|wechat|vx|v\s?信)\s*[:：]?\s*[A-Za-z0-9_-]{4,}/i,
      message: '正文里不能写微信号：申请通过后系统会经站内信交换联系方式。',
    },
    {
      kind: 'qq',
      pattern: /(qq|扣扣)\s*[:：]?\s*\d{5,12}/i,
      message: '正文里不能写 QQ 号：申请通过后系统会经站内信交换联系方式。',
    },
    {
      kind: 'email',
      pattern: /[\w.+-]+@[\w-]+\.[\w.]+/,
      message: '正文里不能写邮箱：申请通过后系统会经站内信交换联系方式。',
    },
  ];

export function detectContactInfo(text: string): ContactInfoHit | null {
  for (const { kind, pattern, message } of CONTACT_PATTERNS) {
    if (pattern.test(text)) return { kind, message };
  }
  return null;
}

/** 标签选择校验（封闭标签的**唯一**入口） */
export function validateTagSelection(
  tags: readonly string[],
  options: { max: number; field: string; tooManyReason: string; allowRetired?: boolean },
): BuddyDraftProblem[] {
  const problems: BuddyDraftProblem[] = [];
  const unique = dedupeTags(tags);

  if (unique.length > options.max) {
    problems.push({
      field: options.field,
      reason: options.tooManyReason,
      message: `最多选择 ${options.max} 个标签，当前选了 ${unique.length} 个。`,
    });
  }

  for (const tag of unique) {
    const known = options.allowRetired ? isKnownTag(tag) : isSelectableTag(tag);
    if (!known) {
      problems.push({
        field: options.field,
        reason: `${BUDDY_REASONS.UNKNOWN_TAG}:${tag}`,
        message: `「${tag}」不在可选标签表里。标签只能从列表中选择 —— 自由文本会让"共同兴趣"匹配失效。`,
      });
    }
  }

  return problems;
}

export function validateBuddyPostDraft(
  draft: BuddyPostDraft,
  options: { now: Date },
): BuddyDraftProblem[] {
  const problems: BuddyDraftProblem[] = [];

  const title = draft.title.trim();
  if (title.length === 0 || title.length > BUDDY_TITLE_MAX_LENGTH) {
    problems.push({
      field: 'title',
      reason: BUDDY_REASONS.INVALID_TITLE,
      message: `标题需要 1–${BUDDY_TITLE_MAX_LENGTH} 个字。`,
    });
  }

  if (!isBuddyActivity(draft.activity)) {
    problems.push({
      field: 'activity',
      reason: BUDDY_REASONS.INVALID_ACTIVITY,
      message: '活动类型不在允许的 6 种之内。',
    });
  }

  if (draft.description.length > BUDDY_DESCRIPTION_MAX_LENGTH) {
    problems.push({
      field: 'description',
      reason: BUDDY_REASONS.INVALID_DESCRIPTION,
      message: `描述不能超过 ${BUDDY_DESCRIPTION_MAX_LENGTH} 个字。`,
    });
  } else {
    const hit = detectContactInfo(draft.description);
    if (hit) {
      problems.push({
        field: 'description',
        reason: BUDDY_REASONS.CONTACT_INFO_IN_DESCRIPTION,
        message: hit.message,
      });
    }
  }

  if (!isKnownLocation(draft.location)) {
    problems.push({
      field: 'location',
      reason: BUDDY_REASONS.UNKNOWN_LOCATION,
      message: '地点必须从校园地点清单里选择。',
    });
  }

  const startsAt = new Date(draft.startsAt);
  if (!draft.startsAt || Number.isNaN(startsAt.getTime()) || startsAt.getTime() <= options.now.getTime()) {
    problems.push({
      field: 'startsAt',
      reason: BUDDY_REASONS.INVALID_STARTS_AT,
      message: '开始时间必须是未来的时间点。',
    });
  }

  if (
    !Number.isInteger(draft.durationMin) ||
    draft.durationMin < BUDDY_DURATION_MIN ||
    draft.durationMin > BUDDY_DURATION_MAX
  ) {
    problems.push({
      field: 'durationMin',
      reason: BUDDY_REASONS.INVALID_DURATION,
      message: `预计时长需要在 ${BUDDY_DURATION_MIN}–${BUDDY_DURATION_MAX} 分钟之间。`,
    });
  }

  if (
    !Number.isInteger(draft.capacity) ||
    draft.capacity < BUDDY_CAPACITY_MIN ||
    draft.capacity > BUDDY_CAPACITY_MAX
  ) {
    problems.push({
      field: 'capacity',
      reason: BUDDY_REASONS.INVALID_CAPACITY,
      message: `人数（含你自己）需要在 ${BUDDY_CAPACITY_MIN}–${BUDDY_CAPACITY_MAX} 之间。`,
    });
  }

  if (!['any', 'same', 'other'].includes(draft.genderPreference)) {
    problems.push({
      field: 'genderPreference',
      reason: BUDDY_REASONS.INVALID_GENDER_PREFERENCE,
      message: '性别偏好只能是 不限 / 仅同性 / 仅异性。',
    });
  }

  const section = isBuddyActivity(draft.activity) ? sectionOf(draft.activity) : null;
  if (draft.minSkillLevel !== null) {
    if (!BUDDY_SKILL_LEVELS.includes(draft.minSkillLevel)) {
      problems.push({
        field: 'minSkillLevel',
        reason: BUDDY_REASONS.INVALID_SKILL_LEVEL,
        message: '运动水平取值非法。',
      });
    } else if (section !== 'sport') {
      problems.push({
        field: 'minSkillLevel',
        reason: BUDDY_REASONS.INVALID_SKILL_LEVEL,
        message: '运动水平门槛只在运动板块生效。',
      });
    }
  }

  problems.push(
    ...validateTagSelection(draft.tags, {
      max: BUDDY_MAX_POST_TAGS,
      field: 'tags',
      tooManyReason: BUDDY_REASONS.TOO_MANY_TAGS,
    }),
  );

  return problems;
}

export interface BuddyProfileDraft {
  sections: BuddySection[];
  interestTags: string[];
  activityTags: string[];
  skillLevel: BuddySkillLevel;
  availability: BuddyAvailabilitySlot[];
  preferredAreas: string[];
  department: string | null;
  bio: string | null;
  matchEnabled: boolean;
}

export function validateAvailabilitySlot(slot: BuddyAvailabilitySlot): BuddyDraftProblem | null {
  if (!isIntegerInRange(slot.dow, 0, 6)) {
    return {
      field: 'availability',
      reason: BUDDY_REASONS.INVALID_AVAILABILITY,
      message: '星期取值必须是 0（周日）到 6（周六）。',
    };
  }
  if (!isIntegerInRange(slot.startMin, 0, 1439) || !isIntegerInRange(slot.endMin, 0, 1439)) {
    return {
      field: 'availability',
      reason: BUDDY_REASONS.INVALID_AVAILABILITY,
      message: '起止时间必须在 00:00–23:59 之间。',
    };
  }
  if (slot.startMin === slot.endMin) {
    return {
      field: 'availability',
      reason: BUDDY_REASONS.INVALID_AVAILABILITY,
      message: `${weekdayLabel(slot.dow)} 的起止时间相同，无法判断是 0 分钟还是一整天，请改成不同的时间。`,
    };
  }
  return null;
}

/**
 * 可用时段校验。
 *
 * ⚠️ **对规格的一处显式扩展**：规格 §2.2 写的是 `endMin > startMin`，
 * 但产品要求"支持跨零点"（例如 23:00–01:00 的夜跑）。
 * 因此这里接受 `endMin < startMin` 并把它解释为**跨零点到次日**，
 * 与 `@kedaya/shared` 的 `overlapsAvailabilityMinutes` 语义完全一致（不重写算法）。
 * 只有 `endMin === startMin` 被拒（0 分钟与 24 小时无法区分）。
 */
export function validateAvailability(
  slots: readonly BuddyAvailabilitySlot[],
): BuddyDraftProblem[] {
  return slots
    .map((slot) => validateAvailabilitySlot(slot))
    .filter((problem): problem is BuddyDraftProblem => problem !== null);
}

export function validateBuddyProfileDraft(draft: BuddyProfileDraft): BuddyDraftProblem[] {
  const problems: BuddyDraftProblem[] = [];

  const sections = dedupeTags(draft.sections);
  if (sections.length === 0) {
    problems.push({
      field: 'sections',
      reason: BUDDY_REASONS.NO_SECTION,
      message: '至少要选择一个板块，否则不会被任何推荐命中。',
    });
  }
  for (const section of sections) {
    if (!isBuddySection(section)) {
      problems.push({
        field: 'sections',
        reason: `${BUDDY_REASONS.INVALID_ACTIVITY}:${section}`,
        message: `未知板块「${section}」。可选板块只有三个。`,
      });
    }
  }

  problems.push(
    ...validateTagSelection(draft.interestTags, {
      max: BUDDY_MAX_INTEREST_TAGS,
      field: 'interestTags',
      tooManyReason: BUDDY_REASONS.TOO_MANY_INTERESTS,
    }),
  );
  for (const tag of dedupeTags(draft.interestTags)) {
    const def = findTag(tag);
    if (def && def.label.length > BUDDY_TAG_LABEL_MAX_LENGTH) {
      problems.push({
        field: 'interestTags',
        reason: `${BUDDY_REASONS.UNKNOWN_TAG}:${tag}`,
        message: `标签「${def.label}」超过 ${BUDDY_TAG_LABEL_MAX_LENGTH} 字。`,
      });
    }
  }

  problems.push(
    ...validateTagSelection(draft.activityTags, {
      max: BUDDY_MAX_ACTIVITY_TAGS,
      field: 'activityTags',
      tooManyReason: BUDDY_REASONS.TOO_MANY_ACTIVITIES,
    }),
  );

  const areas = dedupeTags(draft.preferredAreas);
  if (areas.length > BUDDY_MAX_PREFERRED_AREAS) {
    problems.push({
      field: 'preferredAreas',
      reason: BUDDY_REASONS.TOO_MANY_AREAS,
      message: `常去区域最多选 ${BUDDY_MAX_PREFERRED_AREAS} 个。`,
    });
  }
  for (const area of areas) {
    if (!isKnownLocation(area)) {
      problems.push({
        field: 'preferredAreas',
        reason: `${BUDDY_REASONS.UNKNOWN_LOCATION}:${area}`,
        message: `「${area}」不在校园地点清单里。区域只到地点粒度，不采集精确坐标。`,
      });
    }
  }

  if (!BUDDY_SKILL_LEVELS.includes(draft.skillLevel)) {
    problems.push({
      field: 'skillLevel',
      reason: BUDDY_REASONS.INVALID_SKILL_LEVEL,
      message: '运动水平取值非法。',
    });
  }

  if (draft.department !== null && draft.department.trim().length > BUDDY_DEPARTMENT_MAX_LENGTH) {
    problems.push({
      field: 'department',
      reason: BUDDY_REASONS.INVALID_DEPARTMENT,
      message: `院系不能超过 ${BUDDY_DEPARTMENT_MAX_LENGTH} 个字。`,
    });
  }

  if (draft.bio !== null && draft.bio.length > BUDDY_BIO_MAX_LENGTH) {
    problems.push({
      field: 'bio',
      reason: BUDDY_REASONS.INVALID_BIO,
      message: `一句话自述不能超过 ${BUDDY_BIO_MAX_LENGTH} 个字。`,
    });
  }

  problems.push(...validateAvailability(draft.availability));

  return problems;
}

/* ------------------------------------------------------------------ *
 * 隐私边界（规格 §6）—— 硬要求：哪些公开、怎么换联系方式、资料如何撤回
 * ------------------------------------------------------------------ */

export type BuddyPrivacyVisibility = 'public' | 'algorithm-only' | 'after-accepted' | 'never';

export interface BuddyPrivacyItem {
  topic: string;
  visibility: BuddyPrivacyVisibility;
  detail: string;
}

export const BUDDY_PRIVACY_VISIBILITY_LABELS: Record<BuddyPrivacyVisibility, string> = {
  public: '公开',
  'algorithm-only': '仅算法使用',
  'after-accepted': '申请通过后可见',
  never: '任何人都不可见',
};

/**
 * 可见性矩阵（规格 §6.1）。
 *
 * 关键一条：**`BuddyProfile` 对任何人都不直接可见，包括发帖人** ——
 * 它只被算法使用，输出只有 `score` + 聚合后的 `reason` 短语。
 * 「匹配结果的解释」不等于「资料的泄漏」。
 */
export const BUDDY_PRIVACY_ITEMS: readonly BuddyPrivacyItem[] = [
  {
    topic: '活动标题 / 时间 / 地点 / 人数',
    visibility: 'public',
    detail: '列表页与详情页都可见，未登录也能看 —— 这是招募本身要传达的信息。',
  },
  {
    topic: '活动描述全文',
    visibility: 'public',
    detail: '登录后可见。描述里禁止出现手机号 / 微信号 / QQ / 邮箱，命中会被拦下。',
  },
  {
    topic: '发起人昵称与头像',
    visibility: 'public',
    detail: '只展示昵称与头像，不展示学号、院系、联系方式。',
  },
  {
    topic: '我的匹配资料（兴趣 / 活动标签 / 可用时段 / 常去区域）',
    visibility: 'never',
    detail:
      '对任何人都不直接可见，包括我申请的那个活动的发起人。它只被算法使用，对外只输出聚合理由（如「共同兴趣 3 项」），不输出我的完整标签集。',
  },
  {
    topic: '性别与年龄',
    visibility: 'never',
    detail:
      '匹配不采集性别与年龄，它们也不进向量、不进特征。性别偏好只是发起人的准入约束，用于判断能不能申请。',
  },
  {
    topic: '联系方式（手机 / 微信 / 邮箱）',
    visibility: 'after-accepted',
    detail:
      '不存放在活动上。只有申请被发起人接受后，才通过站内信交换 —— 之前任何人都拿不到。',
  },
  {
    topic: '申请人列表与申请留言',
    visibility: 'after-accepted',
    detail: '只有发起人能看到全部申请；申请人只能看到自己那条。',
  },
  {
    topic: '匹配反馈（感兴趣 / 不感兴趣 / 跳过）',
    visibility: 'never',
    detail:
      '反馈对象是帖子而不是人，按板块隔离，只用于调整我自己的推荐顺序。被反馈的人永远不知道。',
  },
];

/**
 * 面板上的四条硬要求文案（隐私说明组件直接渲染）。
 * ⚠️ 文案里**不要**再写「公开：」这类前缀 —— 组件已经渲染了标签，否则会出现「公开：公开：…」。
 */
export const BUDDY_PRIVACY_SUMMARY = {
  publicNotice: '活动标题、时间、地点、人数、发起人昵称与头像都公开，未登录也能看到。',
  hiddenNotice:
    '你的兴趣标签、可用时段、常去区域、院系与性别都不公开 —— 匹配资料对任何人都不可见，包括活动的发起人。',
  contactExchange:
    '活动正文里禁止写联系方式。只有发起人接受了你的申请，系统才会通过站内信把双方联系方式发给对方。',
  withdrawal:
    '在「我的匹配资料」页可以随时关闭匹配开关（立即从推荐池移除），或删除整份匹配资料（硬删除，含匹配向量）。关闭匹配不影响你已发布的活动与已提交的申请。',
} as const;

/** 列表 / 详情页统一展示的联系方式说明（**不得**声称"完全匿名"） */
export const BUDDY_CONTACT_NOTICE =
  '联系方式不在这里公开：申请被接受后，系统会经站内信把双方的联系方式发给对方。';

/** 匹配资料撤回说明（规格 §6.3） */
export const BUDDY_WITHDRAW_NOTICE =
  '关闭匹配开关后你会立刻从推荐池移除；删除匹配资料会硬删这一行（含匹配向量），不影响账号资料与你发布过的活动。';

/* ------------------------------------------------------------------ *
 * 服务端替身需要的最小「档案」概念
 * ------------------------------------------------------------------ */

export function emptyBuddyProfile(userId: string, now: Date): BuddyProfile {
  return {
    userId,
    sections: [],
    interestTags: [],
    activityTags: [],
    skillLevel: 'casual',
    availability: [],
    preferredAreas: [],
    department: null,
    bio: null,
    matchEnabled: false,
    updatedAt: now.toISOString(),
  };
}

/** 从 profile 抽出匹配特征（`MatchSubject` 形状，喂给 `@kedaya/shared` 的规则分函数） */
export function toMatchSubject(profile: BuddyProfile): BuddyMatchSubject {
  return {
    department: profile.department,
    interestTags: [...profile.interestTags],
    activityTags: [...profile.activityTags],
    preferredAreas: [...profile.preferredAreas],
    skillLevel: profile.skillLevel,
  };
}
