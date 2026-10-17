/** Browser demo of the campus groupbuy rules. The API enforces the same rules for signed-in users. */
export interface CampusMember {
  name: string;
  quantity: number;
  note: string;
  joinedAt: string;
  receivedAt?: string | null;
  selections?: Array<{ item: string; quantity: number }>;
}

export interface CampusOrder {
  id: string;
  ownerName: string;
  kind: 'ordinary' | 'membership';
  merchantName: string;
  title: string;
  itemSpec: string;
  itemOptions: string[];
  description: string;
  targetCount: number;
  priceFen: number;
  pickupSpot: string;
  createdAt: string;
  deadline: string;
  status: 'open' | 'grouped' | 'cancelled';
  cancelReason: '' | 'TIMEOUT_24H' | 'CREATOR_CANCELLED';
  pickupNotice?: string;
  members: CampusMember[];
}

const KEY = 'kedaya:campus-groupbuy:v1';

function demoOrders(now: number): CampusOrder[] {
  const base = {
    description: '在宿舍群统计需求，成团后统一线下采购。',
    priceFen: 0,
    createdAt: new Date(now).toISOString(),
    deadline: new Date(now + 86_400_000).toISOString(),
    status: 'open' as const,
    cancelReason: '' as const,
  };
  return [
    { ...base, id: 'demo-dorm-supplies', ownerName: '小林', kind: 'ordinary' as const, merchantName: '', title: '三号楼宿舍拼抽纸', itemSpec: '抽纸 3 包/份', itemOptions: ['抽纸 3 包/份'], targetCount: 8, pickupSpot: '三号楼大厅', members: [{ name: '小王', quantity: 2, note: '无香型', joinedAt: new Date(now).toISOString(), selections: [{ item: '抽纸 3 包/份', quantity: 2 }] }] },
    { ...base, id: 'demo-member-shopping', ownerName: '小陈', kind: 'membership' as const, merchantName: '山姆会员商店', title: '会员店周末代购零食', itemSpec: '零食组合 1 袋/份、纸巾 3 包/份', itemOptions: ['零食组合 1 袋/份', '纸巾 3 包/份'], targetCount: 6, pickupSpot: '五号楼门口', members: [{ name: '小李', quantity: 1, note: '', joinedAt: new Date(now).toISOString(), selections: [{ item: '零食组合 1 袋/份', quantity: 1 }] }] },
  ];
}

export function joinedQuantity(order: CampusOrder): number {
  return order.members.reduce((sum, member) => sum + member.quantity, 0);
}

export function currentStatus(order: CampusOrder, now = Date.now()): CampusOrder {
  if (order.status !== 'open') return order;
  if (joinedQuantity(order) >= order.targetCount) return { ...order, status: 'grouped' };
  if (new Date(order.deadline).getTime() <= now) {
    return { ...order, status: 'cancelled', cancelReason: 'TIMEOUT_24H' };
  }
  return order;
}

export function readOrders(): CampusOrder[] {
  if (typeof window === 'undefined') return [];
  try {
    const stored = localStorage.getItem(KEY);
    const parsed = stored === null ? null : JSON.parse(stored) as unknown;
    const raw = Array.isArray(parsed) && parsed.length === 0 ? demoOrders(Date.now()) : parsed ?? demoOrders(Date.now());
    if (!Array.isArray(raw)) return [];
    const orders = raw.filter((item): item is CampusOrder =>
      typeof item === 'object' && item !== null && typeof item.id === 'string' && Array.isArray(item.members),
    ).map((item) => currentStatus(item));
    localStorage.setItem(KEY, JSON.stringify(orders));
    return orders;
  } catch {
    return [];
  }
}

function save(orders: CampusOrder[]): CampusOrder[] {
  localStorage.setItem(KEY, JSON.stringify(orders));
  window.dispatchEvent(new Event('kedaya:groupbuy-changed'));
  return orders;
}

export function createOrder(input: Omit<CampusOrder, 'id' | 'createdAt' | 'deadline' | 'status' | 'cancelReason' | 'members'>): CampusOrder {
  if (!input.ownerName.trim() || !input.title.trim() || !input.itemSpec.trim() || !input.pickupSpot.trim()) {
    throw new Error('请填写发起人、标题、商品规格和取货地点');
  }
  if (!Number.isInteger(input.targetCount) || input.targetCount < 1 || input.targetCount > 999) {
    throw new Error('目标总份数须为 1 到 999');
  }
  if (input.itemOptions.length < 1 || input.itemOptions.length > 12 || new Set(input.itemOptions).size !== input.itemOptions.length) throw new Error('请填写 1 到 12 种不重复的商品');
  if (input.kind === 'membership' && !input.merchantName.trim()) throw new Error('请填写会员商家');
  const now = Date.now();
  const order: CampusOrder = {
    ...input, id: crypto.randomUUID(), createdAt: new Date(now).toISOString(),
    deadline: new Date(now + 86_400_000).toISOString(), status: 'open', cancelReason: '', members: [],
  };
  save([order, ...readOrders()]);
  return order;
}

export function changeOrder(id: string, operation: (order: CampusOrder) => CampusOrder): CampusOrder {
  const orders = readOrders();
  const index = orders.findIndex((item) => item.id === id);
  if (index < 0) throw new Error('拼单不存在');
  const updated = operation(currentStatus(orders[index]!));
  save(orders.map((item, at) => at === index ? updated : item));
  return updated;
}

export function registerQuantity(order: CampusOrder, name: string, quantity: number, note: string, selections?: Array<{ item: string; quantity: number }>): CampusOrder {
  if (order.status !== 'open') throw new Error('拼单已结束，无法登记');
  if (!name.trim() || !Number.isInteger(quantity) || quantity < 1 || quantity > 99) throw new Error('请填写姓名和正确份数');
  const options = order.itemOptions?.length ? order.itemOptions : [order.itemSpec];
  const lines = selections ?? [{ item: options[0]!, quantity }];
  if (lines.reduce((sum, line) => sum + line.quantity, 0) !== quantity || lines.some((line) => !options.includes(line.item) || !Number.isInteger(line.quantity) || line.quantity < 1)) throw new Error('请按商品填写正确份数');
  const others = order.members.filter((member) => member.name !== name.trim());
  const used = others.reduce((sum, member) => sum + member.quantity, 0);
  if (used + quantity > order.targetCount) throw new Error(`最多还可登记 ${order.targetCount - used} 份`);
  const existing = order.members.find((member) => member.name === name.trim());
  const members = [...others, { name: name.trim(), quantity, note: note.trim(), joinedAt: existing?.joinedAt ?? new Date().toISOString(), selections: lines }];
  return { ...order, members, status: used + quantity >= order.targetCount ? 'grouped' : 'open' };
}

export function withdrawQuantity(order: CampusOrder, name: string): CampusOrder {
  if (order.status !== 'open') throw new Error('拼单已结束，无法退出');
  if (!order.members.some((member) => member.name === name.trim())) throw new Error('你尚未登记');
  return { ...order, members: order.members.filter((member) => member.name !== name.trim()) };
}

export function purchaseSummary(order: CampusOrder): string {
  const options = order.itemOptions?.length ? order.itemOptions : [order.itemSpec];
  return [
    `【${order.title}】`, `总计：${joinedQuantity(order)}/${order.targetCount} 份`,
    '按商品汇总：',
    ...options.map((item) => `${item} × ${order.members.reduce((sum, member) => sum + (member.selections?.find((line) => line.item === item)?.quantity ?? (options.length === 1 ? member.quantity : 0)), 0)}`),
    '按成员汇总：',
    ...order.members.map((member) => `${member.name}：${(member.selections ?? [{ item: options[0]!, quantity: member.quantity }]).map((line) => `${line.item} × ${line.quantity}`).join('、')}${member.note ? `（${member.note}）` : ''}${member.receivedAt ? ' · 已领取' : ''}`),
    `取货：${order.pickupSpot}`, '费用线下自行协商，平台不收款。',
  ].join('\n');
}
