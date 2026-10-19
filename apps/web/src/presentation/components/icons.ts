/**
 * 模块图标映射（presentation 层职责：domain 只给 key，不 import UI 库）。
 * `Record<ModuleIconKey, IconComponent>` 是穷尽映射 —— 新增模块 key 时 tsc 会报错。
 */
import {
  Bell,
  Bike,
  Bird,
  CalendarDays,
  CircleHelp,
  CreditCard,
  Dumbbell,
  HeartPulse,
  Home,
  KeyRound,
  MapPin,
  MessagesSquare,
  Plug,
  Search,
  ShieldAlert,
  ShoppingBag,
  Sparkles,
  User,
  UserSearch,
  Users,
  Utensils,
} from 'lucide-react';
import type { ComponentType } from 'react';

import type { ModuleIconKey } from '@/domain/models/module';

export interface KdyIconProps {
  className?: string;
  strokeWidth?: number;
  'aria-hidden'?: boolean;
}

export type KdyIcon = ComponentType<KdyIconProps>;

export const MODULE_ICONS: Record<ModuleIconKey, KdyIcon> = {
  users: Users,
  'shield-alert': ShieldAlert,
  'shopping-bag': ShoppingBag,
  home: Home,
  bike: Bike,
  'user-search': UserSearch,
  search: Search,
  utensils: Utensils,
  'messages-square': MessagesSquare,
  sparkles: Sparkles,
  'heart-pulse': HeartPulse,
  'circle-help': CircleHelp,
  plug: Plug,
  bird: Bird,
  'key-round': KeyRound,
  'calendar-days': CalendarDays,
  'credit-card': CreditCard,
  user: User,
  bell: Bell,
  dumbbell: Dumbbell,
  'map-pin': MapPin,
};

export function moduleIcon(key: ModuleIconKey): KdyIcon {
  return MODULE_ICONS[key] ?? CircleHelp;
}
