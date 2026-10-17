import { View } from '@tarojs/components'
import {
  AppsOutlined,
  BagOutlined,
  Bell,
  CalendarOutlined,
  CartCircleOutlined,
  Certificate,
  ChatOutlined,
  ClockOutlined,
  EcardPay,
  FlowerOutlined,
  FriendsOutlined,
  LikeOutlined,
  LocationOutlined,
  Logistics,
  RecordsOutlined,
  Search,
  ServiceOutlined,
  SettingOutlined,
  ShieldOutlined,
  ShopOutlined,
  SmileOutlined,
  StarOutlined,
  UserOutlined,
} from '@taroify/icons'

/**
 * 模块图标 —— **仅视觉映射**。
 *
 * 模块名称、权限与清单始终来自 `@kedaya/contracts`：这里只回答
 * 「这个 id 画哪个图标」，改动它不会影响任何功能或文案。
 *
 * 为什么从一串嵌套三元改成查表：id 长到二十来个之后，嵌套三元里漏一个
 * 就会**静默落到兜底图标**（全部变成同一个方块），而且没人能一眼看出
 * 到底覆盖了哪些 id。查表 + 显式兜底，加 id 只要加一行。
 *
 * ⚠️ 没登记的 id 一律落到 `AppsOutlined`（不报错）：契约新增模块时，
 * 首页会先出现一个通用图标而不是崩溃 —— 图标可以后补，白屏不行。
 */
const MODULE_ICONS: Readonly<Record<string, typeof AppsOutlined>> = {
  // 聚合入口：凑凑（拼单 + 找搭子）
  cou: CartCircleOutlined,
  // 六个生活模块 / 业务模块
  groupbuy: ShopOutlined,
  'flea-market': BagOutlined,
  errand: Logistics,
  buddy: FriendsOutlined,
  'lost-found': Search,
  forum: ChatOutlined,
  faq: ServiceOutlined,
  canteen: SmileOutlined,
  wildlife: FlowerOutlined,
  'takeout-guard': RecordsOutlined,
  'dorm-harmony': ShieldOutlined,
  techpie: SettingOutlined,
  'ai-portrait': StarOutlined,
  wellbeing: LikeOutlined,
  facility: CalendarOutlined,
  // 核心模块
  auth: Certificate,
  schedule: ClockOutlined,
  'campus-card': EcardPay,
  profile: UserOutlined,
  notifications: Bell,
  // 历史 id（旧版本留下的），保留以免老数据渲染成兜底图标
  animals: FlowerOutlined,
  'campus-map': LocationOutlined,
}

export function KdyModuleIcon({ id }: { id: string }) {
  const Icon = MODULE_ICONS[id] ?? AppsOutlined

  return (
    <View className='kdy-module-icon'>
      <Icon />
    </View>
  )
}
