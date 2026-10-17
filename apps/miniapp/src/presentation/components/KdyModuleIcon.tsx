import { View } from '@tarojs/components'
import {
  AppsOutlined,
  ShopOutlined,
  FriendsOutlined,
  Search,
  NotesOutlined,
  LikeOutlined,
  ChatOutlined,
  LocationOutlined,
  ShieldOutlined,
  ClockOutlined,
} from '@taroify/icons'

// 仅提供视觉映射；模块名称、权限与清单始终来自共享契约。
export function KdyModuleIcon({ id }: { id: string }) {
  const Icon =
    id === 'groupbuy' || id === 'flea-market'
      ? ShopOutlined
      : id === 'buddy' || id === 'errand'
        ? FriendsOutlined
        : id === 'lost-found'
          ? Search
          : id === 'wellbeing' || id === 'animals'
            ? LikeOutlined
            : id === 'forum' || id === 'faq'
              ? ChatOutlined
              : id === 'schedule'
                ? ClockOutlined
                : id === 'auth' || id === 'dorm-harmony'
                  ? ShieldOutlined
                  : id === 'campus-card'
                    ? NotesOutlined
                    : id === 'campus-map'
                      ? LocationOutlined
                      : AppsOutlined
  return (
    <View className='kdy-module-icon'>
      <Icon />
    </View>
  )
}
