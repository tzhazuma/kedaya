import { Text, View } from '@tarojs/components'

import { getContainer } from '../../../app/container'
import { createMockSignIn } from '../../../data/mock/mockAuth'
import { toast } from '../../../platform/navigation'
import { KdyButton, KdyCard, KdyTag } from '../../components'
import { useStore } from '../../hooks'
import './index.scss'

/**
 * 我的 —— 会话状态 + 隐私合规声明。
 *
 * ⚠️ 这里的「登录」是**骨架占位**：真实流程是
 * `wx.login` → code → 后端换 KedaYa JWT（契约 §5 第一级身份层），
 * 校园系统绑定走独立的 `CampusSessionPort`（第二级能力层），本骨架未实现。
 * 页面上明确标注，避免被误认为已接通统一身份认证。
 */

const mockSignIn = createMockSignIn()

/** 契约 §9 不可妥协的隐私规则（原文摘录，让用户与开发者都能看到） */
const PRIVACY_RULES: readonly { title: string; detail: string }[] = [
  {
    title: '敏感模块独立同意',
    detail:
      '心理治疗 / 宿舍矛盾 / AI 画像首次进入必须显式二次同意，可随时撤回；登录与开卡本身即同意，不再叠门。',
  },
  {
    title: '数据最小化',
    detail: '心理与宿舍矛盾数据不进入通用画像；AI 画像不得读取这两个域。',
  },
  {
    title: '匿名可用',
    detail: '论坛 / 宿舍矛盾 / 偷外卖支持匿名身份，与实名身份解耦存储。',
  },
  {
    title: '审计',
    detail: '敏感模块的读写全部落审计日志（谁、何时、对哪条记录、什么动作）。',
  },
  {
    title: '危机出口',
    detail: '心理模块必须提供危机干预热线入口，且不可被埋进二级菜单。',
  },
  {
    title: '无官方冒充',
    detail: '全站显著标注「第三方非官方平台」，不冒充学校官方系统。',
  },
]

export default function ProfilePage() {
  const container = getContainer()
  const session = container.useCases.session
  const state = useStore(session)

  function handleSignIn(): void {
    const result = mockSignIn()
    if (!result.ok) {
      toast('登录失败')
      return
    }
    session.signIn(result.value.tokens, result.value.profile)
    toast('已用测试账号登录', 'success')
  }

  function handleSignOut(): void {
    session.signOut()
    toast('已退出登录')
  }

  function handleToggleCampusBinding(): void {
    if (state.profile === null) {
      toast('请先登录')
      return
    }
    const next = !state.profile.campusBound
    session.markCampusBound(next)
    toast(next ? '已标记为「已绑定校园系统」（占位）' : '已标记为「未绑定校园系统」')
  }

  return (
    <View className='kdy-page kdy-profile'>
      <KdyCard title='账号' elevated={false}>
        {state.profile === null ? (
          <View>
            <Text className='kdy-profile__hint'>
              未登录。参团等写操作需要登录；浏览拼单列表不需要。
            </Text>
            <View className='kdy-profile__actions'>
              <KdyButton size='sm' onClick={handleSignIn}>
                用测试账号登录
              </KdyButton>
            </View>
          </View>
        ) : (
          <View>
            <View className='kdy-profile__row'>
              <Text className='kdy-profile__k'>昵称</Text>
              <Text className='kdy-profile__v'>{state.profile.nickname}</Text>
            </View>
            <View className='kdy-profile__row'>
              <Text className='kdy-profile__k'>学号</Text>
              <Text className='kdy-profile__v'>{state.profile.studentId ?? '未绑定'}</Text>
            </View>
            <View className='kdy-profile__row'>
              <Text className='kdy-profile__k'>院系</Text>
              <Text className='kdy-profile__v'>{state.profile.college ?? '未绑定'}</Text>
            </View>
            <View className='kdy-profile__row'>
              <Text className='kdy-profile__k'>校园系统</Text>
              <KdyTag tone={state.profile.campusBound ? 'success' : 'warning'}>
                {state.profile.campusBound ? '已绑定' : '未绑定'}
              </KdyTag>
            </View>
            <View className='kdy-profile__row'>
              <Text className='kdy-profile__k'>Token 过期时间</Text>
              <Text className='kdy-profile__v'>{state.tokens?.expiresAt ?? '-'}</Text>
            </View>

            <View className='kdy-profile__actions'>
              <KdyButton size='sm' variant='ghost' onClick={handleToggleCampusBinding}>
                切换绑定状态（占位）
              </KdyButton>
              <KdyButton size='sm' variant='danger' onClick={handleSignOut}>
                退出登录
              </KdyButton>
            </View>
          </View>
        )}
      </KdyCard>

      <KdyCard title='隐私与合规' elevated={false}>
        {PRIVACY_RULES.map((rule) => (
          <View key={rule.title} className='kdy-profile__rule'>
            <Text className='kdy-profile__rule-title'>{rule.title}</Text>
            <Text className='kdy-profile__rule-detail'>{rule.detail}</Text>
          </View>
        ))}
      </KdyCard>

      <KdyCard title='关于' elevated={false}>
        <Text className='kdy-profile__hint'>
          可达鸭（KedaYa）· 上海科技大学统一校园服务平台 · 第三方开源项目（非官方）。
        </Text>
        <Text className='kdy-profile__hint'>
          吉祥物为原创美术，与任何第三方角色形象无关。
        </Text>
      </KdyCard>

      <Text className='kdy-disclaimer'>
        可达鸭是第三方非官方校园服务平台，与上海科技大学官方系统无关。
      </Text>
    </View>
  )
}
