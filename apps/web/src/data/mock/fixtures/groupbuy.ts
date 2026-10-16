/**
 * 拼单 mock 数据集 —— 保证**无后端也能跑通**（契约 §7 硬规则 4）。
 *
 * 时间基于传入的 `now` 相对生成，所以演示永远有「可参团」的条目，
 * 而测试可以传固定 `now` 获得确定性。
 */
import type { GroupBuyDetail, GroupBuyItem } from '@/domain/models/groupbuy';

function iso(base: Date, deltaMs: number): string {
  return new Date(base.getTime() + deltaMs).toISOString();
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** 从详情里取出列表项（详情 = 列表项 + 参与者 + 规则） */
export function toGroupBuyItem(detail: GroupBuyDetail): GroupBuyItem {
  const { participants: _participants, rules: _rules, ...item } = detail;
  return item;
}

export function createGroupBuySeed(now: Date): GroupBuyDetail[] {
  return [
    {
      id: 'gb-1001',
      title: '三食堂 · 麻辣烫 8 折拼单',
      merchant: '三食堂 2 楼',
      category: 'food',
      status: 'recruiting',
      targetCount: 12,
      joinedCount: 8,
      priceFen: 1680,
      originalPriceFen: 2100,
      initiator: { id: 'u_1024', nickname: '鸭鸭先冲' },
      pickupSpot: '三食堂门口长椅',
      deadlineAt: iso(now, 3 * HOUR),
      createdAt: iso(now, -5 * HOUR),
      note: '凑满 12 份商家才给 8 折，差 4 份，速来。',
      rules: ['满 12 份自动成团', '成团后 30 分钟内完成支付', '取货点当场核销'],
      participants: [
        { id: 'p-1', nickname: '鸭鸭先冲', quantity: 1, paidFen: 1680, joinedAt: iso(now, -5 * HOUR), anonymous: false },
        { id: 'p-2', nickname: '图书馆常驻', quantity: 2, paidFen: 3360, joinedAt: iso(now, -4 * HOUR), anonymous: false },
        { id: 'p-3', nickname: '匿名同学', quantity: 1, paidFen: 1680, joinedAt: iso(now, -3 * HOUR), anonymous: true },
        { id: 'p-4', nickname: '夜宵战神', quantity: 2, paidFen: 3360, joinedAt: iso(now, -2 * HOUR), anonymous: false },
        { id: 'p-5', nickname: '匿名同学', quantity: 1, paidFen: 1680, joinedAt: iso(now, -1 * HOUR), anonymous: true },
        { id: 'p-6', nickname: '摸鱼鸭', quantity: 1, paidFen: 1680, joinedAt: iso(now, -30 * MINUTE), anonymous: false },
      ],
    },
    {
      id: 'gb-1002',
      title: '一食堂 · 奶茶第二杯半价凑单',
      merchant: '一食堂 1 楼饮品档',
      category: 'drink',
      status: 'recruiting',
      targetCount: 6,
      joinedCount: 4,
      priceFen: 1200,
      originalPriceFen: 1800,
      initiator: { id: 'u_2048', nickname: '奶茶续命' },
      pickupSpot: '一食堂正门',
      deadlineAt: iso(now, 45 * MINUTE),
      createdAt: iso(now, -2 * HOUR),
      note: '第二杯半价，两人一组，还差 2 位。',
      rules: ['满 6 杯成团', '口味请在备注里写清'],
      participants: [
        { id: 'p-7', nickname: '奶茶续命', quantity: 2, paidFen: 2400, joinedAt: iso(now, -2 * HOUR), anonymous: false },
        { id: 'p-8', nickname: '匿名同学', quantity: 1, paidFen: 1200, joinedAt: iso(now, -90 * MINUTE), anonymous: true },
        { id: 'p-9', nickname: '早八人', quantity: 1, paidFen: 1200, joinedAt: iso(now, -40 * MINUTE), anonymous: false },
      ],
    },
    {
      id: 'gb-1003',
      title: '天猫超市 · 洗衣液凑单免运费',
      merchant: '天猫超市',
      category: 'daily',
      status: 'recruiting',
      targetCount: 5,
      joinedCount: 2,
      priceFen: 2350,
      originalPriceFen: 3200,
      initiator: { id: 'u_3072', nickname: '宿舍长' },
      pickupSpot: '学生公寓 7 号楼快递柜',
      deadlineAt: iso(now, 1 * DAY + 2 * HOUR),
      createdAt: iso(now, -8 * HOUR),
      note: '差 3 单免运费，我统一收快递。',
      rules: ['满 5 单成团', '统一寄到 7 号楼快递柜', '到货后群内通知'],
      participants: [
        { id: 'p-10', nickname: '宿舍长', quantity: 1, paidFen: 2350, joinedAt: iso(now, -8 * HOUR), anonymous: false },
        { id: 'p-11', nickname: '匿名同学', quantity: 1, paidFen: 2350, joinedAt: iso(now, -6 * HOUR), anonymous: true },
      ],
    },
    {
      id: 'gb-1004',
      title: '文具店 · 考试套装团购',
      merchant: '校园文具店',
      category: 'stationery',
      status: 'locked',
      targetCount: 10,
      joinedCount: 10,
      priceFen: 2990,
      originalPriceFen: 4500,
      initiator: { id: 'u_4096', nickname: '学委' },
      pickupSpot: '教学楼 A 座 1 楼',
      deadlineAt: iso(now, 2 * DAY),
      createdAt: iso(now, -3 * DAY),
      note: '已满员，等待商家发货。',
      rules: ['满 10 套成团', '成团后统一结算'],
      participants: [
        { id: 'p-12', nickname: '学委', quantity: 1, paidFen: 2990, joinedAt: iso(now, -3 * DAY), anonymous: false },
        { id: 'p-13', nickname: '匿名同学', quantity: 2, paidFen: 5980, joinedAt: iso(now, -2 * DAY), anonymous: true },
        { id: 'p-14', nickname: '考研人', quantity: 1, paidFen: 2990, joinedAt: iso(now, -30 * HOUR), anonymous: false },
      ],
    },
    {
      id: 'gb-1005',
      title: '数码 · 机械键盘团购',
      merchant: '数码城 A 家',
      category: 'digital',
      status: 'completed',
      targetCount: 15,
      joinedCount: 15,
      priceFen: 25900,
      originalPriceFen: 32900,
      initiator: { id: 'u_5120', nickname: '键圈老哥' },
      pickupSpot: '信息学院 1 楼大厅',
      deadlineAt: iso(now, -2 * DAY),
      createdAt: iso(now, -9 * DAY),
      note: '已完成结算，感谢参与。',
      rules: ['满 15 把成团', '统一走对公转账'],
      participants: [
        { id: 'p-15', nickname: '键圈老哥', quantity: 1, paidFen: 25900, joinedAt: iso(now, -9 * DAY), anonymous: false },
        { id: 'p-16', nickname: '匿名同学', quantity: 1, paidFen: 25900, joinedAt: iso(now, -8 * DAY), anonymous: true },
      ],
    },
    {
      id: 'gb-1006',
      title: '外卖 · 螺蛳粉拼单（已取消）',
      merchant: '校外螺蛳粉',
      category: 'food',
      status: 'cancelled',
      targetCount: 8,
      joinedCount: 3,
      priceFen: 1580,
      originalPriceFen: 1980,
      initiator: { id: 'u_6144', nickname: '重口味' },
      pickupSpot: '北门快递点',
      deadlineAt: iso(now, -1 * DAY),
      createdAt: iso(now, -2 * DAY),
      note: '商家临时歇业，已取消。',
      rules: ['满 8 份成团'],
      participants: [
        { id: 'p-17', nickname: '重口味', quantity: 1, paidFen: 1580, joinedAt: iso(now, -2 * DAY), anonymous: false },
      ],
    },
  ];
}
