/**
 * 找搭子 · 响应视图与隐私边界（规格 §6.1 可见性矩阵，验收 T26 / T27 / T28）
 *
 * ## 为什么视图要放在 domain 而不是 controller
 *
 * "哪些字段能出网"是**领域规则**（规格 §6.1 是一张矩阵），不是序列化细节。
 * 放在 domain 的好处：它是纯函数，可以被单测穷举断言
 * "任何 `buddy` 响应都不含 gender/age/birthDate/mbti/embedding"（验收 T26）。
 * 如果散在 controller 的 map 里，这条断言就只能靠 code review。
 *
 * ## 可见性矩阵（规格 §6.1，逐行对应）
 *
 * | 数据 | 未登录 | 已登录他人 | 发起人 | 申请人 PENDING | 申请人 ACCEPTED |
 * | 活动列表/标题/时间/地点 | ✅ | ✅ | ✅ | ✅ | ✅ |
 * | 活动 description 全文 | ❌ | ✅ | ✅ | ✅ | ✅ |
 * | 发起人昵称/头像 | ✅ | ✅ | ✅ | ✅ | ✅ |
 * | 发起人**联系方式** | ❌ | ❌ | — | ❌ | ✅ |
 * | 申请人列表 | ❌ | ❌ | ✅ | 仅自己 | 仅自己 |
 * | 申请人 message | ❌ | ❌ | ✅ | 仅自己 | 仅自己 |
 * | `BuddyProfile` | ❌ | ❌ | ❌ | ❌ | ❌ |
 * | `BuddyMatchFeedback` | ❌ | ❌ | ❌ | ❌ | ❌ |
 *
 * > 本模块**所有**端点都要求登录（规格 §5.1），所以矩阵里"未登录"那一列
 * > 由 `AuthGuard` 在更外层拦掉；这里的 `viewerId` 一定有值。
 * > 但视图函数仍然按"可能没有 viewer"来写，避免将来放开匿名读时出现漏洞。
 */

import type { BuddySection } from '@kedaya/shared';
import { sectionOf } from './section';

/* ------------------------------------------------------------------ *
 * 绝不允许出现在任何响应里的字段（验收 T26）
 * ------------------------------------------------------------------ */

/**
 * 禁止出网的字段名。`embedding` 尤其重要：向量可以从相似度**反推**画像内容，
 * 而 `BuddyProfile` 对任何人（含发帖人）都不可见（规格 §6.1）。
 *
 * 本列表被 `views.spec.ts` 用来对每个视图做**递归**扫描 ——
 * 新增视图时不需要记得加断言，只要走 `assertNoForbiddenFields`。
 */
export const FORBIDDEN_RESPONSE_FIELDS: readonly string[] = [
  'gender',
  'age',
  'birthDate',
  'mbti',
  'embedding',
  'embeddingModel',
  'datingPurpose',
  'familyStatus',
  'idealPerson',
];

/** 联系方式字段：只有"申请人已被接受"这一种视角能看到（规格 §6.2） */
export const CONTACT_FIELDS: readonly string[] = ['contact', 'contactInfo', 'phone', 'wechat', 'qq', 'email'];

export interface RecursiveFinding {
  path: string;
  field: string;
}

/**
 * 递归找出对象树里出现的禁用字段。
 *
 * 递归（而不是只看顶层）是必要的：`creator: { gender }` 这种嵌套最容易漏。
 */
export function findForbiddenFields(
  value: unknown,
  forbidden: readonly string[] = FORBIDDEN_RESPONSE_FIELDS,
  path = '$',
): RecursiveFinding[] {
  const findings: RecursiveFinding[] = [];
  const walk = (node: unknown, current: string): void => {
    if (Array.isArray(node)) {
      node.forEach((child, index) => walk(child, `${current}[${index}]`));
      return;
    }
    if (typeof node !== 'object' || node === null) return;
    for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
      if (forbidden.includes(key)) findings.push({ path: `${current}.${key}`, field: key });
      walk(child, `${current}.${key}`);
    }
  };
  walk(value, path);
  return findings;
}

/** 断言：视图中不含任何禁用字段。测试与运行时（开发期）都可调用。 */
export function assertNoForbiddenFields(
  value: unknown,
  forbidden: readonly string[] = FORBIDDEN_RESPONSE_FIELDS,
): void {
  const findings = findForbiddenFields(value, forbidden);
  if (findings.length > 0) {
    throw new Error(
      `buddy 响应里出现了禁止出网的字段：${findings.map((f) => f.path).join(', ')}（规格 §6.1 / 验收 T26）`,
    );
  }
}

/* ------------------------------------------------------------------ *
 * 视图输入（domain 自己的行形状，不 import Prisma）
 * ------------------------------------------------------------------ */

/** 帖子行（视图只需要这些字段；`description` 单独决定给不给） */
export interface PostRow {
  id: string;
  creatorId: string;
  activity: string;
  status: string;
  title: string;
  description: string | null;
  location: string;
  startsAt: Date;
  durationMin: number | null;
  capacity: number;
  joinedCount: number;
  genderPreference: string;
  tags: string[];
  minSkillLevel: string | null;
  createdAt: Date;
}

/** 发起人公开资料。**只有**昵称/头像/院系 —— 不含任何联系方式（规格 §6.1） */
export interface CreatorRow {
  id: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface PostListView {
  id: string;
  activity: string;
  section: BuddySection | null;
  status: string;
  title: string;
  location: string;
  startsAt: string;
  durationMin: number | null;
  capacity: number;
  joinedCount: number;
  genderPreference: string;
  tags: string[];
  minSkillLevel: string | null;
  creator: { id: string; nickname: string; avatarUrl: string | null };
  createdAt: string;
}

export interface PostDetailView extends PostListView {
  /** 详情页才给全文（规格 §5.3 注：列表页只给摘要） */
  description: string | null;
  /** 仅发起人视角为 true；其他人看不到申请人列表（规格 §6.1） */
  isCreator: boolean;
  /** 我自己的申请状态；非申请人 / 未申请时为 null */
  myApplicationStatus: string | null;
}

/**
 * 列表视图。
 *
 * **刻意不含** `description`（规格 §5.3）：
 * 减少一次请求的载荷与爬取面。也**不含**任何联系方式 ——
 * 联系方式只在申请被 `ACCEPTED` 后通过 `notifications` 交换（规格 §6.2）。
 */
export function toPostListView(post: PostRow, creator: CreatorRow): PostListView {
  return {
    id: post.id,
    activity: post.activity,
    section: sectionOf(post.activity),
    status: post.status,
    title: post.title,
    location: post.location,
    startsAt: post.startsAt.toISOString(),
    durationMin: post.durationMin,
    capacity: post.capacity,
    joinedCount: post.joinedCount,
    genderPreference: post.genderPreference,
    tags: [...post.tags],
    minSkillLevel: post.minSkillLevel,
    creator: { id: creator.id, nickname: creator.displayName, avatarUrl: creator.avatarUrl },
    createdAt: post.createdAt.toISOString(),
  };
}

/** 详情视图。`viewerId` 只用于判断 `isCreator` / `myApplicationStatus`，不改变字段集合。 */
export function toPostDetailView(
  post: PostRow,
  creator: CreatorRow,
  viewerId: string | undefined,
  myApplicationStatus: string | null = null,
): PostDetailView {
  return {
    ...toPostListView(post, creator),
    description: post.description,
    isCreator: Boolean(viewerId) && post.creatorId === viewerId,
    myApplicationStatus,
  };
}

/* ------------------------------------------------------------------ *
 * 申请视图（规格 §6.1：申请人列表只给发起人；申请人只能看自己）
 * ------------------------------------------------------------------ */

export interface ApplicationRow {
  id: string;
  postId: string;
  applicantId: string;
  status: string;
  message: string | null;
  decidedAt: Date | null;
  decidedBy: string | null;
  createdAt: Date;
}

export interface ApplicationView {
  id: string;
  postId: string;
  applicantId: string;
  status: string;
  message: string | null;
  decidedAt: string | null;
  createdAt: string;
}

/**
 * 申请视图。
 *
 * ⚠️ 规格 §6.1 要求"申请人 `message`：发起人 ✅ / 申请人仅自己 ✅"。
 * 调用方必须**先**做可见性判定（`canViewApplication`），本函数不做鉴权 ——
 * 视图函数只负责字段集合，鉴权失败必须是 404/403 而不是"返回一个空对象"。
 */
export function toApplicationView(row: ApplicationRow): ApplicationView {
  return {
    id: row.id,
    postId: row.postId,
    applicantId: row.applicantId,
    status: row.status,
    message: row.message,
    decidedAt: row.decidedAt ? row.decidedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * 谁能看这条申请（规格 §6.1）。
 *
 * `NOT_FOUND` 而不区分"不存在/不可见"（api-contract §2.1）：
 * 区分会变成"枚举他人申请 id"的信息泄漏面（规格 §6.4）。
 */
export function canViewApplication(
  application: { applicantId: string },
  post: { creatorId: string },
  viewerId: string | undefined,
): boolean {
  if (!viewerId) return false;
  return viewerId === post.creatorId || viewerId === application.applicantId;
}

/* ------------------------------------------------------------------ *
 * 匹配资料视图（**只有自己**能看，规格 §6.1 / §6.3）
 * ------------------------------------------------------------------ */

export interface ProfileRow {
  userId: string;
  sections: string[];
  interestTags: string[];
  activityTags: string[];
  skillLevel: string | null;
  availability: unknown;
  preferredAreas: string[];
  department: string | null;
  bio: string | null;
  matchEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProfileView {
  sections: string[];
  interestTags: string[];
  activityTags: string[];
  skillLevel: string | null;
  availability: unknown;
  preferredAreas: string[];
  department: string | null;
  bio: string | null;
  matchEnabled: boolean;
  updatedAt: string;
}

/**
 * 我的匹配资料视图。
 *
 * ⚠️ 只有 `GET /profile`（本人）会调用它。**没有任何端点**把
 * `BuddyProfile` 暴露给他人 —— 匹配结果的解释（`reason`）是聚合后的短语
 * （如"共同兴趣：羽毛球"），不等于资料的泄漏（规格 §6.1）。
 *
 * 刻意**不含** `embedding` / `embeddingModel` / `userId`。
 */
export function toProfileView(row: ProfileRow): ProfileView {
  return {
    sections: [...row.sections],
    interestTags: [...row.interestTags],
    activityTags: [...row.activityTags],
    skillLevel: row.skillLevel,
    availability: row.availability,
    preferredAreas: [...row.preferredAreas],
    department: row.department,
    bio: row.bio,
    matchEnabled: row.matchEnabled,
    updatedAt: row.updatedAt.toISOString(),
  };
}
