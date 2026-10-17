#!/usr/bin/env node
/**
 * 可达鸭后端 · 模块脚手架
 *
 * 为什么存在这个脚本：
 *   契约 §4 的 20 个模块里，有 12 个是"同一套 CRUD 形状 + 各自的领域动作"
 *   （契约 §6.1：list / create / detail / patch / delete / <action>）。
 *   手写这 12 × 5 个文件既冗长又容易漂移。本脚本把**形状**固化下来，
 *   把**差异**（字段、领域动作）留在下面的 SPEC 表里，一次生成、可重复执行。
 *
 * 生成的分层（契约 §7）：
 *   domain/<id>.domain.ts   纯模型 + 端口（零框架依赖）
 *   data/<id>.repository.ts Prisma 实现（唯一碰 IO 的地方）
 *   <id>.service.ts         用例（controller → service → repository）
 *   <id>.controller.ts      路由 + Zod schema + Swagger
 *   <id>.module.ts          NestJS 装配
 *
 * 手写（**不在** SPEC 表里、本脚本不写盘）的模块：
 *   auth（两级身份）、wellbeing（同意门 + 审计 + 危机热线）、
 *   dorm-harmony（匿名 + 同意门）、ai-portrait（同意门 + 禁读域）、
 *   forum（版块 + 状态机 + 匿名 HMAC + 举报阈值治理 + 回复子资源）、
 *   faq（检索 + 幂等「有用」+ 工单状态机 + 关键词建议）、
 *   wildlife（四层位置模糊化 + EXIF 剥离 + DBSCAN 热点/推断轨迹 + 受限精确坐标表）、
 *   buddy（找搭子：匹配算法 + 申请状态机 + 反馈衰减）、
 *   **techpie**（TechPie 整合 Phase 0：校园平台绑定 + 一次性 WebView 票据 +
 *     cookie 唯一出口 + 白名单 fail-closed —— 见 docs/features/techpie-integration.md §8.1）、
 *   **campus-card**（校园卡：第二级绑定门 + 流水汇总，规格 §2.5 的 OPENID 通道）、
 *   **schedule**（课表：校园能力，必须挂 CampusBindingGuard —— 不变式 I4）。
 *   判据：领域形状超出"一套 CRUD + 一个动作"能表达的范围。
 *
 * 用法：node scripts/scaffold.mjs
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const MODULES_DIR = join(ROOT, 'src', 'modules');

/* ------------------------------------------------------------------ *
 * 字段类型 token
 *   string / string? / int / int? / float / bool / date / date? / string[]
 *   '?' 表示 Prisma 里可空（nullable）
 * ------------------------------------------------------------------ */
const TS_BASE = {
  string: 'string',
  int: 'number',
  float: 'number',
  bool: 'boolean',
  date: 'Date',
  'string[]': 'string[]',
};

const ZOD = {
  string: 'z.string().min(1).max(500)',
  'string?': 'z.string().max(500).nullish()',
  int: 'z.number().int()',
  'int?': 'z.number().int().nullish()',
  float: 'z.number()',
  bool: 'z.boolean()',
  date: 'z.coerce.date()',
  'date?': 'z.coerce.date().nullish()',
  'string[]': 'z.array(z.string().min(1).max(64)).max(20)',
};

const isNullable = (t) => t.endsWith('?');
const baseOf = (t) => (isNullable(t) ? t.slice(0, -1) : t);
const tsType = (t) => `${TS_BASE[baseOf(t)]}${isNullable(t) ? ' | null' : ''}`;
/** Prisma 模型名 → 注入 token 常量名：ScheduleCourse → SCHEDULE_COURSE_REPOSITORY */
const tokenOf = (model) => `${model.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase()}_REPOSITORY`;

/* ------------------------------------------------------------------ *
 * SPEC：9 个"形状统一"的模块（原 12 个；techpie / campus-card / schedule 已移出）
 *
 *   readOnly    —— DB 管理的时间戳等，不进 create/update 输入
 *   optionalCreate —— Prisma 有 @default，创建时可省略
 *   ownerField  —— 未登录时可由 actorId 补全的归属字段
 *   action      —— 契约 §6.1 的领域动作（update = 状态流转；custom = 手写片段）
 * ------------------------------------------------------------------ */
const SPEC = [
  {
    id: 'profile',
    zh: '我的',
    pascal: 'Profile',
    model: 'ProfileSetting',
    delegate: 'profileSetting',
    ownerField: 'userId',
    readOnly: ['userId', 'createdAt', 'updatedAt'],
    optionalCreate: ['showRealName', 'allowAiPortrait', 'allowWellbeing', 'allowDormHarmony', 'themeMode'],
    fields: [
      ['userId', 'string'],
      ['showRealName', 'bool'],
      ['allowAiPortrait', 'bool'],
      ['allowWellbeing', 'bool'],
      ['allowDormHarmony', 'bool'],
      ['themeMode', 'string'],
      ['createdAt', 'date'],
      ['updatedAt', 'date'],
    ],
    action: { kind: 'custom', name: 'me', summary: '读取（必要时初始化）我的隐私开关' },
    customPort: `  findByUserId(userId: string): Promise<ProfileSettingModel | null>;
  ensureForUser(userId: string): Promise<ProfileSettingModel>;
  patchForUser(userId: string, patch: UpdateProfileSettingInput): Promise<ProfileSettingModel>;`,
    customRepository: `
  async findByUserId(userId: string): Promise<ProfileSettingModel | null> {
    return this.prisma.profileSetting.findUnique({ where: { userId } });
  }

  /** 首次访问时用全部默认值建档（契约 §9：默认全关，最小采集） */
  async ensureForUser(userId: string): Promise<ProfileSettingModel> {
    return this.prisma.profileSetting.upsert({
      where: { userId },
      create: { userId },
      update: {},
    });
  }

  async patchForUser(userId: string, patch: UpdateProfileSettingInput): Promise<ProfileSettingModel> {
    return this.prisma.profileSetting.update({ where: { userId }, data: patch });
  }`,
    customService: `
  /** 读取我的设置；不存在则按默认值建档（隐私开关默认全关） */
  me(userId: string): Promise<ProfileSettingModel> {
    return this.repo.ensureForUser(userId);
  }

  patchMine(userId: string, patch: UpdateProfileSettingInput): Promise<ProfileSettingModel> {
    return this.repo.patchForUser(userId, patch);
  }`,
    customController: `
  @Get('me')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '我的资料与隐私开关（不存在则按默认值建档）' })
  me(@CurrentUser() userId: string) {
    return this.service.me(userId);
  }

  @Patch('me')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '更新我的隐私开关（可随时关闭 AI 画像等）' })
  patchMine(@CurrentUser() userId: string, @ZodBody(updateSchema) body: UpdateProfileSettingInput) {
    return this.service.patchMine(userId, body);
  }`,
  },
  {
    id: 'notifications',
    zh: '通知',
    pascal: 'Notification',
    model: 'Notification',
    delegate: 'notification',
    ownerField: 'userId',
    readOnly: ['createdAt'],
    optionalCreate: ['channel'],
    fields: [
      ['userId', 'string'],
      ['title', 'string'],
      ['body', 'string'],
      ['channel', 'string'],
      ['readAt', 'date?'],
      ['createdAt', 'date'],
    ],
    action: {
      kind: 'update',
      name: 'read',
      summary: '标记已读',
      data: '{ readAt: new Date() }',
    },
  },
  {
    id: 'groupbuy',
    zh: '拼单',
    pascal: 'Groupbuy',
    model: 'GroupbuyOrder',
    delegate: 'groupbuyOrder',
    ownerField: 'ownerId',
    readOnly: ['createdAt', 'updatedAt'],
    optionalCreate: ['status'],
    fields: [
      ['ownerId', 'string'],
      ['title', 'string'],
      ['description', 'string?'],
      ['category', 'string'],
      ['targetCount', 'int'],
      ['unitPriceFen', 'int'],
      ['status', 'string'],
      ['deadline', 'date'],
      ['pickupSpot', 'string?'],
      ['createdAt', 'date'],
      ['updatedAt', 'date'],
    ],
    serviceImports: `import { ConflictError } from '../../common/errors/app-error';`,
    action: { kind: 'custom', name: 'join', summary: '参团（真实写入 GroupbuyMember 关联表）' },
    customPort: `  join(
    orderId: string,
    userId: string,
    quantity: number,
  ): Promise<{ memberId: string; quantity: number }>;
  memberCount(orderId: string): Promise<number>;`,
    customRepository: `
  /** 参团：幂等 upsert 到 GroupbuyMember 关联表 */
  async join(orderId: string, userId: string, quantity: number): Promise<{ memberId: string; quantity: number }> {
    const member = await this.prisma.groupbuyMember.upsert({
      where: { orderId_userId: { orderId, userId } },
      create: { orderId, userId, quantity },
      update: { quantity },
      select: { id: true, quantity: true },
    });
    return { memberId: member.id, quantity: member.quantity };
  }

  /** 当前参团人数（用于成团判定） */
  memberCount(orderId: string): Promise<number> {
    return this.prisma.groupbuyMember.count({ where: { orderId } });
  }`,
    customService: `
  /**
   * 领域动作：参团（契约 §6.1 的 POST /items/:id/join）。
   *
   * 真实业务：写入 GroupbuyMember，并按参团人数把订单状态推进到 grouped。
   * 这是 groupbuy 模块的核心用例，单元测试覆盖了它（见 groupbuy.service.spec.ts）。
   */
  async join(id: string, userId: string, quantity: number) {
    const order = await this.detail(id);

    if (order.status !== 'open') {
      throw new ConflictError('该拼单已结束，无法参团', { status: order.status });
    }

    const member = await this.repo.join(id, userId, quantity);
    const totalMembers = await this.repo.memberCount(id);
    const status = totalMembers >= order.targetCount ? 'grouped' : 'open';

    if (status !== order.status) {
      await this.repo.update(id, { status });
    }

    return {
      orderId: id,
      memberId: member.memberId,
      quantity: member.quantity,
      totalMembers,
      targetCount: order.targetCount,
      status,
    };
  }`,
    customController: `
  @Post('items/:id/join')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '参团（成团后状态自动推进为 grouped）' })
  join(
    @CurrentUser() userId: string,
    @Param('id') id: string,
    @ZodBody(joinSchema) body: z.infer<typeof joinSchema>,
  ) {
    return this.service.join(id, userId, body.quantity);
  }`,
    extraSchemas: `const joinSchema = z.object({ quantity: z.number().int().positive().max(99) });`,
  },
  {
    id: 'takeout-guard',
    zh: '偷外卖',
    pascal: 'TakeoutGuard',
    model: 'TakeoutReport',
    delegate: 'takeoutReport',
    // 匿名可用（契约 §9）：reporterId 可空，故不做归属补全
    ownerField: null,
    readOnly: ['createdAt', 'updatedAt'],
    optionalCreate: ['status'],
    fields: [
      ['reporterId', 'string?'],
      ['anonHandle', 'string?'],
      ['orderNo', 'string'],
      ['place', 'string'],
      ['happenedAt', 'date'],
      ['detail', 'string?'],
      ['evidenceUrl', 'string?'],
      ['status', 'string'],
      ['createdAt', 'date'],
      ['updatedAt', 'date'],
    ],
    action: { kind: 'update', name: 'escalate', summary: '升级为协商中', data: "{ status: 'escalated' }" },
  },
  {
    id: 'flea-market',
    zh: '跳蚤',
    pascal: 'FleaMarket',
    model: 'FleaItem',
    delegate: 'fleaItem',
    ownerField: 'sellerId',
    readOnly: ['createdAt', 'updatedAt'],
    optionalCreate: ['condition', 'status'],
    fields: [
      ['sellerId', 'string'],
      ['title', 'string'],
      ['description', 'string?'],
      ['priceFen', 'int'],
      ['category', 'string'],
      ['condition', 'string'],
      ['campusSpot', 'string?'],
      ['status', 'string'],
      ['createdAt', 'date'],
      ['updatedAt', 'date'],
    ],
    action: { kind: 'update', name: 'reserve', summary: '标记已预定', data: "{ status: 'reserved' }" },
  },
  {
    id: 'errand',
    zh: '跑腿',
    pascal: 'Errand',
    model: 'ErrandTask',
    delegate: 'errandTask',
    ownerField: 'requesterId',
    readOnly: ['createdAt', 'updatedAt'],
    optionalCreate: ['runnerId', 'status'],
    fields: [
      ['requesterId', 'string'],
      ['runnerId', 'string?'],
      ['title', 'string'],
      ['detail', 'string?'],
      ['rewardFen', 'int'],
      ['fromPlace', 'string'],
      ['toPlace', 'string'],
      ['deadline', 'date'],
      ['status', 'string'],
      ['createdAt', 'date'],
      ['updatedAt', 'date'],
    ],
    action: {
      kind: 'update',
      name: 'accept',
      summary: '接单',
      data: "{ status: 'accepted', runnerId: actorId ?? null }",
      needsActor: true,
    },
  },
  // ⚠️ `buddy` **已移出 SPEC 表**（2026-10-17）：
  // 它的形状（三档降级 + pgvector 手写迁移 + `SELECT ... FOR UPDATE` 行锁事务 +
  // MMR 多样性重排 + 问卷答案→资料的白名单同步 + 一张可见性矩阵）
  // 远超"一套 CRUD + 一个动作"能表达的范围。因此与 auth / wellbeing /
  // dorm-harmony / ai-portrait / forum / faq / wildlife 一样**改为手写**，
  // 本脚本不再写盘（否则 `npm run scaffold` 会把手写实现覆盖掉）。
  // 详见 `src/modules/buddy/` 与 `docs/features/buddy-matching.md`。
  //
  // 脚手架阶段的占位模型 `BuddyGroup`（status='recruiting' / campusSpot）
  // 既不是冻结契约里的模型，也不承载规格 §3 的匹配特征，
  // 已由迁移 `20261017050000_buddy` 退休（DROP TABLE + 建 BuddyPost 等 7 张表）。
  {
    id: 'lost-found',
    zh: '失物招领',
    pascal: 'LostFound',
    model: 'LostFoundItem',
    delegate: 'lostFoundItem',
    ownerField: 'reporterId',
    readOnly: ['createdAt', 'updatedAt'],
    optionalCreate: ['status'],
    fields: [
      ['reporterId', 'string'],
      ['kind', 'string'],
      ['title', 'string'],
      ['description', 'string?'],
      ['place', 'string'],
      ['happenedAt', 'date'],
      ['contactHint', 'string?'],
      ['status', 'string'],
      ['createdAt', 'date'],
      ['updatedAt', 'date'],
    ],
    action: { kind: 'update', name: 'match', summary: '标记已匹配', data: "{ status: 'matched' }" },
  },
  {
    id: 'canteen',
    zh: '食堂营养',
    pascal: 'Canteen',
    model: 'CanteenDish',
    delegate: 'canteenDish',
    ownerField: null,
    readOnly: ['createdAt', 'updatedAt'],
    optionalCreate: [],
    fields: [
      ['canteen', 'string'],
      ['name', 'string'],
      ['caloriesKcal', 'int'],
      ['proteinG', 'int'],
      ['fatG', 'int'],
      ['carbG', 'int'],
      ['priceFen', 'int'],
      ['createdAt', 'date'],
      ['updatedAt', 'date'],
    ],
    action: { kind: 'custom', name: 'calories', summary: '按食堂汇总热量与均价' },
    customPort: `  summarizeByCanteen(
    canteen: string,
  ): Promise<{ dishes: number; totalCaloriesKcal: number; avgPriceFen: number }>;`,
    customRepository: `
  /** 按食堂汇总热量 / 均价（真实聚合查询） */
  async summarizeByCanteen(canteen: string): Promise<{ dishes: number; totalCaloriesKcal: number; avgPriceFen: number }> {
    const result = await this.prisma.canteenDish.aggregate({
      where: { canteen },
      _count: { _all: true },
      _sum: { caloriesKcal: true, priceFen: true },
    });
    const dishes = result._count._all;
    const totalPriceFen = result._sum.priceFen ?? 0;
    return {
      dishes,
      totalCaloriesKcal: result._sum.caloriesKcal ?? 0,
      avgPriceFen: dishes === 0 ? 0 : Math.round(totalPriceFen / dishes),
    };
  }`,
    customService: `
  /** 领域查询：某食堂的营养汇总 */
  calories(canteen: string) {
    return this.repo.summarizeByCanteen(canteen);
  }`,
    customController: `
  @Get('calories')
  @ApiOperation({ summary: '按食堂汇总热量与均价（整数分）' })
  calories(@Query('canteen') canteen: string) {
    if (!canteen) throw new ValidationError('canteen 必填', { canteen });
    return this.service.calories(canteen);
  }`,
  },
  /* ------------------------------------------------------------------ *
   * 已从 SPEC 表**移除**（改为手写，不再由本脚本生成）：
   *
   *   forum —— 版块目录 + 主题状态机 + 匿名身份 HMAC 派生 + 举报阈值治理
   *            + 回复子资源；「一套 CRUD + 一个动作」表达不了。
   *   faq   —— 条目检索 + 幂等「有用」投票 + 工单状态机 + 关键词建议排序。
   *
   * 与既有的 4 个手写模块同类：auth（两级身份）、wellbeing（同意门 + 审计 +
   * 危机热线）、dorm-harmony（匿名 + 同意门）、ai-portrait（同意门 + 禁读域）。
   * 这 6 个模块的目录**不会被本脚本写盘**，手写实现不会被 `npm run scaffold` 覆盖。
   * ------------------------------------------------------------------ */
  {
    id: 'facility',
    zh: '场馆预约',
    pascal: 'Facility',
    model: 'FacilityBooking',
    delegate: 'facilityBooking',
    ownerField: 'ownerId',
    readOnly: ['createdAt', 'updatedAt'],
    optionalCreate: ['status', 'facilityName'],
    fields: [
      ['ownerId', 'string'],
      ['kind', 'string'],
      ['facilityName', 'string?'],
      ['startsAt', 'date'],
      ['endsAt', 'date'],
      ['status', 'string'],
      ['feeFen', 'int'],
      ['createdAt', 'date'],
      ['updatedAt', 'date'],
    ],
    serviceImports: `import { ConflictError, ForbiddenError } from '../../common/errors/app-error';`,
    action: { kind: 'custom', name: 'cancel', summary: '发起人取消预约' },
    customPort: `  findOverlapping(input: {
    kind: string;
    facilityName: string | null;
    startsAt: Date;
    endsAt: Date;
  }): Promise<FacilityBookingModel | null>;`,
    customRepository: `
  /**
   * 时段冲突检测（同一场馆 + 同一时间段 + 未取消的预约）。
   * 半开区间 [startsAt, endsAt) 相交：existing.startsAt < new.endsAt && existing.endsAt > new.startsAt。
   */
  async findOverlapping(input: {
    kind: string;
    facilityName: string | null;
    startsAt: Date;
    endsAt: Date;
  }): Promise<FacilityBookingModel | null> {
    const row = await this.prisma.facilityBooking.findFirst({
      where: {
        kind: input.kind,
        status: 'booked',
        ...(input.facilityName ? { facilityName: input.facilityName } : {}),
        startsAt: { lt: input.endsAt },
        endsAt: { gt: input.startsAt },
      },
      orderBy: { startsAt: 'asc' },
    });
    return row ? (row as unknown as FacilityBookingModel) : null;
  }`,
    customCreate: `
  /**
   * 创建预约。
   *
   * 与其余模块不同：除了归属补全，还必须在**写库前**做两件事：
   *   1. 金额一律**整数分**（契约 §6.1）—— 非整数直接 VALIDATION_FAILED，不静默截断；
   *   2. 同一场馆同一时段不可重复预约 —— 冲突返回 CONFLICT。
   */
  override async create(input: CreateFacilityBookingInput, actorId?: string): Promise<FacilityBookingModel> {
    const owner = input.ownerId ?? actorId;
    if (!owner) {
      throw new ValidationError('未登录时必须显式提供 ownerId', { field: 'ownerId' });
    }
    if (!Number.isInteger(input.feeFen) || input.feeFen < 0) {
      throw new ValidationError('feeFen 必须是非负整数分（契约 §6.1 禁止浮点金额）', { field: 'feeFen' });
    }

    const startsAt = new Date(input.startsAt);
    const endsAt = new Date(input.endsAt);
    if (!(endsAt > startsAt)) {
      throw new ValidationError('endsAt 必须晚于 startsAt', { field: 'endsAt' });
    }

    const conflict = await this.repo.findOverlapping({
      kind: input.kind,
      facilityName: input.facilityName ?? null,
      startsAt,
      endsAt,
    });
    if (conflict) {
      throw new ConflictError('该时段已被预约', { conflictId: conflict.id });
    }

    return super.create({ ...input, ownerId: owner });
  }

  /** 领域动作：取消预约（仅发起人；只有 booked 可取消） */
  async cancel(id: string, actorId?: string): Promise<FacilityBookingModel> {
    const booking = await this.detail(id);
    if (!actorId || booking.ownerId !== actorId) {
      throw new ForbiddenError('只有发起人可以取消该预约');
    }
    if (booking.status !== 'booked') {
      throw new ConflictError('该预约当前状态不可取消', { status: booking.status });
    }
    return this.repo.update(id, { status: 'cancelled' } as UpdateFacilityBookingInput);
  }`,
    customController: `
  @Post('items/:id/cancel')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '取消预约（契约 §11.10-C 的领域动作；仅发起人）' })
  cancel(@CurrentUser() actorId: string, @Param('id') id: string) {
    return this.service.cancel(id, actorId);
  }`,
  },
  // ⚠️ `wildlife` **已移出 SPEC 表**（2026-10-17）：
  // 它的领域形状（四层位置模糊化 / EXIF 剥离 / DBSCAN 热点与推断轨迹 /
  // 受限精确坐标表 / 派生只读资源）远超"一套 CRUD + 一个动作"能表达的范围，
  // 因此与 auth / wellbeing / dorm-harmony / ai-portrait / forum / faq 一样
  // **改为手写**，本脚本不再写盘。详见
  // `src/modules/wildlife/` 与 `docs/features/wildlife-map.md`。
  //
  // ⚠️ `techpie` / `campus-card` / `schedule` **已移出 SPEC 表**（2026-10-17，
  // TechPie 整合 Phase 0 —— 规格 `docs/features/techpie-integration.md` §8.1，
  // 裁决 `00-FROZEN-CONTRACT.md` §11.18）：
  //   · `techpie`    —— 脚手架占位形状（key/name/category/url）与"校园平台绑定"
  //                     毫无关系。手写实现含：一次性 WebView 票据、cookie 的
  //                     **唯一出口**（不变式 I3）、白名单 fail-closed（§11.18-B）、
  //                     Phase 0 只有 `ecard` OPENID 一个写入者的会话保管库。
  //   · `campus-card`—— 它已经是手写的（`balanceSummary` + 第二级绑定门），
  //                     继续留在 SPEC 里意味着下一次 `npm run scaffold` 会覆盖它。
  //   · `schedule`   —— 课表是**校园能力**，必须挂 `CampusBindingGuard`
  //                     （不变式 I4：已登录但未绑定 → 409，不是 401）。
  // 三者一旦被覆盖，Phase 0 的合规约束（不代持 CASTGC）与 I3/I4 会**静默失效** ——
  // 这正是"必须移出 SPEC 表"的理由。
];

/* ------------------------------------------------------------------ *
 * 代码生成
 * ------------------------------------------------------------------ */

const HEADER = (zh, id) => `/**
 * ${zh} · ${id}（契约 §4）
 *
 * 本文件由 scripts/scaffold.mjs 生成；要改形状请改脚本里的 SPEC 表，
 * 改完重跑 \`npm run scaffold\`，避免各模块各写一套。
 *
 * （这里**刻意不写模块数**：以前写死了「14/15 个模块」，每次增删模块都会
 *   让所有已生成文件的注释行变一遍，产生 45 个文件的无意义 diff。）
 */`;

function domainFile(spec) {
  const { id, zh, model, fields, readOnly, optionalCreate, ownerField } = spec;
  const ro = new Set(readOnly);
  const opt = new Set(optionalCreate);

  // Prisma 每个模型都有 `id String @id @default(cuid())`，但 SPEC 的 fields 只列业务字段，
  // 因此必须在这里显式补上主键 —— 否则领域模型没有 id，CRUD 端口、findById 与测试全都无法工作。
  const modelFields = [
    '  id: string;',
    ...fields.map(([name, type]) => `  ${name}: ${tsType(type)};`),
  ].join('\n');

  const createFields = fields
    .filter(([name]) => !ro.has(name))
    .map(([name, type]) => {
      // 归属字段由 service.create 从请求主体补全（见 ownerNote），所以对调用方是可选的
      if (ownerField && name === ownerField) return `  ${name}?: ${TS_BASE[baseOf(type)]};`;
      if (isNullable(type)) return `  ${name}?: ${TS_BASE[baseOf(type)]} | null;`;
      if (opt.has(name)) return `  ${name}?: ${TS_BASE[baseOf(type)]};`;
      return `  ${name}: ${TS_BASE[baseOf(type)]};`;
    })
    .join('\n');

  const updateFields = fields
    .filter(([name]) => !ro.has(name))
    .map(([name, type]) => `  ${name}?: ${tsType(type)};`)
    .join('\n');

  const ownerNote = ownerField
    ? ` * 归属字段 \`${ownerField}\` 在未登录时可由请求主体补全（见 service.create）。`
    : ' * 本模块支持匿名（无必填归属字段），实名身份与匿名 handle 解耦存储（契约 §9）。';

  return `${HEADER(zh, id)}
import type { ResourceRepository } from '../../../common/crud/resource';

/** 领域模型：字段与 Prisma 行字段一一对应（domain 层不 import Prisma） */
export interface ${model}Model {
${modelFields}
}

/** 创建输入。${ownerNote} */
export interface Create${model}Input {
${createFields}
}

/** 更新输入（全部可选） */
export interface Update${model}Input {
${updateFields}
}

/** 端口：service 只依赖本类型，实现见 data/${id}.repository.ts */
export type ${model}Repository = ResourceRepository<
  ${model}Model,
  Create${model}Input,
  Update${model}Input
>${spec.customPort ? ` & {\n${spec.customPort}\n}` : ''};

export const ${tokenOf(model)} = Symbol('KEDAYA_${tokenOf(model)}');
`;
}

function repositoryFile(spec) {
  const { id, model, delegate, customRepository } = spec;

  return `${HEADER(spec.zh, id)}
import { Inject, Injectable } from '@nestjs/common';
import type { ${model} } from '@prisma/client';
import { PrismaCursorRepository } from '../../../common/crud/prisma-cursor.repository';
import { PrismaService } from '../../../prisma/prisma.service';
import type {
  Create${model}Input,
  ${model}Model,
  ${model}Repository,
  Update${model}Input,
} from '../domain/${id}.domain';

/**
 * data 层：唯一允许碰 IO 的地方（契约 §7 依赖方向 domain ← data）。
 * 输入字段名与 Prisma 字段一一对应，因此直接复用基类的恒等映射。
 */
@Injectable()
export class ${model}PrismaRepository
  extends PrismaCursorRepository<${model}, ${model}Model, Create${model}Input, Update${model}Input>
  implements ${model}Repository
{
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {
    super(prisma.${delegate});
  }
${customRepository ?? ''}}
`;
}

function serviceFile(spec) {
  const { id, zh, model, ownerField, customService, serviceImports, serviceCtorExtra } = spec;
  const token = tokenOf(model);

  // 始终 override create：即使模块无归属字段，也接受并忽略 actorId，
  // 这样 controller 的调用签名在 14 个模块间保持一致。
  // `override` 是必需的 —— tsconfig.base.json 开了 noImplicitOverride。
  //
  // 注意 ownerField 可能本身是 readOnly（例如 ProfileSetting.userId 由账号决定，
  // 不该出现在请求体里）——此时归属只能来自请求主体。
  const ownerInBody = ownerField !== null && !spec.readOnly.includes(ownerField);

  const generatedCreateOverride =
    ownerField === null
      ? `
  /** 本模块支持匿名，忽略请求主体（契约 §9：匿名与实名解耦） */
  override async create(input: Create${model}Input, _actorId?: string): Promise<${model}Model> {
    return super.create(input);
  }`
      : ownerInBody
        ? `
  /**
   * 创建。${ownerField} 允许由请求主体补全（未登录时必须在 body 里显式给出）。
   */
  override async create(input: Create${model}Input, actorId?: string): Promise<${model}Model> {
    const owner = input.${ownerField} ?? actorId;
    if (!owner) {
      throw new ValidationError('未登录时必须显式提供 ${ownerField}', { field: '${ownerField}' });
    }
    return super.create({ ...input, ${ownerField}: owner });
  }`
        : `
  /**
   * 创建。${ownerField} 是 readOnly（由账号决定，不接受请求体传入），
   * 因此必须已登录。
   */
  override async create(input: Create${model}Input, actorId?: string): Promise<${model}Model> {
    if (!actorId) {
      throw new ValidationError('该资源必须登录后创建', { field: '${ownerField}' });
    }
    return super.create({ ...input, ${ownerField}: actorId } as Create${model}Input);
  }`;

  // SPEC 可以用 customCreate 整体替换生成的 create（例如 facility 需要在写库前
  // 做"时段冲突"判定 —— 那不属于归属补全，塞进 owner 逻辑里会污染所有模块）。
  const createOverride = spec.customCreate ?? generatedCreateOverride;

  const ctorExtra = serviceCtorExtra ? `\n${serviceCtorExtra.trimEnd()}` : '';

  return `${HEADER(zh, id)}
import { Inject, Injectable } from '@nestjs/common';
import { CrudService } from '../../common/crud/crud.service';
import { ValidationError } from '../../common/errors/app-error';
${serviceImports ? `${serviceImports}\n` : ''}import {
  ${token},
  type Create${model}Input,
  type ${model}Model,
  type ${model}Repository,
  type Update${model}Input,
} from './domain/${id}.domain';

/**
 * 用例层（契约 §7）：只编排，不含 IO。
 * 依赖通过**显式 token** 注入（而非 design:paramtypes），
 * 这样在 vitest 等不做 emitDecoratorMetadata 的转译器下 DI 依然成立。
 */
@Injectable()
export class ${model}Service extends CrudService<${model}Model, Create${model}Input, Update${model}Input> {
  constructor(
    @Inject(${token}) private readonly repo: ${model}Repository,${ctorExtra}
  ) {
    super(repo, '${id}', '${zh}');
  }
${createOverride}${customService ?? ''}}
`;
}

function createSchemaBody(spec) {
  const ro = new Set(spec.readOnly);
  const opt = new Set(spec.optionalCreate);
  return spec.fields
    .filter(([name]) => !ro.has(name))
    .map(([name, type]) => {
      let zod = ZOD[type];
      if (!isNullable(type) && opt.has(name)) zod = `${zod}.optional()`;
      return `  ${name}: ${zod},`;
    })
    .join('\n');
}

function controllerFile(spec) {
  const { id, zh, model, action, customController, extraSchemas } = spec;
  const pascal = spec.pascal;

  const custom = customController ?? '';
  const usesAuthGuard = custom.includes('@UseGuards(AuthGuard)');
  const usesCurrentUser = custom.includes('@CurrentUser');
  const usesValidationError = custom.includes('ValidationError');
  const usesApiBearerAuth = custom.includes('ApiBearerAuth');

  const actionRoute =
    action.kind === 'update'
      ? `
  @Post('items/:id/${action.name}')
  @ApiOperation({ summary: '领域动作：${action.summary}' })
  ${
    action.needsActor
      ? `${action.name}(@OptionalCurrentUser() actorId: string | undefined, @Param('id') id: string) {\n    return this.service.${action.name}(id, actorId);\n  }`
      : `${action.name}(@Param('id') id: string) {\n    return this.service.${action.name}(id);\n  }`
  }`
      : '';

  return `${HEADER(zh, id)}
import { ${['Controller', 'Delete', 'Get', 'Inject', 'Param', 'Patch', 'Post', 'Query', 'UseGuards'].sort().join(', ')} } from '@nestjs/common';
import { ${['ApiOperation', 'ApiTags', ...(usesApiBearerAuth ? ['ApiBearerAuth'] : [])].sort().join(', ')} } from '@nestjs/swagger';
import { modulePath } from '@kedaya/contracts';
import { z } from 'zod';
import { ${['OptionalAuthGuard', ...(usesAuthGuard ? ['AuthGuard'] : [])].sort().join(', ')} } from '../../common/auth/auth.guard';
import { ${['OptionalCurrentUser', ...(usesCurrentUser ? ['CurrentUser'] : [])].sort().join(', ')} } from '../../common/auth/current-user';
${usesValidationError ? `import { ValidationError } from '../../common/errors/app-error';\n` : ''}import { normalizeLimit, readCursor } from '../../common/pagination/cursor';
import { ZodBody } from '../../common/pipes/zod-validation.pipe';
import { ${model}Service } from './${id}.service';
import type { Create${model}Input, Update${model}Input } from './domain/${id}.domain';

${extraSchemas ? `${extraSchemas}\n\n` : ''}const createSchema = z.object({
${createSchemaBody(spec)}
});

const updateSchema = createSchema.partial();

/**
 * 编译期防漂移断言：Zod 推导出的类型必须兼容 domain 声明的输入类型。
 * 只改了一边就会直接编译失败。
 */
type AssertAssignable<Target, _Actual extends Target> = true;
export type CreateSchemaMatchesDomain = AssertAssignable<Create${model}Input, z.infer<typeof createSchema>>;
export type UpdateSchemaMatchesDomain = AssertAssignable<Update${model}Input, z.infer<typeof updateSchema>>;

/**
 * 契约 §6.1 的统一 CRUD 形状：
 *   GET/POST /items, GET/PATCH/DELETE /items/:id, POST /items/:id/<action>
 */
@ApiTags('${id} · ${zh}')
@Controller(modulePath('${id}'))
@UseGuards(OptionalAuthGuard)
export class ${pascal}Controller {
  constructor(@Inject(${model}Service) private readonly service: ${model}Service) {}

  @Get('items')
  @ApiOperation({ summary: '列表（游标分页，契约 §6.1 不用 offset）' })
  list(@Query() query: Record<string, unknown>) {
    return this.service.list({ cursor: readCursor(query), limit: normalizeLimit(query.limit) });
  }

  @Post('items')
  @ApiOperation({ summary: '创建' })
  create(
    @OptionalCurrentUser() actorId: string | undefined,
    @ZodBody(createSchema) body: Create${model}Input,
  ) {
    return this.service.create(body, actorId);
  }

  @Get('items/:id')
  @ApiOperation({ summary: '详情' })
  detail(@Param('id') id: string) {
    return this.service.detail(id);
  }

  @Patch('items/:id')
  @ApiOperation({ summary: '更新' })
  update(@Param('id') id: string, @ZodBody(updateSchema) body: Update${model}Input) {
    return this.service.update(id, body);
  }

  @Delete('items/:id')
  @ApiOperation({ summary: '删除/下架' })
  async remove(@Param('id') id: string): Promise<{ id: string; deleted: true }> {
    await this.service.remove(id);
    return { id, deleted: true };
  }
${actionRoute}${custom}
}
`;
}

function moduleFile(spec) {
  const { id, zh, model } = spec;
  const pascal = spec.pascal;
  const token = tokenOf(model);
  const moduleImports = spec.moduleImports ? `${spec.moduleImports}\n` : '';
  const importsList = spec.moduleImportsList ? `  ${spec.moduleImportsList}\n` : '';

  return `${HEADER(zh, id)}
import { Module } from '@nestjs/common';
${moduleImports}import { ${pascal}Controller } from './${id}.controller';
import { ${model}Service } from './${id}.service';
import { ${model}PrismaRepository } from './data/${id}.repository';
import { ${token} } from './domain/${id}.domain';

@Module({
${importsList}  controllers: [${pascal}Controller],
  providers: [${model}Service, { provide: ${token}, useClass: ${model}PrismaRepository }],
  exports: [${model}Service],
})
export class ${pascal}Module {}
`;
}

/* ------------------------------------------------------------------ *
 * 组装领域动作（update 型）
 * ------------------------------------------------------------------ */
function withUpdateAction(spec) {
  const { action, model } = spec;
  if (!action || action.kind !== 'update') return spec;

  const signature = action.needsActor ? 'id: string, actorId?: string' : 'id: string';

  return {
    ...spec,
    customService: `
  /** 领域动作：${action.summary}（契约 §6.1 的 POST /items/:id/${action.name}） */
  async ${action.name}(${signature}): Promise<${model}Model> {
    await this.detail(id);
    return this.repo.update(id, ${action.data} as Update${model}Input);
  }
`,
  };
}

/* ------------------------------------------------------------------ *
 * 落盘
 * ------------------------------------------------------------------ */
let written = 0;
const summary = [];

for (const rawSpec of SPEC) {
  const spec = withUpdateAction(rawSpec);
  const dir = join(MODULES_DIR, spec.id);
  mkdirSync(join(dir, 'domain'), { recursive: true });
  mkdirSync(join(dir, 'data'), { recursive: true });

  const files = [
    [join(dir, 'domain', `${spec.id}.domain.ts`), domainFile(spec)],
    [join(dir, 'data', `${spec.id}.repository.ts`), repositoryFile(spec)],
    [join(dir, `${spec.id}.service.ts`), serviceFile(spec)],
    [join(dir, `${spec.id}.controller.ts`), controllerFile(spec)],
    [join(dir, `${spec.id}.module.ts`), moduleFile(spec)],
  ];

  for (const [path, content] of files) {
    writeFileSync(path, content, 'utf8');
    written += 1;
  }
  summary.push(`${spec.id.padEnd(14)} ${spec.model}`);
}

console.log(`[scaffold] 生成 ${SPEC.length} 个模块 / ${written} 个文件`);
for (const line of summary) console.log(`  · ${line}`);
