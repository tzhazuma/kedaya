import { Text, View } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { ArrowRight } from '@taroify/icons'
import { useState } from 'react'

import { getContainer } from '../../../app/container'
import { PAGE_PATHS } from '../../../app/routes'
import type { WechatStatusDto } from '../../../domain/models/auth'
import { PRIVACY_RULES } from '../../../presentation/content/legal'
import { navigateTo, toast } from '../../../platform/navigation'
import { KdyAgentFab, KdyAvatar, KdyButton, KdyCard, KdyTag } from '../../components'
import { KdyHeading } from '../../components/KdyHeading'
import { useStore } from '../../hooks'
import './index.scss'

/**
 * 我的 —— 账号信息 + 账号安全 + 校园服务入口 + 隐私合规声明。
 *
 * 账号体系接真实后端（`/auth/account/*`、`/auth/wechat/*`、`/auth/me`）：
 *   · 未登录 → 提供「登录」「注册」入口；
 *   · 已登录 → 昵称/头像可改；微信可绑定/解绑；邮箱密码可绑定/修改；可退出登录。
 *
 * 三条登录路径（CAS / 邮箱密码 / 微信）在界面上是**对等**的：
 * 任何一条都能登录，但只要还有别的路径，就允许解绑另一条 ——
 * 「至少保留一种登录方式」由后端强校验（绑微信/解绑微信都会检查）。
 *
 * 登录 ≠ 绑定校园系统：`campusBound` 为 false 时，校园能力会被后端
 * 以 `CAMPUS_BINDING_REQUIRED` 拦下（契约 §5 硬规则 3）。
 */

export default function ProfilePage() {
  const container = getContainer()
  const session = container.useCases.session
  const auth = container.useCases.auth
  const state = useStore(session)

  const [signingOut, setSigningOut] = useState(false)
  const [wechat, setWechat] = useState<WechatStatusDto | null>(null)
  const [wechatBusy, setWechatBusy] = useState(false)
  const [accountError, setAccountError] = useState<string | null>(null)

  /**
   * 微信绑定状态不放在会话里（它随时可能被其它设备改），
   * 因此每次回到本页都重新拉一次；失败就静默保留上一次的结果。
   */
  async function refreshWechatStatus(): Promise<void> {
    if (state.profile === null) {
      setWechat(null)
      return
    }
    const result = await auth.wechatStatus()
    if (result.ok) setWechat(result.value)
  }

  useDidShow(() => {
    void refreshWechatStatus()
  })

  async function handleSignOut(): Promise<void> {
    if (signingOut) return
    setSigningOut(true)
    await auth.logout()
    setSigningOut(false)
    setWechat(null)
    toast('已退出登录')
  }

  async function handleBindWechat(): Promise<void> {
    if (wechatBusy) return
    setAccountError(null)
    setWechatBusy(true)
    const result = await auth.bindWechat()
    setWechatBusy(false)

    if (!result.ok) {
      setAccountError(result.error.message)
      return
    }
    setWechat(result.value)
    toast('微信已绑定', 'success')
  }

  async function handleUnbindWechat(): Promise<void> {
    if (wechatBusy) return
    setAccountError(null)
    const confirmed = await Taro.showModal({
      title: '解绑微信',
      content: '解绑后需要改用邮箱密码登录，确定继续吗？',
      confirmText: '解绑',
      confirmColor: '#d33f3f',
    })
    if (!confirmed.confirm) return

    setWechatBusy(true)
    const result = await auth.unbindWechat()
    setWechatBusy(false)

    if (!result.ok) {
      setAccountError(result.error.message)
      return
    }
    setWechat(result.value)
    toast('微信已解绑')
  }

  const wechatBound = wechat?.bound ?? state.profile?.wechatBound ?? false
  const hasPassword = state.profile?.hasPassword ?? true

  return (
    <View className='kdy-page kdy-profile'>
      <KdyHeading title='我的校园生活' subtitle='在这里，照顾好你的每一件小事。' />
      <View className='kdy-profile__identity kdy-glass'>
        <KdyAvatar src={state.profile?.avatarUrl ?? null} size={64} />
        <View className='kdy-profile__identity-text'>
          <Text className='kdy-profile__name'>{state.profile?.nickname ?? '你好，新同学'}</Text>
          <Text className='kdy-profile__hint'>
            {state.profile ? '今天也要过得开心鸭' : '登录后即可发布、接单、发帖'}
          </Text>
        </View>
      </View>

      {state.profile === null ? (
        <KdyCard title='账号' elevated={false}>
          <Text className='kdy-profile__hint'>
            未登录。浏览内容不需要登录；发布、接单、发帖等写操作需要先登录。
          </Text>
          <View className='kdy-profile__actions'>
            <KdyButton
              size='sm'
              onClick={() => {
                void navigateTo(PAGE_PATHS.authLogin)
              }}
            >
              登录
            </KdyButton>
            <KdyButton
              size='sm'
              variant='ghost'
              onClick={() => {
                void navigateTo(PAGE_PATHS.authRegister)
              }}
            >
              注册新账号
            </KdyButton>
          </View>
        </KdyCard>
      ) : (
        <KdyCard
          title='账号与安全'
          elevated={false}
          extra={
            <Text
              className='kdy-profile__link'
              onClick={() => {
                void navigateTo(PAGE_PATHS.profileEdit)
              }}
            >
              编辑资料
            </Text>
          }
        >
          <View className='kdy-profile__row'>
            <Text className='kdy-profile__k'>昵称</Text>
            <Text className='kdy-profile__v'>{state.profile.nickname}</Text>
          </View>
          <View className='kdy-profile__row'>
            <Text className='kdy-profile__k'>邮箱</Text>
            <Text className='kdy-profile__v'>{state.profile.email ?? '未绑定'}</Text>
          </View>
          <View className='kdy-profile__row'>
            <Text className='kdy-profile__k'>微信</Text>
            <KdyTag tone={wechatBound ? 'success' : 'neutral'}>
              {wechatBound ? (wechat?.simulated ? '已绑定（演示）' : '已绑定') : '未绑定'}
            </KdyTag>
          </View>
          <View className='kdy-profile__row'>
            <Text className='kdy-profile__k'>校园系统</Text>
            <KdyTag tone={state.profile.campusBound ? 'success' : 'warning'}>
              {state.profile.campusBound ? '已绑定' : '未绑定'}
            </KdyTag>
          </View>

          {accountError !== null && <Text className='kdy-profile__error'>{accountError}</Text>}

          <View className='kdy-profile__actions'>
            {hasPassword ? (
              <KdyButton
                size='sm'
                variant='ghost'
                onClick={() => {
                  void navigateTo(PAGE_PATHS.authChangePassword)
                }}
              >
                修改密码
              </KdyButton>
            ) : (
              <KdyButton
                size='sm'
                onClick={() => {
                  void navigateTo(PAGE_PATHS.authBindEmail)
                }}
              >
                绑定邮箱
              </KdyButton>
            )}

            {wechatBound ? (
              <KdyButton
                size='sm'
                variant='ghost'
                disabled={wechat !== null && !wechat.canUnbind}
                loading={wechatBusy}
                onClick={() => void handleUnbindWechat()}
              >
                解绑微信
              </KdyButton>
            ) : (
              <KdyButton size='sm' loading={wechatBusy} onClick={() => void handleBindWechat()}>
                绑定微信
              </KdyButton>
            )}
          </View>

          {wechatBound && wechat !== null && !wechat.canUnbind && (
            <Text className='kdy-profile__hint'>
              当前只有微信一种登录方式，先绑定邮箱密码才能解绑微信。
            </Text>
          )}

          <View className='kdy-profile__actions'>
            <KdyButton
              size='sm'
              variant='danger'
              loading={signingOut}
              onClick={() => void handleSignOut()}
            >
              退出登录
            </KdyButton>
          </View>
        </KdyCard>
      )}

      <KdyCard title='我的资产' elevated={false}>
        <View
          className='kdy-profile__nav'
          onClick={() => {
            void navigateTo(PAGE_PATHS.profileAssets)
          }}
        >
          <View className='kdy-profile__nav-body'>
            <Text className='kdy-profile__nav-title'>我的拼单</Text>
            <Text className='kdy-profile__nav-detail'>
              我发起的、我参与的拼单；其余模块的"我的"入口在各模块列表页
            </Text>
          </View>
          <ArrowRight />
        </View>
      </KdyCard>

      <KdyCard title='校园服务' elevated={false}>
        {[
          {
            label: '首页管理',
            detail: '首页展示哪些服务、排在什么位置，最多 12 个',
            path: PAGE_PATHS.profileHome,
          },
          {
            label: '服务大厅',
            detail: '全部服务按场景分组，找不到就搜一下',
            path: PAGE_PATHS.homeServices,
          },
          { label: '身份与校园绑定', detail: '统一身份 / 教务 / 校园卡，逐系统授权', path: PAGE_PATHS.identity },
          { label: '我的课表', detail: '今天上什么、下一节在哪、还有多久', path: PAGE_PATHS.schedule },
          { label: '校园卡', detail: '余额、消费集中地、异常扣款与挂失指引', path: PAGE_PATHS.campusCard },
          { label: '隐私与数据', detail: '隐私开关、同意管理、导出我的数据', path: PAGE_PATHS.profileSettings },
        ].map((item) => (
          <View
            key={item.path}
            className='kdy-profile__nav'
            onClick={() => {
              void navigateTo(item.path)
            }}
          >
            <View className='kdy-profile__nav-body'>
              <Text className='kdy-profile__nav-title'>{item.label}</Text>
              <Text className='kdy-profile__nav-detail'>{item.detail}</Text>
            </View>
            <ArrowRight />
          </View>
        ))}
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
        <View
          className='kdy-profile__nav'
          onClick={() => {
            void navigateTo(PAGE_PATHS.legalTerms)
          }}
        >
          <View className='kdy-profile__nav-body'>
            <Text className='kdy-profile__nav-title'>用户协议</Text>
            <Text className='kdy-profile__nav-detail'>服务范围、发布规范与交易免责</Text>
          </View>
          <ArrowRight />
        </View>
        <View
          className='kdy-profile__nav'
          onClick={() => {
            void navigateTo(PAGE_PATHS.legalPrivacy)
          }}
        >
          <View className='kdy-profile__nav-body'>
            <Text className='kdy-profile__nav-title'>隐私政策</Text>
            <Text className='kdy-profile__nav-detail'>收集范围、使用目的、撤回与导出</Text>
          </View>
          <ArrowRight />
        </View>

        <Text className='kdy-profile__hint'>
          第三方开源项目（非官方）· 吉祥物为原创美术，与任何第三方角色形象无关。
        </Text>
        {container.env.useMock && (
          <Text className='kdy-profile__hint'>当前是演示模式，数据不会保存。</Text>
        )}
      </KdyCard>

      <Text className='kdy-disclaimer'>
        可达鸭是第三方非官方校园服务平台，与上海科技大学官方系统无关。
      </Text>

      <KdyAgentFab module='profile' page={PAGE_PATHS.profile} />
    </View>
  )
}
