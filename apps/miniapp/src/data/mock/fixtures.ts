import type { GroupBuy, GroupBuyParticipant } from '../../domain/models/groupbuy'

/**
 * Mock 种子数据 —— 保证「没有后端也能跑通」整个垂直切片（契约 §7 硬规则 4）。
 *
 * 设计约束：
 * - **确定性**：所有时间基于 `MOCK_NOW_ISO` 相对推算，测试可复现。
 * - **覆盖三态**：可参团 / 已成团 / 已截止（外加已取消），
 *   列表页因此天然能看到不同状态的卡片。
 */

/** mock 世界的「现在」（= 北京时间 2026-10-16 20:00） */
export const MOCK_NOW_ISO = new Date().toISOString()

export function mockNow(): Date {
  return new Date()
}

function shiftHours(baseIso: string, hours: number): string {
  return new Date(new Date(baseIso).getTime() + hours * 3_600_000).toISOString()
}

function participant(
  id: string,
  displayName: string,
  quantity: number,
  joinedHoursAgo: number,
  anonymous = false,
): GroupBuyParticipant {
  return {
    id,
    displayName: anonymous ? '匿名同学' : displayName,
    anonymous,
    quantity,
    joinedAt: shiftHours(MOCK_NOW_ISO, -joinedHoursAgo),
  }
}

export const MOCK_GROUP_BUYS: readonly GroupBuy[] = [
  {
    id: 'gb-1001',
    title: '一食堂三楼小炒 · 凑 5 份免配送',
    description: '满 5 份老板免配送费，我在三号楼，参团后统一 11:40 去取。',
    category: 'food',
    initiatorId: 'u-0001',
    initiatorName: '张同学',
    priceFen: 1850,
    targetCount: 5,
    participants: [
      participant('u-0001', '张同学', 1, 2),
      participant('u-0002', '李同学', 2, 1),
    ],
    deadline: shiftHours(MOCK_NOW_ISO, 21),
    pickupPlace: '三号楼 1F 大厅',
    status: 'open',
    createdAt: shiftHours(MOCK_NOW_ISO, -3),
    updatedAt: shiftHours(MOCK_NOW_ISO, -1),
  },
  {
    id: 'gb-1002',
    title: '山姆会员店周末代购零食',
    description: '发起人自述持有会员，周末统一采购，线下自行结算。',
    category: 'supplies',
    initiatorId: 'u-0003',
    initiatorName: '王同学',
    kind: 'membership',
    merchantName: '山姆会员商店',
    itemSpec: '零食组合 1 袋/份、纸巾 3 包/份',
    itemOptions: ['零食组合 1 袋/份', '纸巾 3 包/份'],
    priceFen: 1290,
    targetCount: 4,
    participants: [{ ...participant('u-0003', '王同学', 1, 1), selections: [{ item: '零食组合 1 袋/份', quantity: 1 }] }],
    deadline: shiftHours(MOCK_NOW_ISO, 22),
    pickupPlace: '图书馆北门',
    status: 'open',
    createdAt: shiftHours(MOCK_NOW_ISO, -2),
    updatedAt: shiftHours(MOCK_NOW_ISO, -1),
  },
  {
    id: 'gb-1003',
    title: '宿舍抽纸 + 洗衣液 · 已满员',
    description: '整箱更便宜，已凑满，感谢各位。',
    category: 'supplies',
    initiatorId: 'u-0004',
    initiatorName: '陈同学',
    priceFen: 990,
    targetCount: 6,
    participants: [
      participant('u-0004', '陈同学', 2, 5),
      participant('u-0005', '刘同学', 2, 4, true),
      participant('u-0006', '赵同学', 2, 3),
    ],
    deadline: shiftHours(MOCK_NOW_ISO, 18),
    pickupPlace: '5 号宿舍楼门口',
    status: 'open',
    createdAt: shiftHours(MOCK_NOW_ISO, -6),
    updatedAt: shiftHours(MOCK_NOW_ISO, -3),
  },
  {
    id: 'gb-1004',
    title: '话剧社专场票 · 已过截止',
    description: '团体票 8 折，可惜已经过截止时间了。',
    category: 'ticket',
    initiatorId: 'u-0007',
    initiatorName: '孙同学',
    priceFen: 4000,
    targetCount: 4,
    participants: [
      participant('u-0007', '孙同学', 1, 20),
      participant('u-0008', '周同学', 1, 18),
    ],
    deadline: shiftHours(MOCK_NOW_ISO, 0),
    pickupPlace: '学生活动中心 2F',
    status: 'open',
    createdAt: shiftHours(MOCK_NOW_ISO, -24),
    updatedAt: shiftHours(MOCK_NOW_ISO, -20),
  },
  {
    id: 'gb-1005',
    title: '羽毛球场地费 AA · 还差 3 人',
    description: '周五晚 19:00-21:00，场地费 120 元按人头平摊。',
    category: 'other',
    initiatorId: 'u-0009',
    initiatorName: '吴同学',
    priceFen: 2000,
    targetCount: 3,
    participants: [],
    deadline: shiftHours(MOCK_NOW_ISO, 23),
    pickupPlace: '体育馆羽毛球馆',
    status: 'open',
    createdAt: shiftHours(MOCK_NOW_ISO, -1),
    updatedAt: shiftHours(MOCK_NOW_ISO, -1),
  },
  {
    id: 'gb-1006',
    title: '拼车去浦东机场 · 发起人已取消',
    description: '行程变动，已取消。',
    category: 'other',
    initiatorId: 'u-0010',
    initiatorName: '郑同学',
    priceFen: 6000,
    targetCount: 4,
    participants: [participant('u-0010', '郑同学', 1, 10)],
    deadline: shiftHours(MOCK_NOW_ISO, 12),
    pickupPlace: '学校北门',
    status: 'cancelled',
    createdAt: shiftHours(MOCK_NOW_ISO, -12),
    updatedAt: shiftHours(MOCK_NOW_ISO, -8),
  },
]

/** mock 登录账号（骨架占位，真实流程走 CAS/Egate，见 README「未实现」） */
export const MOCK_PROFILE = {
  id: 'u-me',
  nickname: '可达鸭测试号',
  studentId: '20260001',
  college: '信息科学与技术学院',
  campusBound: false,
} as const
