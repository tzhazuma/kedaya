/**
 * 可达鸭 · 演示数据 seed（开发 / 演示环境）
 *
 * 为什么需要它：
 *   没有 seed 时，本地或演示环境打开小程序是**一片空白** —— 每个列表页都是空态。
 *   "UI 好不好看、交互顺不顺"根本无从判断，评审也无从进行。
 *
 * 设计约束：
 *   1. **幂等**：可重复执行。先按 `seed_` id 前缀精确清除上一轮写入的行，再重新写入，
 *      既不重复堆积，也**绝不触碰**真实用户数据（只删 id 以 `seed_` 开头的行）。
 *   2. **可辨识**：所有行的 id 都以 `seed_` 开头，一眼能看出是演示数据。
 *      演示账号统一密码 `Kedaya2026`，仅在非生产环境使用。
 *   3. **不造假数据**：这里的课表/余额/流水是"看起来合理"的**演示内容**，
 *      真实数据必须经 `CampusSessionPort` 拉取（契约 §5）。因此本文件不写入
 *      任何实名、证件号级别的敏感字段，也不预置校园系统绑定（留给用户在 App 里真实绑定）。
 *   4. **生产环境拒绝执行**：除非显式设置 `SEED_FORCE=1`。
 *
 * 运行：`npm run prisma:seed -w @kedaya/api`（`prisma migrate dev` 也会自动触发）
 *
 * 关于模块写法：本文件用 CJS 的 `require` 而不是 `import`。
 *   services/api 的 package.json 没有 `"type": "module"`（产物是 CommonJS），
 *   若这里写 ESM 语法，Node 每次都会打印 MODULE_TYPELESS_PACKAGE_JSON 警告并重新解析。
 *   同时它**刻意不 import `src/**`**：那些文件用 extensionless 相对导入，
 *   Node 的类型剥离在运行时解析不了；seed 只依赖 node 内置模块与 Prisma。
 */

const { randomBytes, scryptSync } = require('node:crypto') as typeof import('node:crypto');
const { PrismaPg } = require('@prisma/adapter-pg') as typeof import('@prisma/adapter-pg');
const { PrismaClient } = require('@prisma/client') as typeof import('@prisma/client');

/** `PrismaClient` 是值（class），做参数类型需要取实例类型 */
type Db = InstanceType<typeof PrismaClient>;

// Prisma 7 不再自动读 .env（与 prisma.config.ts 保持一致的做法）
try {
  process.loadEnvFile('.env');
} catch {
  // 容器 / CI 里直接用环境变量注入，.env 不存在属正常情况
}

const DEMO_PASSWORD = 'Kedaya2026';

/** 所有演示行的 id 前缀 —— 幂等清理的唯一依据 */
const TAG = 'seed_';
const id = (suffix: string): string => `${TAG}${suffix}`;

const SCRYPT_N = 16_384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

/**
 * 与 `src/modules/auth/domain/password.ts` 的 `hashPassword` **格式保持一致**：
 * `scrypt$N$r$p$saltB64$hashB64`。
 * 刻意重复实现而不 import：seed 必须能被 `node prisma/seed.ts` 直接跑起来，
 * 不能依赖 `src/**` 的扩展名省略导入（见文件头注释）。
 */
function hashPassword(password: string): string {
  const salt = randomBytes(SALT_LENGTH);
  const derived = scryptSync(password, salt, KEY_LENGTH, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  return [
    'scrypt',
    String(SCRYPT_N),
    String(SCRYPT_R),
    String(SCRYPT_P),
    salt.toString('base64'),
    derived.toString('base64'),
  ].join('$');
}

/** 安全的数组取模取值（`noUncheckedIndexedAccess` 下不产生 `T | undefined`） */
function pick<T>(list: readonly T[], index: number): T {
  const item = list[index % list.length];
  if (item === undefined) throw new Error('pick() 收到了空数组');
  return item;
}

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

function shiftDays(base: Date, days: number): Date {
  return new Date(base.getTime() + days * DAY);
}

function shiftHours(base: Date, hours: number): Date {
  return new Date(base.getTime() + hours * HOUR);
}

/**
 * 学期标识，规则与 `modules/schedule/domain/timetable.domain.ts` 的 `termOf` 一致：
 *   9 月 – 次年 1 月 → 本学年第一学期；2 月 – 8 月 → 上一学年第二学期。
 */
function termOf(date: Date): string {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  if (month >= 9) return `${year}-${year + 1}-1`;
  if (month === 1) return `${year - 1}-${year}-1`;
  return `${year - 1}-${year}-2`;
}

/* ------------------------------------------------------------------ *
 * 演示主体
 * ------------------------------------------------------------------ */

interface SeedUser {
  key: string;
  email: string;
  displayName: string;
  department: string;
}

const USERS: readonly SeedUser[] = [
  { key: 'demo', email: 'demo@kedaya.dev', displayName: '林知遥', department: '信息科学与技术学院' },
  { key: 'zhang', email: 'zhang.yf@kedaya.dev', displayName: '张逸凡', department: '生命科学与技术学院' },
  { key: 'chen', email: 'chen.mx@kedaya.dev', displayName: '陈慕兮', department: '物质科学与技术学院' },
  { key: 'liu', email: 'liu.zy@kedaya.dev', displayName: '刘子瑜', department: '信息科学与技术学院' },
  { key: 'wang', email: 'wang.h@kedaya.dev', displayName: '王涵', department: '生物医学工程学院' },
  { key: 'zhou', email: 'zhou.qr@kedaya.dev', displayName: '周秋然', department: '数学科学研究所' },
];

function userId(key: string): string {
  return id(`u_${key}`);
}

/* ------------------------------------------------------------------ *
 * 清库（只清演示行）
 * ------------------------------------------------------------------ */

async function purge(prisma: Db): Promise<void> {
  const byIdPrefix = (where = {}) => ({ id: { startsWith: TAG }, ...where });

  // 子表 → 父表，避免外键阻塞（虽然有 onDelete: Cascade，显式顺序更可控）
  await prisma.forumReply.deleteMany({ where: byIdPrefix() });
  await prisma.forumPost.deleteMany({ where: byIdPrefix() });
  await prisma.buddyMember.deleteMany({ where: byIdPrefix() });
  await prisma.buddyGroup.deleteMany({ where: byIdPrefix() });
  await prisma.groupbuyMember.deleteMany({ where: byIdPrefix() });
  await prisma.groupbuyOrder.deleteMany({ where: byIdPrefix() });
  await prisma.fleaItem.deleteMany({ where: byIdPrefix() });
  await prisma.errandTask.deleteMany({ where: byIdPrefix() });
  await prisma.lostFoundItem.deleteMany({ where: byIdPrefix() });
  await prisma.scheduleCourse.deleteMany({ where: byIdPrefix() });
  await prisma.campusCardTransaction.deleteMany({ where: byIdPrefix() });
  await prisma.notification.deleteMany({ where: byIdPrefix() });
  await prisma.profileSetting.deleteMany({ where: byIdPrefix() });
  await prisma.userCredential.deleteMany({ where: byIdPrefix() });
  await prisma.user.deleteMany({ where: byIdPrefix() });

  // 与用户无关的公共演示数据
  await prisma.canteenDish.deleteMany({ where: byIdPrefix() });
  await prisma.techpieLink.deleteMany({ where: byIdPrefix() });
  await prisma.wildlifeSpot.deleteMany({ where: byIdPrefix() });
  await prisma.faqEntry.deleteMany({ where: byIdPrefix() });
  await prisma.takeoutReport.deleteMany({ where: byIdPrefix() });
}

/* ------------------------------------------------------------------ *
 * 写入
 * ------------------------------------------------------------------ */

async function seedUsers(prisma: Db, now: Date): Promise<void> {
  for (const [index, user] of USERS.entries()) {
    const accountId = userId(user.key);
    const registeredAt = shiftDays(now, -180 + index * 12);

    await prisma.user.create({
      data: {
        id: accountId,
        displayName: user.displayName,
        avatarUrl: null,
        department: user.department,
        anonEnabled: true,
        createdAt: registeredAt,
        updatedAt: registeredAt,
        credential: {
          create: {
            id: id(`uc_${user.key}`),
            email: user.email,
            passwordHash: hashPassword(DEMO_PASSWORD),
            status: 'active',
            passwordChangedAt: registeredAt,
            lastLoginAt: shiftHours(now, -6 - index),
            createdAt: registeredAt,
            updatedAt: registeredAt,
          },
        },
        profileSetting: {
          create: {
            id: id(`ps_${user.key}`),
            // 默认开关一律关闭 —— 与线上默认值一致，用户主动开启才有数据。
            showRealName: false,
            allowAiPortrait: false,
            allowWellbeing: false,
            allowDormHarmony: false,
            themeMode: 'system',
            createdAt: registeredAt,
            updatedAt: registeredAt,
          },
        },
      },
    });
  }
}

async function seedSchedule(prisma: Db, now: Date): Promise<void> {
  const term = termOf(now);

  const demoCourses = [
    { name: '计算机体系结构', teacher: '陈立', location: '信息学院 1-301', weekday: 1, startSlot: 1, endSlot: 2 },
    { name: '概率论与数理统计', teacher: '周慧敏', location: '教学楼 2-205', weekday: 1, startSlot: 3, endSlot: 4 },
    { name: '人工智能导论', teacher: '李澄', location: '信息学院 1-102', weekday: 2, startSlot: 1, endSlot: 2 },
    { name: '大学物理（下）', teacher: '吴楠', location: '教学楼 3-401', weekday: 2, startSlot: 5, endSlot: 6 },
    { name: '编译原理', teacher: '沈亦然', location: '信息学院 1-305', weekday: 3, startSlot: 3, endSlot: 4 },
    { name: '英语学术写作', teacher: 'Emily Carter', location: '文科楼 2-108', weekday: 4, startSlot: 1, endSlot: 2 },
    { name: '机器学习实验', teacher: '李澄', location: '信息学院 实验中心 B2', weekday: 4, startSlot: 7, endSlot: 9 },
    { name: '体育（羽毛球）', teacher: '赵鹏', location: '体育馆 2 号场', weekday: 5, startSlot: 3, endSlot: 4 },
  ] as const;

  for (const [index, course] of demoCourses.entries()) {
    await prisma.scheduleCourse.create({
      data: {
        id: id(`sc_demo_${String(index + 1).padStart(2, '0')}`),
        userId: userId('demo'),
        term,
        courseName: course.name,
        teacher: course.teacher,
        location: course.location,
        weekday: course.weekday,
        startSlot: course.startSlot,
        endSlot: course.endSlot,
      },
    });
  }

  const zhangCourses = [
    { name: '分子生物学', teacher: '孙铭', location: '生命学院 3-201', weekday: 1, startSlot: 5, endSlot: 6 },
    { name: '生物统计学', teacher: '何雪', location: '生命学院 3-105', weekday: 2, startSlot: 3, endSlot: 4 },
    { name: '细胞生物学实验', teacher: '孙铭', location: '生命学院 实验楼 A1', weekday: 3, startSlot: 1, endSlot: 4 },
    { name: '文献阅读与研讨', teacher: '林馥', location: '生命学院 3-308', weekday: 4, startSlot: 5, endSlot: 6 },
    { name: '生物信息学', teacher: '徐嘉', location: '信息学院 1-210', weekday: 5, startSlot: 1, endSlot: 2 },
  ] as const;

  for (const [index, course] of zhangCourses.entries()) {
    await prisma.scheduleCourse.create({
      data: {
        id: id(`sc_zhang_${String(index + 1).padStart(2, '0')}`),
        userId: userId('zhang'),
        term,
        courseName: course.name,
        teacher: course.teacher,
        location: course.location,
        weekday: course.weekday,
        startSlot: course.startSlot,
        endSlot: course.endSlot,
      },
    });
  }
}

async function seedCampusCard(prisma: Db, now: Date): Promise<void> {
  // 从最早到最新构造一条自洽的余额链（balanceAfterFen 必须首尾相接，
  // 否则「流水对不上余额」这种假数据一眼就能看穿）。
  const entries = [
    { merchant: '校园卡在线充值', amountFen: 50_000, direction: 'in', hoursAgo: 168 },
    { merchant: '第一食堂 · 二层', amountFen: -1_850, direction: 'out', hoursAgo: 150 },
    { merchant: '校园超市（学生中心店）', amountFen: -2_360, direction: 'out', hoursAgo: 146 },
    { merchant: '图书馆 · 超期滞纳金', amountFen: -500, direction: 'out', hoursAgo: 120 },
    { merchant: '第二食堂 · 一层', amountFen: -1_420, direction: 'out', hoursAgo: 98 },
    { merchant: '自助咖啡机（信息学院）', amountFen: -800, direction: 'out', hoursAgo: 96 },
    { merchant: '校园卡在线充值', amountFen: 20_000, direction: 'in', hoursAgo: 72 },
    { merchant: '校车（张江—徐汇）', amountFen: -600, direction: 'out', hoursAgo: 70 },
    { merchant: '第三食堂 · 风味窗口', amountFen: -1_980, direction: 'out', hoursAgo: 50 },
    { merchant: '体育馆 · 场地费', amountFen: -1_200, direction: 'out', hoursAgo: 47 },
    { merchant: '洗衣房（生活区 7 号楼）', amountFen: -400, direction: 'out', hoursAgo: 26 },
    { merchant: '第二食堂 · 一层', amountFen: -1_560, direction: 'out', hoursAgo: 22 },
    { merchant: '打印店（教学楼 2 号楼）', amountFen: -300, direction: 'out', hoursAgo: 9 },
    { merchant: '第一食堂 · 二层', amountFen: -1_680, direction: 'out', hoursAgo: 3 },
  ] as const;

  // 反推起始余额，使最终余额落在 60~90 元这个"不高不低"的区间：
  // 既不是 0（会触发低余额提醒，掩盖正常态），也不像假数据那样大方。
  const totalIn = entries.filter((e) => e.amountFen > 0).reduce((sum, e) => sum + e.amountFen, 0);
  const totalOut = entries.filter((e) => e.amountFen < 0).reduce((sum, e) => sum + e.amountFen, 0);
  const targetFinal = 7_420;
  let balance = targetFinal - totalIn - totalOut;

  for (const [index, entry] of entries.entries()) {
    balance += entry.amountFen;
    await prisma.campusCardTransaction.create({
      data: {
        id: id(`cc_${String(index + 1).padStart(2, '0')}`),
        userId: userId('demo'),
        amountFen: Math.abs(entry.amountFen),
        direction: entry.direction,
        merchant: entry.merchant,
        happenedAt: shiftHours(now, -entry.hoursAgo),
        balanceAfterFen: balance,
        createdAt: shiftHours(now, -entry.hoursAgo),
      },
    });
  }
}

async function seedGroupbuy(prisma: Db, now: Date): Promise<void> {
  const orders = [
    {
      owner: 'demo',
      title: '山姆 4L 洗衣液拼一箱（分装）',
      description: '整箱 4 瓶，每人 1 瓶，明天下午生活区七号楼自提。',
      category: 'supplies',
      targetCount: 4,
      unitPriceFen: 3_280,
      status: 'open',
      deadlineDays: 2,
      pickupSpot: '生活区 7 号楼一层大厅',
      members: ['demo', 'zhang'],
    },
    {
      owner: 'zhang',
      title: '咖啡豆拼单（250g 均分，4 人成团）',
      description: '1kg 装分成 4 份，现磨现分，信息学院自提。',
      category: 'drink',
      targetCount: 4,
      unitPriceFen: 6_500,
      status: 'grouped',
      deadlineDays: 1,
      pickupSpot: '信息学院 1 号楼咖啡吧',
      members: ['zhang', 'demo', 'chen', 'liu'],
    },
    {
      owner: 'chen',
      title: '考研数学全套资料团购',
      description: '三人成团走出版社折扣，纸质版包邮到校。',
      category: 'other',
      targetCount: 3,
      unitPriceFen: 8_900,
      status: 'open',
      deadlineDays: 5,
      pickupSpot: '图书馆一层快递架',
      members: ['chen'],
    },
    {
      owner: 'liu',
      title: '羽毛球拍 Victor 拍线拼单',
      description: '满 5 支包邮，拍线颜色可备注。',
      category: 'other',
      targetCount: 5,
      unitPriceFen: 2_400,
      status: 'open',
      deadlineDays: 4,
      pickupSpot: '体育馆前台',
      members: ['liu', 'wang'],
    },
    {
      owner: 'wang',
      title: '螺蛳粉 10 包装（广西直发）',
      description: '整箱 10 包，按包分摊，凑够 5 人下单。',
      category: 'food',
      targetCount: 5,
      unitPriceFen: 1_580,
      status: 'open',
      deadlineDays: 3,
      pickupSpot: '生活区 5 号楼快递柜',
      members: ['wang', 'zhou', 'chen'],
    },
    {
      owner: 'zhou',
      title: '人体工学椅拼单（同款团购价）',
      description: '同款凑 3 把走厂家团购价，宿舍自提需自备工具。',
      category: 'supplies',
      targetCount: 3,
      unitPriceFen: 42_900,
      status: 'grouped',
      deadlineDays: 6,
      pickupSpot: '生活区 3 号楼',
      members: ['zhou', 'liu', 'wang'],
    },
    {
      owner: 'demo',
      title: '牛奶整箱拼单（1L × 12）',
      description: '保质期充足，按盒分摊，冷藏请自备冰箱空间。',
      category: 'food',
      targetCount: 6,
      unitPriceFen: 1_250,
      status: 'open',
      deadlineDays: 7,
      pickupSpot: '第二食堂门口',
      members: ['demo'],
    },
    {
      owner: 'chen',
      title: '打印纸 A4 70g 拼单（5 包/份）',
      description: '实验室常备耗材，凑 4 份走批发价。',
      category: 'supplies',
      targetCount: 4,
      unitPriceFen: 1_890,
      status: 'closed',
      deadlineDays: -2,
      pickupSpot: '教学楼 2 号楼打印店',
      members: ['chen', 'demo', 'zhang', 'liu'],
    },
  ] as const;

  for (const [index, order] of orders.entries()) {
    const orderId = id(`go_${String(index + 1).padStart(2, '0')}`);
    const createdAt = shiftDays(now, -6 + index);

    await prisma.groupbuyOrder.create({
      data: {
        id: orderId,
        ownerId: userId(order.owner),
        title: order.title,
        description: order.description,
        category: order.category,
        targetCount: order.targetCount,
        unitPriceFen: order.unitPriceFen,
        status: order.status,
        deadline: shiftDays(now, order.deadlineDays),
        pickupSpot: order.pickupSpot,
        createdAt,
        updatedAt: createdAt,
      },
    });

    for (const [memberIndex, memberKey] of order.members.entries()) {
      await prisma.groupbuyMember.create({
        data: {
          id: id(`gm_${String(index + 1).padStart(2, '0')}_${String(memberIndex + 1).padStart(2, '0')}`),
          orderId,
          userId: userId(memberKey),
          quantity: 1,
          paidFen: 0,
          role: memberKey === order.owner ? 'owner' : 'member',
          joinedAt: shiftHours(createdAt, memberIndex + 1),
        },
      });
    }
  }
}

async function seedFleaMarket(prisma: Db, now: Date): Promise<void> {
  const items = [
    { seller: 'demo', title: '捷安特 ATX 山地车（骑行两年）', priceFen: 48_000, category: 'sports', condition: 'good', spot: '生活区 7 号楼车棚', status: 'on-sale', desc: '毕业出，链条刚换过，刹车灵敏，可校内试骑。' },
    { seller: 'zhang', title: 'Dell U2419H 24 寸显示器', priceFen: 72_000, category: 'electronics', condition: 'like-new', spot: '生命学院 3 号楼', status: 'on-sale', desc: '自带旋转支架，无坏点，附原装电源线。' },
    { seller: 'chen', title: '《线性代数应该这样学》等教材四本', priceFen: 3_500, category: 'books', condition: 'good', spot: '图书馆一层', status: 'on-sale', desc: '有少量笔记，不影响阅读，打包价。' },
    { seller: 'liu', title: '雅马哈 F310 民谣吉他', priceFen: 39_900, category: 'other', condition: 'good', spot: '学生中心 2 楼', status: 'reserved', desc: '含琴包与变调夹，音准正常。' },
    { seller: 'wang', title: '小米吹风机 H500', priceFen: 8_900, category: 'daily', condition: 'like-new', spot: '生活区 5 号楼', status: 'on-sale', desc: '买重了，几乎没用过，包装还在。' },
    { seller: 'zhou', title: '小熊电煮锅（带蒸笼）', priceFen: 6_900, category: 'daily', condition: 'good', spot: '生活区 3 号楼', status: 'sold', desc: '宿舍煮面神器，已售出。' },
    { seller: 'demo', title: 'Keychron K2 机械键盘', priceFen: 32_000, category: 'electronics', condition: 'good', spot: '信息学院 1 号楼', status: 'on-sale', desc: '茶轴，蓝牙/有线双模，键帽无打油。' },
    { seller: 'zhang', title: '人体工学记忆棉靠垫', priceFen: 4_500, category: 'daily', condition: 'fair', spot: '生命学院 3 号楼', status: 'on-sale', desc: '用了一学期，套子可拆洗。' },
    { seller: 'chen', title: '篮球 Spalding 7 号（室外场）', priceFen: 9_900, category: 'sports', condition: 'good', spot: '体育馆门口', status: 'on-sale', desc: '手感尚可，适合室外场地。' },
    { seller: 'liu', title: 'AirPods 2 保护壳 + 无线充电板', priceFen: 2_000, category: 'electronics', condition: 'new', spot: '生活区 7 号楼', status: 'on-sale', desc: '全新未拆，颜色为浅灰。' },
  ] as const;

  for (const [index, item] of items.entries()) {
    const createdAt = shiftDays(now, -9 + index * 0.7);
    await prisma.fleaItem.create({
      data: {
        id: id(`fl_${String(index + 1).padStart(2, '0')}`),
        sellerId: userId(item.seller),
        title: item.title,
        description: item.desc,
        priceFen: item.priceFen,
        category: item.category,
        condition: item.condition,
        campusSpot: item.spot,
        status: item.status,
        reservedById: item.status === 'reserved' ? userId('wang') : null,
        soldAt: item.status === 'sold' ? shiftDays(now, -1) : null,
        createdAt,
        updatedAt: createdAt,
      },
    });
  }
}

async function seedErrands(prisma: Db, now: Date): Promise<void> {
  const tasks = [
    { requester: 'chen', runner: null, title: '帮忙取西门快递（一个小箱）', rewardFen: 500, from: '西门外菜鸟驿站', to: '生活区 7 号楼', status: 'open', deadlineDays: 0.5, detail: '快递号已发，取件码可私聊。' },
    { requester: 'demo', runner: 'liu', title: '带一份第一食堂二楼的红烧肉饭', rewardFen: 400, from: '第一食堂二层', to: '信息学院 1-301', status: 'accepted', deadlineDays: 0.2, detail: '不要香菜，谢谢！' },
    { requester: 'wang', runner: null, title: '帮我把实验报告交到行政楼 208', rewardFen: 600, from: '生命学院 3 号楼', to: '行政楼 208', status: 'open', deadlineDays: 1, detail: '今天下午 5 点前必须交，急。' },
    { requester: 'zhou', runner: 'zhang', title: '图书馆还三本书', rewardFen: 300, from: '生活区 3 号楼', to: '图书馆一层自助机', status: 'delivered', deadlineDays: -0.5, detail: '书在三楼桌上，已打包好。' },
    { requester: 'liu', runner: null, title: '打印一叠实验讲义（约 30 页）', rewardFen: 700, from: '教学楼 2 号楼打印店', to: '信息学院 1-210', status: 'open', deadlineDays: 2, detail: '双面黑白，文件我发电子版。' },
    { requester: 'zhang', runner: 'demo', title: '帮忙买一盒创可贴', rewardFen: 500, from: '校园超市（学生中心店）', to: '体育馆', status: 'completed', deadlineDays: -2, detail: '打球蹭破手了，感谢！' },
    { requester: 'demo', runner: null, title: '帮忙带一杯美式（无糖）', rewardFen: 400, from: '信息学院咖啡吧', to: '教学楼 3-401', status: 'open', deadlineDays: 0.3, detail: '课间休息时间送到就行。' },
    { requester: 'chen', runner: null, title: '帮忙把充电宝送到图书馆三楼', rewardFen: 300, from: '生活区 5 号楼', to: '图书馆三楼自习区', status: 'cancelled', deadlineDays: -1, detail: '已经自己回去拿了，取消。' },
  ] as const;

  for (const [index, task] of tasks.entries()) {
    const createdAt = shiftDays(now, -4 + index * 0.4);
    await prisma.errandTask.create({
      data: {
        id: id(`er_${String(index + 1).padStart(2, '0')}`),
        requesterId: userId(task.requester),
        runnerId: task.runner === null ? null : userId(task.runner),
        title: task.title,
        detail: task.detail,
        rewardFen: task.rewardFen,
        fromPlace: task.from,
        toPlace: task.to,
        deadline: shiftDays(now, task.deadlineDays),
        status: task.status,
        acceptedAt: task.runner === null ? null : shiftHours(createdAt, 2),
        deliveredAt: task.status === 'delivered' || task.status === 'completed' ? shiftHours(createdAt, 6) : null,
        settledAt: task.status === 'completed' ? shiftHours(createdAt, 8) : null,
        createdAt,
        updatedAt: createdAt,
      },
    });
  }
}

async function seedBuddy(prisma: Db, now: Date): Promise<void> {
  const groups = [
    { owner: 'demo', activity: 'sport', title: '每周二四晨跑 5 公里', spot: '操场', daysAhead: 1, capacity: 4, status: 'recruiting', desc: '配速 6 分左右，跑完一起吃早饭。', members: ['demo', 'liu'] },
    { owner: 'zhang', activity: 'study', title: '图书馆三楼晚自习搭子（19:00–22:00）', spot: '图书馆三楼', daysAhead: 0, capacity: 6, status: 'recruiting', desc: '互相监督不玩手机，中途休息 10 分钟。', members: ['zhang', 'chen', 'zhou'] },
    { owner: 'chen', activity: 'sport', title: '周三晚羽毛球双打', spot: '体育馆 2 号场', daysAhead: 2, capacity: 4, status: 'recruiting', desc: '已有球拍，场地费 AA。', members: ['chen', 'wang'] },
    { owner: 'wang', activity: 'movie', title: '周末去市区看展（当代艺术馆）', spot: '地铁 2 号线站口', daysAhead: 5, capacity: 5, status: 'recruiting', desc: '门票自理，中午一起吃饭。', members: ['wang'] },
    { owner: 'liu', activity: 'game', title: '桌游局：阿瓦隆 6 人', spot: '学生中心 B1', daysAhead: 3, capacity: 6, status: 'full', desc: '新手友好，规则我来讲。', members: ['liu', 'zhou', 'demo', 'chen'] },
    { owner: 'zhou', activity: 'meal', title: '周四一起去第二食堂吃新窗口', spot: '第二食堂门口', daysAhead: 4, capacity: 4, status: 'recruiting', desc: '听说新开了川菜窗口。', members: ['zhou', 'zhang'] },
  ] as const;

  for (const [index, group] of groups.entries()) {
    const groupId = id(`bg_${String(index + 1).padStart(2, '0')}`);
    const createdAt = shiftDays(now, -3 + index * 0.5);

    await prisma.buddyGroup.create({
      data: {
        id: groupId,
        ownerId: userId(group.owner),
        activity: group.activity,
        title: group.title,
        description: group.desc,
        campusSpot: group.spot,
        startsAt: shiftDays(now, group.daysAhead),
        capacity: group.capacity,
        status: group.status,
        createdAt,
        updatedAt: createdAt,
      },
    });

    for (const [memberIndex, memberKey] of group.members.entries()) {
      await prisma.buddyMember.create({
        data: {
          id: id(`bm_${String(index + 1).padStart(2, '0')}_${String(memberIndex + 1).padStart(2, '0')}`),
          groupId,
          userId: userId(memberKey),
          role: memberKey === group.owner ? 'owner' : 'member',
          joinedAt: shiftHours(createdAt, memberIndex + 1),
        },
      });
    }
  }
}

async function seedLostFound(prisma: Db, now: Date): Promise<void> {
  const items = [
    { reporter: 'chen', kind: 'lost', title: '校园卡丢失（卡面贴了猫咪贴纸）', place: '第一食堂二层', hoursAgo: 5, status: 'open', hint: '姓名首字「陈」，捡到请联系我微信。' },
    { reporter: 'wang', kind: 'found', title: '在图书馆三楼捡到一串钥匙', place: '图书馆三楼自习区', hoursAgo: 9, status: 'open', hint: '钥匙扣是深蓝色绳子，已交到图书馆前台。' },
    { reporter: 'demo', kind: 'lost', title: '白色 AirPods Pro 耳机盒（右耳）', place: '操场跑道附近', hoursAgo: 26, status: 'open', hint: '盒子上有浅蓝色划痕，拾到请私信。' },
    { reporter: 'zhang', kind: 'found', title: '捡到一个保温杯（内有茶叶）', place: '生命学院 3 号楼 2 层', hoursAgo: 30, status: 'resolved', hint: '已找到失主。' },
    { reporter: 'liu', kind: 'lost', title: '蓝色雨伞（大伞面）', place: '教学楼 2 号楼门口', hoursAgo: 50, status: 'open', hint: '伞柄有磨损，可能是放在门口被人拿错。' },
    { reporter: 'zhou', kind: 'found', title: '在体育馆捡到羽毛球拍（Yonex）', place: '体育馆 2 号场', hoursAgo: 54, status: 'open', hint: '拍柄缠了红色手胶，请描述品牌信息认领。' },
    { reporter: 'demo', kind: 'found', title: '捡到一张银行卡（尾号 4 位数可核对）', place: '西门快递站', hoursAgo: 74, status: 'resolved', hint: '已交到学生中心失物招领处。' },
    { reporter: 'chen', kind: 'lost', title: '黑色雨伞 + 一个帆布袋', place: '校车（张江—徐汇）上', hoursAgo: 98, status: 'open', hint: '袋子里有一本书。' },
  ] as const;

  for (const [index, item] of items.entries()) {
    const happenedAt = shiftHours(now, -item.hoursAgo);
    await prisma.lostFoundItem.create({
      data: {
        id: id(`lf_${String(index + 1).padStart(2, '0')}`),
        reporterId: userId(item.reporter),
        kind: item.kind,
        title: item.title,
        description: item.hint,
        place: item.place,
        happenedAt,
        contactHint: item.hint,
        status: item.status,
        resolvedAt: item.status === 'resolved' ? shiftHours(happenedAt, 20) : null,
        createdAt: happenedAt,
        updatedAt: happenedAt,
      },
    });
  }
}

async function seedForum(prisma: Db, now: Date): Promise<void> {
  const posts = [
    {
      board: 'campus',
      author: 'demo',
      anon: null,
      title: '第三食堂新开的窗口有人试过吗？',
      body: '看菜单像是川菜，价格还挺友好。想问问辣度如何，怕踩雷。',
      hoursAgo: 3,
      pinnedRank: 1,
      replies: [
        { author: 'chen', anon: null, body: '吃过水煮肉片，辣度中等偏上，米饭免费续。' },
        { author: null, anon: '树洞同学 4821', body: '建议避开 12 点高峰，排队能到楼梯口。' },
      ],
    },
    {
      board: 'study',
      author: 'zhang',
      anon: null,
      title: '《编译原理》期末复习资料整理（含往年题）',
      body: '整理了一版重点，主要是 LR 分析与语法制导翻译。放这儿给大家参考，欢迎补充。',
      hoursAgo: 8,
      pinnedRank: 2,
      replies: [
        { author: 'demo', anon: null, body: '太及时了！请问语法制导那部分有习题答案吗？' },
        { author: 'liu', anon: null, body: '补充：去年考了两道 LL(1) 判断，别忘了 FIRST/FOLLOW 集。' },
        { author: 'zhou', anon: null, body: '感谢！已存。' },
      ],
    },
    {
      board: 'help',
      author: null,
      anon: '树洞同学 1177',
      title: '宿舍热水器报修了三天还没人来，有人遇到过吗？',
      body: '已经在后勤系统报修过一次，显示"已受理"，但一直没人联系。想问问有没有更快的渠道。',
      hoursAgo: 14,
      pinnedRank: 0,
      replies: [
        { author: 'wang', anon: null, body: '打后勤电话比线上快，号码在学生手册最后一页。' },
        { author: null, anon: '树洞同学 1177', body: '更新：打电话后当天下午就来了，谢谢！' },
      ],
    },
    {
      board: 'life',
      author: 'liu',
      anon: null,
      title: '张江这边哪家理发店比较靠谱？',
      body: '想找个不推销办卡的，价格 50 以内能接受。',
      hoursAgo: 20,
      pinnedRank: 0,
      replies: [
        { author: 'zhou', anon: null, body: '地铁站旁边那家还行，明码标价。' },
        { author: 'chen', anon: null, body: '建议预约，周末人多。' },
      ],
    },
    {
      board: 'treehole',
      author: null,
      anon: '树洞同学 9002',
      title: '期末周压力有点大，大家都是怎么调节的？',
      body: '连着两周熬夜，感觉效率越来越低。想听听大家的办法。',
      hoursAgo: 26,
      pinnedRank: 0,
      replies: [
        { author: 'zhang', anon: null, body: '换成固定作息 + 每天半小时运动，比硬熬有效。' },
        { author: null, anon: '树洞同学 3044', body: '可以试试番茄钟，25 分钟一段，中间必须站起来走两步。' },
      ],
    },
    {
      board: 'trade',
      author: 'wang',
      anon: null,
      title: '出闲置：九成新台灯 + 一个桌面收纳架',
      body: '搬宿舍清出来的，两件打包 40 元，生活区自提。有意站内私信。',
      hoursAgo: 32,
      pinnedRank: 0,
      replies: [{ author: 'demo', anon: null, body: '台灯是什么色温的？想看看实物。' }],
    },
    {
      board: 'campus',
      author: 'zhou',
      anon: null,
      title: '校园卡充值的几个渠道对比（附避坑）',
      body: '线上充值到账快，但有时会延迟几分钟；自助机最稳。整理了三种方式的差异。',
      hoursAgo: 40,
      pinnedRank: 0,
      replies: [
        { author: 'liu', anon: null, body: '补充：如果显示充值中，不要重复提交，等 5 分钟。' },
        { author: 'chen', anon: null, body: '很实用，收藏了。' },
      ],
    },
    {
      board: 'study',
      author: 'chen',
      anon: null,
      title: '组一个 3 人论文阅读小组（机器学习方向）',
      body: '每周读一篇经典论文，轮流讲，时间定在周三晚上。感兴趣的可以回帖。',
      hoursAgo: 46,
      pinnedRank: 0,
      replies: [
        { author: 'demo', anon: null, body: '报名，方向正好对口。' },
        { author: 'zhang', anon: null, body: '可以算我一个，不过我更偏生物信息。' },
      ],
    },
    {
      board: 'life',
      author: null,
      anon: '树洞同学 6620',
      title: '关于宿舍噪音的一点困扰',
      body: '楼上半夜还在挪椅子，沟通了一次效果不大。有没有更温和的解决方式？',
      hoursAgo: 60,
      pinnedRank: 0,
      replies: [
        { author: 'liu', anon: null, body: '可以试试通过宿管协调，比直接说更不容易尴尬。' },
        { author: null, anon: '树洞同学 6620', body: '谢谢建议，已经联系宿管了。' },
      ],
    },
  ] as const;

  for (const [index, post] of posts.entries()) {
    const postId = id(`fp_${String(index + 1).padStart(2, '0')}`);
    const createdAt = shiftHours(now, -post.hoursAgo);
    const lastReplyHours = post.replies.length > 0 ? post.hoursAgo - 1 : null;

    await prisma.forumPost.create({
      data: {
        id: postId,
        board: post.board,
        authorId: post.author === null ? null : userId(post.author),
        anonHandle: post.anon,
        title: post.title,
        body: post.body,
        status: 'published',
        pinnedRank: post.pinnedRank,
        replyCount: post.replies.length,
        lastReplyAt: lastReplyHours === null ? null : shiftHours(now, -lastReplyHours),
        createdAt,
        updatedAt: createdAt,
      },
    });

    for (const [replyIndex, reply] of post.replies.entries()) {
      await prisma.forumReply.create({
        data: {
          id: id(`fr_${String(index + 1).padStart(2, '0')}_${String(replyIndex + 1).padStart(2, '0')}`),
          postId,
          authorId: reply.author === null ? null : userId(reply.author),
          anonHandle: reply.anon,
          body: reply.body,
          status: 'published',
          createdAt: shiftHours(createdAt, replyIndex + 1),
        },
      });
    }
  }
}

async function seedCanteen(prisma: Db): Promise<void> {
  const dishes = [
    { canteen: '第一食堂', name: '红烧肉盖饭', kcal: 780, protein: 32, fat: 28, carb: 96, priceFen: 1_800 },
    { canteen: '第一食堂', name: '清蒸鲈鱼套餐', kcal: 520, protein: 38, fat: 14, carb: 52, priceFen: 2_200 },
    { canteen: '第一食堂', name: '番茄鸡蛋面', kcal: 560, protein: 20, fat: 16, carb: 82, priceFen: 1_200 },
    { canteen: '第一食堂', name: '蒜蓉西兰花', kcal: 120, protein: 6, fat: 6, carb: 12, priceFen: 600 },
    { canteen: '第二食堂', name: '水煮肉片', kcal: 720, protein: 30, fat: 42, carb: 38, priceFen: 1_900 },
    { canteen: '第二食堂', name: '麻婆豆腐盖饭', kcal: 640, protein: 22, fat: 24, carb: 84, priceFen: 1_400 },
    { canteen: '第二食堂', name: '香菇滑鸡饭', kcal: 610, protein: 28, fat: 18, carb: 86, priceFen: 1_600 },
    { canteen: '第二食堂', name: '上汤娃娃菜', kcal: 90, protein: 4, fat: 4, carb: 10, priceFen: 700 },
    { canteen: '第三食堂', name: '牛肉拉面（大碗）', kcal: 700, protein: 30, fat: 20, carb: 98, priceFen: 1_500 },
    { canteen: '第三食堂', name: '麻辣香锅（自选）', kcal: 850, protein: 26, fat: 48, carb: 72, priceFen: 2_600 },
    { canteen: '第三食堂', name: '广式煲仔饭', kcal: 760, protein: 26, fat: 26, carb: 100, priceFen: 2_000 },
    { canteen: '第三食堂', name: '白灼菜心', kcal: 80, protein: 4, fat: 3, carb: 9, priceFen: 600 },
    { canteen: '教工食堂', name: '轻食鸡胸沙拉', kcal: 380, protein: 34, fat: 12, carb: 34, priceFen: 2_200 },
    { canteen: '教工食堂', name: '杂粮饭 + 时蔬', kcal: 420, protein: 14, fat: 8, carb: 74, priceFen: 1_300 },
    { canteen: '咖啡吧', name: '美式咖啡（中杯）', kcal: 10, protein: 0, fat: 0, carb: 2, priceFen: 1_200 },
    { canteen: '咖啡吧', name: '厚乳拿铁（中杯）', kcal: 210, protein: 8, fat: 10, carb: 22, priceFen: 1_800 },
    { canteen: '咖啡吧', name: '鸡胸三明治', kcal: 330, protein: 22, fat: 12, carb: 34, priceFen: 1_600 },
    { canteen: '咖啡吧', name: '全麦贝果', kcal: 250, protein: 9, fat: 4, carb: 46, priceFen: 900 },
  ] as const;

  for (const [index, dish] of dishes.entries()) {
    await prisma.canteenDish.create({
      data: {
        id: id(`cd_${String(index + 1).padStart(2, '0')}`),
        canteen: dish.canteen,
        name: dish.name,
        caloriesKcal: dish.kcal,
        proteinG: dish.protein,
        fatG: dish.fat,
        carbG: dish.carb,
        priceFen: dish.priceFen,
      },
    });
  }
}

async function seedWildlife(prisma: Db): Promise<void> {
  const spots = [
    { species: '黑天鹅', place: '湖畔东侧', lat: 31.180_215, lng: 121.593_118, note: '一对，常在上午出现，不要投喂面包。' },
    { species: '橘猫', place: '生活区 5 号楼门口', lat: 31.178_902, lng: 121.591_764, note: '很亲人，已绝育（左耳有缺口）。' },
    { species: '白鹭', place: '人工湿地', lat: 31.181_033, lng: 121.594_020, note: '清晨觅食，观鸟请保持距离。' },
    { species: '三花猫', place: '图书馆后门', lat: 31.179_640, lng: 121.592_410, note: '怕人，请勿追赶。' },
    { species: '戴胜', place: '操场北侧草坪', lat: 31.179_188, lng: 121.593_502, note: '偶尔停留，觅食时不打扰。' },
    { species: '狸花猫', place: '第一食堂后侧', lat: 31.178_566, lng: 121.592_233, note: '午后常趴在窗台晒太阳。' },
  ] as const;

  for (const [index, spot] of spots.entries()) {
    await prisma.wildlifeSpot.create({
      data: {
        id: id(`ws_${String(index + 1).padStart(2, '0')}`),
        species: spot.species,
        place: spot.place,
        lat: spot.lat,
        lng: spot.lng,
        note: spot.note,
        reportedBy: null,
        status: 'active',
      },
    });
  }
}

async function seedTechpie(prisma: Db): Promise<void> {
  const links = [
    { key: 'techpie-home', name: 'TechPie 主页', category: 'portal', url: 'https://techpie.shanghaitech.edu.cn/' },
    { key: 'techpie-course', name: '选课与课程评价', category: 'academic', url: 'https://techpie.shanghaitech.edu.cn/course' },
    { key: 'techpie-wiki', name: '社团与活动 Wiki', category: 'community', url: 'https://techpie.shanghaitech.edu.cn/wiki' },
    { key: 'techpie-print', name: '自助打印服务', category: 'service', url: 'https://techpie.shanghaitech.edu.cn/print' },
    { key: 'techpie-lab', name: '实验室预约', category: 'academic', url: 'https://techpie.shanghaitech.edu.cn/lab' },
    { key: 'techpie-status', name: '校园服务状态页', category: 'portal', url: 'https://techpie.shanghaitech.edu.cn/status' },
  ] as const;

  for (const [index, link] of links.entries()) {
    await prisma.techpieLink.create({
      data: {
        id: id(`tp_${String(index + 1).padStart(2, '0')}`),
        key: link.key,
        name: link.name,
        category: link.category,
        url: link.url,
        status: 'active',
      },
    });
  }
}

async function seedFaq(prisma: Db): Promise<void> {
  // 与可达鸭知识库同源的常见问题（白名单公共知识，不含任何个人数据）。
  const entries = [
    { q: '校园卡丢了怎么办？', a: '先在「校园卡」页发起挂失，线上挂失即时生效；然后带学生证到学生中心一楼服务台补办，工本费 20 元，一般当场可取。挂失前的消费无法追回，所以发现丢失请先挂失。', c: 'campus-card', tags: ['校园卡', '挂失', '补办'] },
    { q: '校园卡余额怎么看？', a: '打开「校园卡」页即可看到余额与最近流水。余额低于 20 元会显示低余额提醒。充值可在自助机、线上渠道或学生中心服务台办理。', c: 'campus-card', tags: ['校园卡', '余额', '充值'] },
    { q: '课表怎么导入？', a: '在「课表」页点击同步，系统会经教务系统拉取本学期课表。如果你是手动加课，也可以在课表页自行添加，冲突会被标出来。', c: 'schedule', tags: ['课表', '同步'] },
    { q: '上课时间是几点到几点？', a: '第 1 节 08:15–09:05，第 2 节 09:15–10:05，第 3 节 10:25–11:15，后续节次依次顺延。课表里展示的就是每节课的开始与结束时刻。', c: 'schedule', tags: ['课表', '时间'] },
    { q: '怎么绑定校园系统？', a: '进入「身份」页，选择要绑定的系统（教务、校园卡等）后按提示授权。绑定凭据由服务端加密保存，可达鸭不会把它当作你的登录身份。', c: 'identity', tags: ['身份', '绑定'] },
    { q: '为什么有些功能提示需要先登录？', a: '涉及个人数据的操作（课表、校园卡、发布内容）都必须登录后进行，这样才能把数据归属到你的账号。游客可以浏览公开内容。', c: 'auth', tags: ['登录', '权限'] },
    { q: '实名信息会展示给别人看吗？', a: '默认不会。实名信息在服务端脱敏后才返回，只有你主动开启展示，或在特定场景下二次确认后才会显示明文，且每次查看都会写审计记录。', c: 'privacy', tags: ['隐私', '实名'] },
    { q: '怎么撤回某个模块的授权同意？', a: '在「我的 - 隐私与数据」里可以逐项撤回同意。撤回后该模块立即不可用，历史授权记录会保留但标记为已撤回。', c: 'privacy', tags: ['隐私', '同意', '撤回'] },
    { q: '怎么导出我的数据？', a: '在「我的 - 隐私与数据」点击导出，系统会生成一份包含你的资料、同意记录与内容数据的文件。导出内容包含已撤回的同意记录，便于核对。', c: 'privacy', tags: ['隐私', '导出'] },
    { q: '拼单怎么发起？', a: '在「拼单」页右上角点击发起，填写商品、目标人数、单价与截止时间即可。成团后系统会给参与的同学发通知。', c: 'groupbuy', tags: ['拼单', '发起'] },
    { q: '跑腿的悬赏怎么结算？', a: '目前悬赏金额只作为双方约定的展示信息，线下自行结算。线上支付能力在接入微信支付后开放。', c: 'errand', tags: ['跑腿', '悬赏'] },
    { q: '发布的内容可以匿名吗？', a: '论坛与宿舍矛盾支持匿名。匿名内容使用与你实名身份解耦的匿名标识，服务端不会把两者关联起来。', c: 'content', tags: ['匿名', '论坛', '宿舍矛盾'] },
  ] as const;

  for (const [index, entry] of entries.entries()) {
    await prisma.faqEntry.create({
      data: {
        id: id(`fq_${String(index + 1).padStart(2, '0')}`),
        question: entry.q,
        answer: entry.a,
        category: entry.c,
        tags: [...entry.tags],
        helpfulCount: contentHelpfulCount(index),
      },
    });
  }
}

/** 常见的"有帮助"计数：让它看起来像真实累积，而不是清一色 0 */
function contentHelpfulCount(index: number): number {
  const values = [42, 37, 31, 28, 24, 19, 17, 12, 9, 7, 5, 3];
  return values[index % values.length] ?? 0;
}

async function seedTakeoutReports(prisma: Db, now: Date): Promise<void> {
  const reports = [
    { reporter: 'chen', anon: null, orderNo: 'KD2026101201', place: '生活区 5 号楼一层外卖架', hoursAgo: 30, status: 'reported', detail: '取餐时发现袋子被拆开，主食不见了。' },
    { reporter: null, anon: '树洞同学 3311', orderNo: 'KD2026101202', place: '西门快递站旁外卖柜', hoursAgo: 48, status: 'reported', detail: '放在柜子外侧的奶茶被拿走，监控拍到了但看不清。' },
    { reporter: 'liu', anon: null, orderNo: 'KD2026101203', place: '生活区 7 号楼外卖架', hoursAgo: 72, status: 'resolved', detail: '误拿，已归还，撤回报备。' },
    { reporter: null, anon: '树洞同学 7788', orderNo: 'KD2026101204', place: '教学楼 2 号楼前台', hoursAgo: 96, status: 'reported', detail: '同一时段连续两次被拿走，疑似惯犯。' },
  ] as const;

  for (const [index, report] of reports.entries()) {
    const createdAt = shiftHours(now, -report.hoursAgo);
    await prisma.takeoutReport.create({
      data: {
        id: id(`tr_${String(index + 1).padStart(2, '0')}`),
        reporterId: report.reporter === null ? null : userId(report.reporter),
        anonHandle: report.anon,
        orderNo: report.orderNo,
        place: report.place,
        happenedAt: createdAt,
        detail: report.detail,
        evidenceUrl: null,
        status: report.status,
        createdAt,
        updatedAt: createdAt,
      },
    });
  }
}

async function seedNotifications(prisma: Db, now: Date): Promise<void> {
  const notifications = [
    {
      key: 'demo',
      title: '有人参团了你的拼单',
      body: '「山姆 4L 洗衣液拼一箱（分装）」已有 2 人参与，还差 2 人成团。',
      source: 'groupbuy',
      link: '/presentation/pages/groupbuy/list/index',
      hoursAgo: 2,
      read: false,
    },
    {
      key: 'demo',
      title: '你的跑腿悬赏已被接单',
      body: '「帮忙买一盒创可贴」已被同学接单，完成后请及时确认。',
      source: 'errand',
      link: '/presentation/pages/errand/list/index',
      hoursAgo: 20,
      read: false,
    },
    {
      key: 'demo',
      title: '校园卡余额偏低提醒',
      body: '当前余额 74.20 元，低于 100 元。可在校园卡页查看流水或充值。',
      source: 'campus-card',
      link: '/presentation/pages/campusCard/index',
      hoursAgo: 26,
      read: false,
    },
    {
      key: 'demo',
      title: '你的帖子收到新回复',
      body: '「第三食堂新开的窗口有人试过吗？」有 2 条新回复。',
      source: 'forum',
      link: '/presentation/pages/forum/list/index',
      hoursAgo: 48,
      read: true,
    },
    {
      key: 'demo',
      title: '课表已同步完成',
      body: '本学期共导入 8 门课程，其中 0 门时间冲突。',
      source: 'schedule',
      link: '/presentation/pages/schedule/index',
      hoursAgo: 96,
      read: true,
    },
    {
      key: 'zhang',
      title: '拼单成团通知',
      body: '「星巴克咖啡豆拼单（250g 均分）」已成团，请按约定时间取货。',
      source: 'groupbuy',
      link: '/presentation/pages/groupbuy/list/index',
      hoursAgo: 5,
      read: false,
    },
    {
      key: 'zhang',
      title: '有人想买你的闲置',
      body: '「Dell U2419H 24 寸显示器」收到了新的咨询。',
      source: 'flea-market',
      link: '/presentation/pages/fleaMarket/list/index',
      hoursAgo: 12,
      read: false,
    },
  ] as const;

  for (const [index, item] of notifications.entries()) {
    const createdAt = shiftHours(now, -item.hoursAgo);
    await prisma.notification.create({
      data: {
        id: id(`nt_${String(index + 1).padStart(2, '0')}`),
        userId: userId(item.key),
        title: item.title,
        body: item.body,
        channel: 'inapp',
        source: item.source,
        link: item.link,
        readAt: item.read ? shiftHours(createdAt, 1) : null,
        createdAt,
      },
    });
  }
}

/* ------------------------------------------------------------------ *
 * 入口
 * ------------------------------------------------------------------ */

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production' && process.env.SEED_FORCE !== '1') {
    console.error('[seed] 检测到 NODE_ENV=production，已拒绝执行。确实要写入演示数据请设置 SEED_FORCE=1。');
    process.exitCode = 1;
    return;
  }

  const connectionString =
    process.env.DATABASE_URL ?? 'postgresql://kedaya:kedaya@localhost:5432/kedaya?schema=public';
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

  try {
    const now = new Date();
    console.log('[seed] 清理上一轮演示数据…');
    await purge(prisma);

    console.log('[seed] 写入演示数据…');
    await seedUsers(prisma, now);
    await seedSchedule(prisma, now);
    await seedCampusCard(prisma, now);
    await seedGroupbuy(prisma, now);
    await seedFleaMarket(prisma, now);
    await seedErrands(prisma, now);
    await seedBuddy(prisma, now);
    await seedLostFound(prisma, now);
    await seedForum(prisma, now);
    await seedCanteen(prisma);
    await seedWildlife(prisma);
    await seedTechpie(prisma);
    await seedFaq(prisma);
    await seedTakeoutReports(prisma, now);
    await seedNotifications(prisma, now);

    console.log('[seed] 完成。演示账号：');
    for (const user of USERS) {
      console.log(`  · ${user.email} / ${DEMO_PASSWORD}（${user.displayName}）`);
    }
    console.log('[seed] 演示数据 id 前缀均为 seed_ ，可安全重跑。');
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error('[seed] 失败：', error);
  process.exitCode = 1;
});
