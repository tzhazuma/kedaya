#!/usr/bin/env node
/**
 * 可达鸭后端 · 模块脚手架
 *
 * 为什么存在这个脚本：
 *   契约 §4 的 19 个模块里，有 15 个是"同一套 CRUD 形状 + 各自的领域动作"
 *   （契约 §6.1：list / create / detail / patch / delete / <action>）。
 *   手写这 15 × 5 个文件既冗长又容易漂移。本脚本把**形状**固化下来，
 *   把**差异**（字段、领域动作）留在下面的 SPEC 表里，一次生成、可重复执行。
 *
 * 生成的分层（契约 §7）：
 *   domain/<id>.domain.ts   纯模型 + 端口（零框架依赖）
 *   data/<id>.repository.ts Prisma 实现（唯一碰 IO 的地方）
 *   <id>.service.ts         用例（controller → service → repository）
 *   <id>.controller.ts      路由 + Zod schema + Swagger
 *   <id>.module.ts          NestJS 装配
 *
 * 手写（不生成）的 4 个模块：auth（两级身份）、wellbeing（同意门 + 审计 +
 * 危机热线）、dorm-harmony（匿名 + 同意门）、ai-portrait（同意门 + 禁读域）。
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
 * SPEC：15 个"形状统一"的模块
 *
 *   readOnly    —— DB 管理的时间戳等，不进 create/update 输入
 *   optionalCreate —— Prisma 有 @default，创建时可省略
 *   ownerField  —— 未登录时可由 actorId 补全的归属字段
 *   action      —— 契约 §6.1 的领域动作（update = 状态流转；custom = 手写片段）
 * ------------------------------------------------------------------ */
const SPEC = [
  {
    id: 'schedule',
    zh: '课表',
    pascal: 'Schedule',
    model: 'ScheduleCourse',
    delegate: 'scheduleCourse',
    ownerField: 'userId',
    readOnly: ['createdAt', 'updatedAt'],
    optionalCreate: [],
    fields: [
      ['userId', 'string'],
      ['term', 'string'],
      ['courseName', 'string'],
      ['teacher', 'string?'],
      ['location', 'string?'],
      ['weekday', 'int'],
      ['startSlot', 'int'],
      ['endSlot', 'int'],
      ['createdAt', 'date'],
      ['updatedAt', 'date'],
    ],
    action: { kind: 'custom', name: 'upcoming', summary: '按学期 + 星期查询课表' },
    customPort: `  listByWeekday(term: string, weekday: number): Promise<ScheduleCourseModel[]>;`,
    customRepository: `
  /** 领域查询：某学期某天的课表（真实查询，非空壳） */
  async listByWeekday(term: string, weekday: number): Promise<ScheduleCourseModel[]> {
    return this.prisma.scheduleCourse.findMany({
      where: { term, weekday },
      orderBy: [{ startSlot: 'asc' }, { id: 'asc' }],
    });
  }`,
    customService: `
  /** 领域查询：某学期某天的课表 */
  listByWeekday(term: string, weekday: number): Promise<ScheduleCourseModel[]> {
    return this.repo.listByWeekday(term, weekday);
  }`,
    customController: `
  @Get('upcoming')
  @ApiOperation({ summary: '按学期 + 星期查询课表' })
  upcoming(@Query('term') term: string, @Query('weekday') weekday: string) {
    const parsed = Number(weekday);
    if (!term || !Number.isInteger(parsed) || parsed < 1 || parsed > 7) {
      throw new ValidationError('term 必填，weekday 必须是 1..7 的整数', { term, weekday });
    }
    return this.service.listByWeekday(term, parsed);
  }`,
  },
  {
    id: 'campus-card',
    zh: '校园卡',
    pascal: 'CampusCard',
    model: 'CampusCardTransaction',
    delegate: 'campusCardTransaction',
    ownerField: 'userId',
    readOnly: ['createdAt'],
    optionalCreate: [],
    fields: [
      ['userId', 'string'],
      ['amountFen', 'int'],
      ['direction', 'string'],
      ['merchant', 'string'],
      ['happenedAt', 'date'],
      ['balanceAfterFen', 'int'],
      ['createdAt', 'date'],
    ],
    // 契约 §9：campus-card 是 high 敏感，但**不设同意门**（登录/开卡即同意）
    serviceImports: `import { CampusBindingRequiredError } from '../../common/errors/app-error';
import { CAMPUS_SESSION_PORT, type CampusSessionPort } from '../auth/domain/auth.domain';`,
    serviceCtorExtra: `    @Inject(CAMPUS_SESSION_PORT) private readonly campusSession: CampusSessionPort,`,
    moduleImports: `import { AuthModule } from '../auth/auth.module';`,
    moduleImportsList: `imports: [AuthModule],`,
    action: { kind: 'custom', name: 'summary', summary: '余额/流水汇总（需第二级绑定）' },
    customPort: `  summarize(
    userId: string,
  ): Promise<{ totalOutFen: number; totalInFen: number; count: number }>;`,
    customRepository: `
  /** 汇总总支出 / 总充值（整数分） */
  async summarize(userId: string): Promise<{ totalOutFen: number; totalInFen: number; count: number }> {
    const [out, incoming] = await Promise.all([
      this.prisma.campusCardTransaction.aggregate({
        where: { userId, direction: 'out' },
        _sum: { amountFen: true },
        _count: { _all: true },
      }),
      this.prisma.campusCardTransaction.aggregate({
        where: { userId, direction: 'in' },
        _sum: { amountFen: true },
        _count: { _all: true },
      }),
    ]);
    return {
      totalOutFen: out._sum.amountFen ?? 0,
      totalInFen: incoming._sum.amountFen ?? 0,
      count: out._count._all + incoming._count._all,
    };
  }`,
    customService: `
  /**
   * 契约 §5 硬规则 3 的第二个落点：
   * 校园卡能力属于**第二级**，未绑定 → CAMPUS_BINDING_REQUIRED。
   * 注意本模块虽是 high 敏感，但**不设同意门**（契约 §9）。
   */
  async balanceSummary(userId: string) {
    const session = await this.campusSession.acquireSession(userId, 'CARD');
    if (!session) {
      throw new CampusBindingRequiredError('请先绑定校园卡系统（CARD）后再查看汇总', {
        platform: 'CARD',
      });
    }
    return this.repo.summarize(userId);
  }`,
    customController: `
  @Get('summary')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '流水汇总（第二级能力：未绑定返回 CAMPUS_BINDING_REQUIRED）' })
  summary(@CurrentUser() userId: string) {
    return this.service.balanceSummary(userId);
  }`,
  },
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
  {
    id: 'buddy',
    zh: '找搭子',
    pascal: 'Buddy',
    model: 'BuddyGroup',
    delegate: 'buddyGroup',
    ownerField: 'ownerId',
    readOnly: ['createdAt', 'updatedAt'],
    optionalCreate: ['status'],
    fields: [
      ['ownerId', 'string'],
      ['activity', 'string'],
      ['title', 'string'],
      ['campusSpot', 'string'],
      ['startsAt', 'date'],
      ['capacity', 'int'],
      ['status', 'string'],
      ['createdAt', 'date'],
      ['updatedAt', 'date'],
    ],
    action: { kind: 'update', name: 'close', summary: '结束招募', data: "{ status: 'closed' }" },
  },
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
  {
    id: 'forum',
    zh: '论坛',
    pascal: 'Forum',
    model: 'ForumPost',
    delegate: 'forumPost',
    ownerField: null,
    readOnly: ['createdAt', 'updatedAt'],
    optionalCreate: ['status'],
    fields: [
      ['board', 'string'],
      ['authorId', 'string?'],
      ['anonHandle', 'string?'],
      ['title', 'string'],
      ['body', 'string'],
      ['status', 'string'],
      ['createdAt', 'date'],
      ['updatedAt', 'date'],
    ],
    action: { kind: 'custom', name: 'reply', summary: '回复主题（真实写入 ForumReply）' },
    customPort: `  addReply(
    postId: string,
    input: { body: string; authorId?: string | null; anonHandle?: string | null },
  ): Promise<{ id: string; postId: string; body: string; createdAt: Date }>;
  listReplies(postId: string): Promise<Array<{ id: string; postId: string; body: string; createdAt: Date }>>;`,
    customRepository: `
  /** 回复主题（真实写入 ForumReply 关联表） */
  async addReply(
    postId: string,
    input: { body: string; authorId?: string | null; anonHandle?: string | null },
  ): Promise<{ id: string; postId: string; body: string; createdAt: Date }> {
    return this.prisma.forumReply.create({
      data: {
        postId,
        body: input.body,
        authorId: input.authorId ?? null,
        anonHandle: input.anonHandle ?? null,
      },
      select: { id: true, postId: true, body: true, createdAt: true },
    });
  }

  listReplies(postId: string) {
    return this.prisma.forumReply.findMany({
      where: { postId },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });
  }`,
    customService: `
  /** 领域动作：回复主题（契约 §9：支持匿名，与实名身份解耦存储） */
  reply(id: string, body: string, actorId?: string, anonHandle?: string) {
    return this.repo.addReply(id, { body, authorId: actorId ?? null, anonHandle: anonHandle ?? null });
  }

  replies(id: string) {
    return this.repo.listReplies(id);
  }`,
    customController: `
  @Post('items/:id/reply')
  @ApiOperation({ summary: '回复主题（实名或匿名，匿名与实名解耦存储）' })
  reply(
    @OptionalCurrentUser() actorId: string | undefined,
    @Param('id') id: string,
    @ZodBody(replySchema) body: z.infer<typeof replySchema>,
  ) {
    return this.service.reply(id, body.body, actorId, body.anonHandle);
  }

  @Get('items/:id/replies')
  @ApiOperation({ summary: '主题回复列表' })
  replies(@Param('id') id: string) {
    return this.service.replies(id);
  }`,
    extraSchemas: `const replySchema = z.object({
  body: z.string().min(1).max(5000),
  anonHandle: z.string().min(1).max(64).optional(),
});`,
  },
  {
    id: 'faq',
    zh: '常见问题',
    pascal: 'Faq',
    model: 'FaqEntry',
    delegate: 'faqEntry',
    ownerField: null,
    readOnly: ['createdAt', 'updatedAt'],
    optionalCreate: ['tags', 'helpfulCount'],
    fields: [
      ['question', 'string'],
      ['answer', 'string'],
      ['category', 'string'],
      ['tags', 'string[]'],
      ['helpfulCount', 'int'],
      ['createdAt', 'date'],
      ['updatedAt', 'date'],
    ],
    action: { kind: 'custom', name: 'helpful', summary: '标记有用（计数自增）' },
    customPort: `  markHelpful(id: string): Promise<FaqEntryModel>;`,
    customRepository: `
  /** 原子自增：并发下不会丢计数 */
  async markHelpful(id: string): Promise<FaqEntryModel> {
    return this.prisma.faqEntry.update({
      where: { id },
      data: { helpfulCount: { increment: 1 } },
    });
  }`,
    customService: `
  /** 领域动作：标记有用 */
  async markHelpful(id: string): Promise<FaqEntryModel> {
    await this.detail(id);
    return this.repo.markHelpful(id);
  }`,
    customController: `
  @Post('items/:id/helpful')
  @ApiOperation({ summary: '标记该条目有用（原子自增）' })
  markHelpful(@Param('id') id: string) {
    return this.service.markHelpful(id);
  }`,
  },
  {
    id: 'techpie',
    zh: 'TechPie 整合',
    pascal: 'Techpie',
    model: 'TechpieLink',
    delegate: 'techpieLink',
    ownerField: null,
    readOnly: ['createdAt', 'updatedAt'],
    optionalCreate: ['status'],
    fields: [
      ['key', 'string'],
      ['name', 'string'],
      ['category', 'string'],
      ['url', 'string'],
      ['status', 'string'],
      ['createdAt', 'date'],
      ['updatedAt', 'date'],
    ],
    action: { kind: 'update', name: 'sync', summary: '触发一次同步', data: "{ status: 'synced' }" },
  },
  {
    id: 'wildlife',
    zh: '猫鸟黑天鹅',
    pascal: 'Wildlife',
    model: 'WildlifeSpot',
    delegate: 'wildlifeSpot',
    ownerField: null,
    readOnly: ['createdAt', 'updatedAt'],
    optionalCreate: ['status'],
    fields: [
      ['species', 'string'],
      ['place', 'string'],
      ['lat', 'float'],
      ['lng', 'float'],
      ['note', 'string?'],
      ['reportedBy', 'string?'],
      ['status', 'string'],
      ['createdAt', 'date'],
      ['updatedAt', 'date'],
    ],
    action: { kind: 'update', name: 'confirm', summary: '确认为有效活动点', data: "{ status: 'confirmed' }" },
  },
];

/* ------------------------------------------------------------------ *
 * 代码生成
 * ------------------------------------------------------------------ */

const HEADER = (zh, id) => `/**
 * ${zh} · ${id}（契约 §4）
 *
 * 本文件由 scripts/scaffold.mjs 生成；要改形状请改脚本里的 SPEC 表，
 * 改完重跑 \`npm run scaffold\`，避免 15 个模块各写一套。
 */`;

function domainFile(spec) {
  const { id, zh, model, fields, readOnly, optionalCreate, ownerField } = spec;
  const ro = new Set(readOnly);
  const opt = new Set(optionalCreate);

  const modelFields = fields.map(([name, type]) => `  ${name}: ${tsType(type)};`).join('\n');

  const createFields = fields
    .filter(([name]) => !ro.has(name))
    .map(([name, type]) => {
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
  // 这样 controller 的调用签名在 15 个模块间保持一致。
  // `override` 是必需的 —— tsconfig.base.json 开了 noImplicitOverride。
  //
  // 注意 ownerField 可能本身是 readOnly（例如 ProfileSetting.userId 由账号决定，
  // 不该出现在请求体里）——此时归属只能来自请求主体。
  const ownerInBody = ownerField !== null && !spec.readOnly.includes(ownerField);

  const createOverride =
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
type AssertAssignable<Target, Actual extends Target> = true;
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
