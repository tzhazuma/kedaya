/**
 * 找搭子 · 封闭标签表与校园地点白名单 —— **唯一真相**
 *
 * ⚠️ 本文件是**全仓唯一**的标签表。服务端用它做 `UNKNOWN_TAG:<key>` 校验，
 * 三端用它渲染选择器。**不要在任何一个端里再复制一份**。
 *
 * ## 为什么必须收敛到一处（这是修一个真实缺陷）
 *
 * 收敛前四端各有一份，实测互不相同：服务端 62 / 小程序 62 / **Web 46**。
 * 后果是 **Web 用户选到的标签会被后端拒**（`UNKNOWN_TAG`）——
 * 而 Web 那份还把 `lab`/`metro`/`north-gate`/`lake-side` 这类**校园地点**
 * 混进了**标签**表（地点属于 `CAMPUS_LOCATIONS`，是另一个概念）。
 *
 * 根因不是"某端写错了 62 条"，而是**没有唯一真相**。所以修法是让三端从同一个文件取表，
 * 而不是把 Web 改成 62 条 —— 否则下次加标签还会漂移。
 * Dart 端无法 import TS，沿用 `tokens` 的做法：TS 是真相，Dart 由脚本生成镜像。
 *
 * ## 为什么标签必须封闭
 *
 * STUMatch 的 `interests` 是自由文本，共同兴趣靠**字符串精确相等**
 * （`matching.py:277-282` 的 `set` 交集）。自由文本会让
 * `"羽毛球"` / `"打羽毛球"` / `"badminton"` 互不匹配 —— 这是参考实现里最脆弱的一处。
 *
 * `aliases` **仅用于搜索**，不用于匹配（规格 §3.2 明文）。
 *
 * ## 与 DB 的关系（诚实说明）
 *
 * 规格 §3.2 要求标签表"存在 DB（可运营）"，且"变更必须走 migration + 审计，不得运行时改"。
 * 本文件是**校验与渲染用的那份**；`BuddyTag` 表的种子数据必须由它生成 ——
 * 一致性由服务端 `domain/tags.spec.ts` 的静态断言钉死（同一常量，不存在漂移窗口）。
 */

export type BuddyTagGroup = 'sport' | 'study' | 'meal' | 'travel' | 'interest';

export interface BuddyTagDef {
  key: string;
  label: string;
  group: BuddyTagGroup;
  /** 别名词表，**仅用于搜索**，不参与匹配 */
  aliases?: readonly string[];
  /** 下架标签不删除（历史数据仍引用），但不再出现在选择器里 */
  isActive?: boolean;
}

/**
 * 封闭标签表。新增标签 = 改这里 + 重新生成 Dart 镜像 + 出一份 migration 种子，
 * 三件事必须在同一个 PR 里（否则一致性测试会红）。
 */
export const BUDDY_TAGS: readonly BuddyTagDef[] = [
  // —— 运动 ——
  { key: 'badminton', label: '羽毛球', group: 'sport', aliases: ['打羽毛球'] },
  { key: 'basketball', label: '篮球', group: 'sport', aliases: ['打篮球'] },
  { key: 'football', label: '足球', group: 'sport', aliases: ['踢球'] },
  { key: 'volleyball', label: '排球', group: 'sport' },
  { key: 'table-tennis', label: '乒乓球', group: 'sport', aliases: ['乒乓'] },
  { key: 'tennis', label: '网球', group: 'sport' },
  { key: 'running', label: '跑步', group: 'sport', aliases: ['夜跑', '慢跑'] },
  { key: 'swimming', label: '游泳', group: 'sport' },
  { key: 'gym', label: '健身', group: 'sport', aliases: ['撸铁'] },
  { key: 'yoga', label: '瑜伽', group: 'sport' },
  { key: 'cycling', label: '骑行', group: 'sport' },
  { key: 'hiking', label: '徒步', group: 'sport', aliases: ['爬山'] },
  { key: 'climbing', label: '攀岩', group: 'sport' },
  { key: 'skateboard', label: '滑板', group: 'sport' },
  { key: 'billiards', label: '台球', group: 'sport' },

  // —— 学术/自习 ——
  { key: 'self-study', label: '自习', group: 'study', aliases: ['泡图书馆'] },
  { key: 'library', label: '图书馆', group: 'study' },
  { key: 'exam-prep', label: '备考', group: 'study' },
  { key: 'postgraduate-exam', label: '考研', group: 'study' },
  { key: 'english', label: '英语', group: 'study' },
  { key: 'ielts-toefl', label: '托福雅思', group: 'study' },
  { key: 'math', label: '数学', group: 'study' },
  { key: 'programming', label: '编程', group: 'study', aliases: ['写代码'] },
  { key: 'research', label: '科研', group: 'study' },
  { key: 'paper-writing', label: '论文写作', group: 'study', aliases: ['写论文'] },
  { key: 'group-project', label: '小组作业', group: 'study' },
  { key: 'competition', label: '竞赛', group: 'study', aliases: ['比赛'] },

  // —— 吃饭 ——
  { key: 'canteen', label: '食堂', group: 'meal' },
  { key: 'hotpot', label: '火锅', group: 'meal' },
  { key: 'bbq', label: '烧烤', group: 'meal' },
  { key: 'coffee', label: '咖啡', group: 'meal' },
  { key: 'milk-tea', label: '奶茶', group: 'meal' },
  { key: 'late-night-snack', label: '夜宵', group: 'meal' },
  { key: 'baking', label: '烘焙', group: 'meal' },
  { key: 'food-explore', label: '探店', group: 'meal' },

  // —— 出行 ——
  { key: 'citywalk', label: '城市漫步', group: 'travel', aliases: ['city walk'] },
  { key: 'weekend-trip', label: '周末出游', group: 'travel' },
  { key: 'disney', label: '迪士尼', group: 'travel' },
  { key: 'mountain-trip', label: '登山', group: 'travel' },
  { key: 'photo-shoot', label: '拍照', group: 'travel' },
  { key: 'cycling-trip', label: '骑行出游', group: 'travel' },
  { key: 'carpool', label: '拼车', group: 'travel' },
  { key: 'train-together', label: '同行', group: 'travel' },

  // —— 兴趣 ——
  { key: 'music', label: '音乐', group: 'interest' },
  { key: 'movie', label: '电影', group: 'interest' },
  { key: 'gaming', label: '游戏', group: 'interest', aliases: ['开黑'] },
  { key: 'board-game', label: '桌游', group: 'interest' },
  { key: 'reading', label: '读书', group: 'interest' },
  { key: 'photography', label: '摄影', group: 'interest' },
  { key: 'anime', label: '动漫', group: 'interest' },
  { key: 'ktv', label: '唱歌', group: 'interest' },
  { key: 'drama', label: '话剧', group: 'interest' },
  { key: 'painting', label: '绘画', group: 'interest' },
  { key: 'dance', label: '舞蹈', group: 'interest' },
  { key: 'calligraphy', label: '书法', group: 'interest' },
  { key: 'cooking', label: '做饭', group: 'interest' },
  { key: 'pets', label: '撸猫撸狗', group: 'interest' },
  { key: 'tech', label: '科技', group: 'interest' },
  { key: 'startup', label: '创业', group: 'interest' },
  { key: 'volunteer', label: '志愿活动', group: 'interest' },
  { key: 'debate', label: '辩论', group: 'interest' },
  { key: 'chess', label: '棋类', group: 'interest' },
];

export const TAG_KEYS: readonly string[] = BUDDY_TAGS.map((tag) => tag.key);

const TAG_BY_KEY = new Map(BUDDY_TAGS.map((tag) => [tag.key, tag]));

export function tagLabel(key: string): string {
  return TAG_BY_KEY.get(key)?.label ?? key;
}

export function tagLabels(keys: readonly string[]): string[] {
  return keys.map(tagLabel);
}

export function isKnownTag(key: string): boolean {
  return TAG_BY_KEY.has(key);
}

/** 返回其中**不合法**的标签（保持输入顺序，便于客户端逐项提示） */
export function unknownTags(keys: readonly string[]): string[] {
  return keys.filter((key) => !TAG_BY_KEY.has(key));
}

/** 选择器只应展示 active 的标签 */
export function activeTags(): readonly BuddyTagDef[] {
  return BUDDY_TAGS.filter((tag) => tag.isActive !== false);
}

/* ---------------- 数量上限（规格 §3.2） ---------------- */

export const MAX_INTEREST_TAGS = 20;
export const MAX_ACTIVITY_TAGS = 10;
export const MAX_POST_TAGS = 8;
export const MAX_PREFERRED_AREAS = 5;

/* ---------------- 技能水平（仅 sport 板块） ---------------- */

export type BuddySkillLevel = 'beginner' | 'casual' | 'regular' | 'competitive';

export const SKILL_LEVELS: readonly BuddySkillLevel[] = [
  'beginner',
  'casual',
  'regular',
  'competitive',
];

export const SKILL_RANK: Readonly<Record<BuddySkillLevel, number>> = {
  beginner: 0,
  casual: 1,
  regular: 2,
  competitive: 3,
};

export function isSkillLevel(value: unknown): value is BuddySkillLevel {
  return typeof value === 'string' && (SKILL_LEVELS as readonly string[]).includes(value);
}

export function skillRank(level: string): number {
  return SKILL_RANK[level as BuddySkillLevel] ?? -1;
}

/* ---------------- 校园地点白名单 ----------------
 *
 * ⚠️ **这是占位清单**（规格未决问题 U10 至今未关闭）。真实清单必须由产品 + 运营确认后替换。
 * 在它落地前，服务端对 `location` 只做**长度校验 + 命中白名单**，不假装已经真实。
 * 替换只需改这一个常量 + 一份种子 migration。
 */
/**
 * 校园地点 —— **`{ key, label }` 形式，全仓唯一真相**。
 *
 * ⚠️ **`label` 才是上线值（wire value）**，`key` 只是稳定的机器标识（供埋点/i18n/URL 用）。
 * 服务端白名单校验的是**中文名**，所以三端提交 `location` / `preferredAreas` 时必须用 `label`。
 *
 * ## 为什么要有这一条（真实缺陷）
 *
 * 收敛前 Web 端自己维护了 15 个**英文 slug**（`gym`/`stadium`/`north-gate`…），
 * 而服务端白名单是 25 个**中文名**（`体育馆`/`田径场`/`校门口`…）——
 * **两个命名空间完全不相交**：Web 用户选的任何地点，服务端都会判为不在白名单。
 * 这与标签表漂移是同一类 bug（用户提交被拒），根因同样是**没有唯一真相**。
 *
 * 同时这份表**仍是占位**（规格未决问题 U10 至今未关闭）：真实清单必须由产品 + 运营确认。
 * 替换只需改这里 + 一份种子 migration。
 */
export interface CampusLocationDef {
  /** 稳定机器标识（kebab-case），**不是**上线值 */
  key: string;
  /** 中文显示名 —— **这才是提交给服务端的值** */
  label: string;
}

export const CAMPUS_LOCATION_DEFS: readonly CampusLocationDef[] = [
  { key: 'library', label: '图书馆' },
  { key: 'canteen-1', label: '一食堂' },
  { key: 'canteen-2', label: '二食堂' },
  { key: 'canteen-3', label: '三食堂' },
  { key: 'gym', label: '体育馆' },
  { key: 'badminton-hall', label: '羽毛球馆' },
  { key: 'swimming-pool', label: '游泳馆' },
  { key: 'track-field', label: '田径场' },
  { key: 'basketball-court', label: '篮球场' },
  { key: 'tennis-court', label: '网球场' },
  { key: 'fitness-room', label: '健身房' },
  { key: 'teaching-a', label: '教学楼A' },
  { key: 'teaching-b', label: '教学楼B' },
  { key: 'teaching-c', label: '教学楼C' },
  { key: 'student-center', label: '学生活动中心' },
  { key: 'academic-exchange-center', label: '学术交流中心' },
  { key: 'school-entrepreneurship', label: '创管学院' },
  { key: 'school-information', label: '信息学院' },
  { key: 'school-physical', label: '物质学院' },
  { key: 'school-life', label: '生命学院' },
  { key: 'dorm-area', label: '宿舍区' },
  { key: 'lakeside-lawn', label: '湖畔草坪' },
  { key: 'cafe', label: '咖啡厅' },
  { key: 'campus-gate', label: '校门口' },
  { key: 'zhangjiang-metro', label: '张江地铁站' },
];

/**
 * 地点白名单（**上线值**，即中文名）。服务端用它校验 `location` / `preferredAreas`。
 * 由 [CAMPUS_LOCATION_DEFS] 派生 —— 保持既有 `readonly string[]` 形状不变，
 * 所以服务端既有调用点无需改动。
 */
export const CAMPUS_LOCATIONS: readonly string[] = CAMPUS_LOCATION_DEFS.map((d) => d.label);

const LOCATION_BY_LABEL = new Map(CAMPUS_LOCATION_DEFS.map((d) => [d.label, d]));

/** label → key（埋点/i18n 用）；未知返回 undefined */
export function campusLocationKey(label: string): string | undefined {
  return LOCATION_BY_LABEL.get(label.trim())?.key;
}
const LOCATION_SET = new Set(CAMPUS_LOCATIONS);

export function isKnownLocation(value: string): boolean {
  // 去首尾空白后判定 —— 地点是人工输入的，容错空白是合理的
  return LOCATION_SET.has(value.trim());
}

/** 规范化：只去首尾空白。**不要**在这里加长度截断或白名单改写 ——
 *  那会静默改变用户输入（校验应当拒绝，而不是悄悄改）。 */
export function normalizeLocation(value: string): string {
  return value.trim();
}
