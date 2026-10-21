/**
 * 可达鸭模块注册表（冻结契约 §4）
 *
 * 三端（小程序 / Web / Flutter）的导航、宫格、权限判定、路由前缀
 * 全部由本表驱动 —— **禁止在各端硬编码模块清单**。
 */

/** 敏感级：high / critical 必须走独立权限域 + 审计（契约 §9） */
export type Sensitivity = 'low' | 'medium' | 'high' | 'critical';

export type ModuleCategory = 'business' | 'core';

export interface KedayaModule {
  /** 冻结的模块 key，同时是 API 路由段 */
  id: string;
  /** 中文名 */
  nameZh: string;
  /** 英文标识（用于文件名 / 埋点） */
  nameEn: string;
  /** 一句话定义 */
  summary: string;
  category: ModuleCategory;
  sensitivity: Sensitivity;
  /** 是否必须二次同意才能进入 */
  requiresConsent: boolean;
  /** API 路由前缀（不含 /api/v1） */
  route: string;
}

/* ------------------------------------------------------------------ *
 * 14 个业务模块（来自需求图）
 * ------------------------------------------------------------------ */
export const BUSINESS_MODULES: readonly KedayaModule[] = [
  {
    id: 'groupbuy',
    nameZh: '拼单',
    nameEn: 'Group Buy',
    summary: '拼团凑单：发起、参团、成团、结算',
    category: 'business',
    sensitivity: 'low',
    requiresConsent: false,
    route: 'groupbuy',
  },
  {
    id: 'takeout-guard',
    nameZh: '偷外卖',
    nameEn: 'Takeout Guard',
    summary: '外卖被拿错的举报、举证、协商与信用记录',
    category: 'business',
    sensitivity: 'medium',
    requiresConsent: false,
    route: 'takeout-guard',
  },
  {
    id: 'flea-market',
    nameZh: '跳蚤',
    nameEn: 'Flea Market',
    summary: '二手闲置发布、搜索、议价与面交',
    category: 'business',
    sensitivity: 'low',
    requiresConsent: false,
    route: 'flea-market',
  },
  {
    id: 'dorm-harmony',
    nameZh: '宿舍矛盾',
    nameEn: 'Dorm Harmony',
    summary: '匿名调解申请、调解员介入与宿舍公约投票',
    category: 'business',
    sensitivity: 'high',
    requiresConsent: true,
    route: 'dorm-harmony',
  },
  {
    id: 'errand',
    nameZh: '跑腿',
    nameEn: 'Errand',
    summary: '代取快递、买饭、送件，悬赏与接单',
    category: 'business',
    sensitivity: 'low',
    requiresConsent: false,
    route: 'errand',
  },
  {
    id: 'buddy',
    nameZh: '找搭子',
    nameEn: 'Buddy Finder',
    summary: '运动、自习、吃饭、出行的组队匹配',
    category: 'business',
    sensitivity: 'low',
    requiresConsent: false,
    route: 'buddy',
  },
  {
    id: 'lost-found',
    nameZh: '失物招领',
    nameEn: 'Lost & Found',
    summary: '丢失登记、拾获登记与双向匹配',
    category: 'business',
    sensitivity: 'low',
    requiresConsent: false,
    route: 'lost-found',
  },
  {
    id: 'canteen',
    nameZh: '营养管家',
    nameEn: 'Nutrition Butler',
    summary: '食堂菜品营养库、每餐记录、每日需求与缺口推荐',
    category: 'business',
    /**
     * 模块 id / route 仍是 `canteen`（营养管家建在食堂营养域上，ADR 0006 §2.3），
     * 但**对用户的名字已改成「营养管家」** —— 宫格、搜索、权限判定都读本注册表，
     * 所以改名只需改这里，三端自动同步。
     */
    /**
     * 敏感级从 low 上调为 medium（2026-10-17）：
     * 新增的「每餐记录 + 身体档案（性别/年龄/身高/体重）」是可推断健康状况的
     * 个人信息，比单纯的菜品营养表敏感得多。仍不设二次同意门（不做医学判断、
     * 不对外共享），但写操作落审计。
     */
    sensitivity: 'medium',
    requiresConsent: false,
    route: 'canteen',
  },
  {
    id: 'forum',
    nameZh: '论坛',
    nameEn: 'Forum',
    summary: '版块、主题、回复、举报与治理',
    category: 'business',
    sensitivity: 'medium',
    requiresConsent: false,
    route: 'forum',
  },
  {
    id: 'ai-portrait',
    nameZh: 'AI 校园画像',
    nameEn: 'AI Portrait',
    summary: '基于用户行为的画像与推荐，可解释、可关闭',
    category: 'business',
    sensitivity: 'high',
    requiresConsent: true,
    route: 'ai-portrait',
  },
  {
    id: 'wellbeing',
    nameZh: '心理支持',
    nameEn: 'Wellbeing',
    summary: '倾听与预约入口，危机出口在首屏；不做诊断、不做治疗',
    category: 'business',
    sensitivity: 'critical',
    requiresConsent: true,
    route: 'wellbeing',
  },
  {
    id: 'faq',
    nameZh: '常见问题',
    nameEn: 'FAQ',
    summary: '知识库与工单式自助答疑',
    category: 'business',
    sensitivity: 'low',
    requiresConsent: false,
    route: 'faq',
  },
  {
    id: 'techpie',
    nameZh: 'TechPie 整合',
    nameEn: 'TechPie Bridge',
    summary: '与 TechPie / GeekPie 体系互联互通',
    category: 'business',
    sensitivity: 'medium',
    requiresConsent: false,
    route: 'techpie',
  },
  {
    /**
     * ⚠️ 展示名已从「猫鸟黑天鹅」改为「野生动物」（产品面：野生居民**档案** + 地图）。
     * `id` 是冻结契约的一部分（它同时是 API 路由段与落库字段），**不改** ——
     * 改名只发生在展示层，历史数据、审计与路由全都不受影响。
     */
    id: 'wildlife',
    nameZh: '野生动物',
    nameEn: 'Campus Wildlife',
    summary: '野生居民档案：物种与个体、校园活动地图、投喂规范与观测上报',
    category: 'business',
    sensitivity: 'low',
    requiresConsent: false,
    route: 'wildlife',
  },
  {
    id: 'facility',
    nameZh: '场馆预约',
    nameEn: 'Facility Booking',
    summary: '体育场馆、健身房等校园场馆的预约与核销',
    category: 'business',
    sensitivity: 'medium',
    requiresConsent: false,
    route: 'facility',
  },
  {
    id: 'petition',
    nameZh: '众筹诉求',
    nameEn: 'Petitions',
    // ⚠️ 措辞要准确：这里**不筹钱**，筹的是「有多少人真的需要」
    summary: '把共同需求汇总成一份可核对的诉求，达到门槛后发信给对应部门',
    category: 'business',
    sensitivity: 'low',
    requiresConsent: false,
    route: 'petition',
  },
] as const;

/* ------------------------------------------------------------------ *
 * 6 个基础模块（第 6 个是 2026-10-19 新增的 deadlines，见条目的分类说明）
 * ------------------------------------------------------------------ */
export const CORE_MODULES: readonly KedayaModule[] = [
  {
    id: 'auth',
    nameZh: '身份',
    nameEn: 'Auth',
    summary: '上科大统一身份认证与第三方校园系统绑定',
    category: 'core',
    sensitivity: 'high',
    requiresConsent: false,
    route: 'auth',
  },
  {
    id: 'schedule',
    nameZh: '课表',
    nameEn: 'Schedule',
    summary: '学期、课程表与考试安排',
    category: 'core',
    sensitivity: 'medium',
    requiresConsent: false,
    route: 'schedule',
  },
  /**
   * DDL 聚合（第 21 个模块，2026-10-19 加入）。
   *
   * ## 为什么是 `core` 而不是 `business`
   *
   * 它和 `schedule` 是同一层**学业基础设施**：课表回答「什么时候上课」，
   * DDL 回答「什么时候交作业 / 考试」，数据都来自课程系统（Blackboard /
   * Gradescope / Piazza / e云平台）的绑定。它不产生交易、不涉及社交内容，
   * 不属于需求图里那 14 个校园生活业务模块，因此不占用业务模块名额。
   *
   * ## 为什么是 `medium` 而不是 `low`
   *
   * 条目里含课程名、作业标题、截止时间与占总评比例，能反推出在修哪些课、
   * 学业负担与考核安排；但**不含成绩、答案与平台凭据**，与 `schedule` 同级。
   * 不设二次同意门（进入即使用，不额外采集数据）；将来若接入成绩或答案，
   * 必须重新评估为 `high` 并补审计。
   *
   * ⚠️ 本轮**没有对应的后端模块**（`services/` 里还没有 deadlines）：
   * 小程序端的条目只来自本机粘贴 / 手填。`route` 仍先按契约登记 ——
   * 它是 API 路由段与落库字段，等接口上线时不必再改一次 id。
   */
  /**
   * 校园地点（第 22 个模块，2026-10-19 加入）。
   *
   * ## 为什么也要登记成契约模块
   *
   * 页面早就写好（`presentation/pages/campusMap/`），但它**没有任何入口** ——
   * 因为首页宫格、路由表都只认契约模块（`modules.ts` 的注释写得很清楚：
   * 「禁止在各端硬编码模块清单」）。不登记就只能手动 navigate，等于不可达。
   *
   * 这与 `deadlines` 是同一类问题，处理方式也一致：先登记，再让各端自动跟上。
   *
   * ## 为什么是 `core` + `low`
   *
   * 它展示的是**校园公开地点信息**（快递站 / 车库 / 食堂 / 活动场地 / 自习空间），
   * 不含任何个人数据，也不产生交易或社交内容 —— 因此 `low`。
   *
   * ⚠️ **照片版权**：`map.niyiwei.com` 的地库与菜单照片是另一参赛组同学手拍，
   * 著作权归拍摄者。我们的 POI 契约（`campus-poi.ts`）在校验层主动拒收该域名的
   * 照片，且**有图必须署名**。演示数据不带任何照片。
   */
  {
    id: 'campus-map',
    nameZh: '校园地点',
    nameEn: 'Campus Map',
    summary: '快递站、地下车库、食堂菜单、活动场地与自习空间的位置与「下一站」安排',
    category: 'core',
    sensitivity: 'low',
    requiresConsent: false,
    route: 'campus-map',
  },
  {
    id: 'deadlines',
    nameZh: 'DDL 聚合',
    nameEn: 'Deadlines',
    summary:
      '把散在 Blackboard / Gradescope / Piazza / e云平台的作业与考试截止日期聚到一处，按紧迫度排序并保留回源链接',
    category: 'core',
    sensitivity: 'medium',
    requiresConsent: false,
    route: 'deadlines',
  },
  {
    id: 'campus-card',
    nameZh: '校园卡',
    nameEn: 'Campus Card',
    summary: '余额、流水与付款码',
    category: 'core',
    sensitivity: 'high',
    requiresConsent: false,
    route: 'campus-card',
  },
  {
    id: 'profile',
    nameZh: '我的',
    nameEn: 'Profile',
    summary: '资料、设置与隐私开关',
    category: 'core',
    sensitivity: 'medium',
    requiresConsent: false,
    route: 'profile',
  },
  {
    id: 'notifications',
    nameZh: '通知',
    nameEn: 'Notifications',
    summary: '站内信、订阅消息（小程序）与推送',
    category: 'core',
    sensitivity: 'low',
    requiresConsent: false,
    route: 'notifications',
  },
] as const;

/* ------------------------------------------------------------------ *
 * 派生
 * ------------------------------------------------------------------ */

export const MODULES: readonly KedayaModule[] = [...CORE_MODULES, ...BUSINESS_MODULES];

/** 需要二次同意的模块（契约 §9） */
export const CONSENT_MODULES: readonly KedayaModule[] = MODULES.filter((m) => m.requiresConsent);

/** 高敏感模块（high + critical） */
export const SENSITIVE_MODULES: readonly KedayaModule[] = MODULES.filter(
  (m) => m.sensitivity === 'high' || m.sensitivity === 'critical',
);

const BY_ID = new Map<string, KedayaModule>(MODULES.map((m) => [m.id, m]));

export function getModule(id: string): KedayaModule | undefined {
  return BY_ID.get(id);
}

export function requiresConsent(id: string): boolean {
  return BY_ID.get(id)?.requiresConsent ?? false;
}

export function isSensitive(id: string): boolean {
  const m = BY_ID.get(id);
  return m?.sensitivity === 'high' || m?.sensitivity === 'critical';
}

/** 生成 API 路径，例: modulePath('groupbuy', 'items', '123') -> '/groupbuy/items/123' */
export function modulePath(id: string, ...segments: (string | number)[]): string {
  const m = BY_ID.get(id);
  const base = m ? m.route : id;
  return [base, ...segments.map(String)].join('/');
}
