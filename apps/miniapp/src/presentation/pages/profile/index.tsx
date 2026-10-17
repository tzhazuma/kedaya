import { Text, View } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import {
  AppsOutlined,
  ArrowRight,
  Certificate,
  ClockOutlined,
  EcardPay,
  QuestionOutlined,
  SettingOutlined,
  ShieldOutlined,
  ShoppingCartOutlined,
} from '@taroify/icons'
import { useState } from 'react'

import { getContainer } from '../../../app/container'
import { PAGE_PATHS } from '../../../app/routes'
import type { WechatStatusDto } from '../../../domain/models/auth'
import { navigateTo, toast } from '../../../platform/navigation'
import { KdyAgentFab, KdyAvatar, KdyButton, KdyCard, KdyTag } from '../../components'
import { KdyHeading } from '../../components/KdyHeading'
import { useStore } from '../../hooks'
import './index.scss'

/**
 * 我的 —— 身份卡 + 常用功能宫格 + 账号安全 + 关于。
 *
 * ## 为什么是宫格而不是一长列
 *
 * 这里曾经把「我的拼单 / 课表 / 校园卡 / 身份 / 首页管理 / 服务大厅 /
 * 隐私与数据」逐条摊开、每条还带一句说明，加上隐私合规与关于，整页要滑
 * 三四屏才能到底 —— 而"我的"是**目的地**，不是内容页。
 * 现在：入口收成 4 列宫格（一行 4 个、两行放完），说明只留在真正需要解释的
 * 地方（服务大厅的搜索、各自主页面）。合规要点不在这里复述，
 * 它们各自的主页（隐私与数据 / 用户协议 / 隐私政策）本来就是权威位置。
 *
 * ## 账号体系
 *
 * 三条登录路径（CAS / 邮箱密码 / 微信）在界面上**对等**：任何一条都能登录，
 * 只要还有别的路径就允许解绑另一条 ——「至少保留一种登录方式」由后端强校验。
 * 登录 ≠ 绑定校园系统：`campusBound` 为 false 时校园能力会被后端拦下（契约 §5）。
 */

/** 常用功能：id 与路径都来自 `app/routes.ts`，这里只决定"显示哪几个、什么图标" */
const TOOLS: readonly {
  label: string
  path: string
  Icon: typeof ShoppingCartOutlined
}[] = [
  { label: '我的拼单', path: PAGE_PATHS.profileAssets, Icon: ShoppingCartOutlined },
  { label: '我的课表', path: PAGE_PATHS.schedule, Icon: ClockOutlined },
  { label: '校园卡', path: PAGE_PATHS.campusCard, Icon: EcardPay },
  { label: '身份绑定', path: PAGE_PATHS.identity, Icon: Certificate },
  { label: '首页管理', path: PAGE_PATHS.profileHome, Icon: SettingOutlined },
  { label: '服务大厅', path: PAGE_PATHS.homeServices, Icon: AppsOutlined },
  { label: '隐私与数据', path: PAGE_PATHS.profileSettings, Icon: ShieldOutlined },
  { label: '常见问题', path: PAGE_PATHS.faq, Icon: QuestionOutlined },
]

/** 关于：两份法务文档（内容与 `presentation/content/legal` 同源） */
const DOCS: readonly { label: string; path: string }[] = [
  { label: '用户协议', path: PAGE_PATHS.legalTerms },
  { label: '隐私政策', path: PAGE_PATHS.legalPrivacy },
]

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

  const profile = state.profile
  const wechatBound = wechat?.bound ?? profile?.wechatBound ?? false
  const hasPassword = profile?.hasPassword ?? true

  /** 身份卡的一行状态：登录方式与校园绑定一眼看全，不用去别的页面找 */
  const statusLine =
    profile === null
      ? '登录后即可发布、接单、发帖'
      : [
          profile.campusBound ? '校园系统已绑定' : '校园系统未绑定',
          profile.email === null ? '邮箱未绑定' : '邮箱已绑定',
          wechatBound ? '微信已绑定' : '微信未绑定',
        ].join(' · ')

  function openIdentityCard(): void {
    void navigateTo(profile === null ? PAGE_PATHS.authLogin : PAGE_PATHS.profileEdit)
  }

  return (
    <View className='kdy-page kdy-profile'>
      <KdyHeading title='我的' />

      <View
        className='kdy-profile__identity kdy-glass'
        onClick={openIdentityCard}
        hoverClass='kdy-card--pressed'
        hoverStayTime={70}
      >
        <KdyAvatar src={profile?.avatarUrl ?? null} size={56} />
        <View className='kdy-profile__identity-text'>
          <Text className='kdy-profile__name'>{profile?.nickname ?? '未登录'}</Text>
          <Text className='kdy-profile__hint'>{statusLine}</Text>
        </View>
        <Text className='kdy-profile__identity-action'>
          {profile === null ? '登录' : '编辑资料'}
        </Text>
      </View>

      <KdyCard title='常用功能'>
        <View className='kdy-profile__grid'>
          {TOOLS.map((tool) => (
            <View
              key={tool.path}
              className='kdy-profile__grid-item'
              onClick={() => {
                void navigateTo(tool.path)
              }}
            >
              <View className='kdy-module-icon'>
                <tool.Icon />
              </View>
              <Text className='kdy-profile__grid-name'>{tool.label}</Text>
            </View>
          ))}
        </View>
      </KdyCard>

      <KdyCard title='账号与安全' elevated={false}>
        {profile === null ? (
          <>
            <Text className='kdy-profile__hint'>
              浏览不需要登录；发布、接单、发帖等写操作需要先登录。
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
          </>
        ) : (
          <>
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

              <KdyButton
                size='sm'
                variant='ghost'
                loading={signingOut}
                onClick={() => void handleSignOut()}
              >
                退出登录
              </KdyButton>
            </View>

            <View className='kdy-profile__row'>
              <Text className='kdy-profile__k'>邮箱</Text>
              <Text className='kdy-profile__v'>{profile.email ?? '未绑定'}</Text>
            </View>

            <View className='kdy-profile__badges'>
              <KdyTag tone={profile.campusBound ? 'success' : 'warning'}>
                {profile.campusBound ? '校园系统已绑定' : '校园系统未绑定'}
              </KdyTag>
              <KdyTag tone={wechatBound ? 'success' : 'neutral'}>
                {wechatBound ? '微信已绑定' : '微信未绑定'}
              </KdyTag>
            </View>

            {wechatBound && wechat !== null && !wechat.canUnbind && (
              <Text className='kdy-profile__hint'>
                当前只有微信一种登录方式，先绑定邮箱密码才能解绑微信。
              </Text>
            )}
          </>
        )}
      </KdyCard>

      <KdyCard title='关于' elevated={false}>
        {DOCS.map((doc) => (
          <View
            key={doc.path}
            className='kdy-profile__nav'
            onClick={() => {
              void navigateTo(doc.path)
            }}
          >
            <Text className='kdy-profile__nav-title'>{doc.label}</Text>
            <ArrowRight />
          </View>
        ))}

        {container.env.useMock && (
          <Text className='kdy-profile__hint'>当前是演示模式，数据不会保存。</Text>
        )}

        <Text className='kdy-profile__hint'>
          第三方开源项目（非官方）· 吉祥物为原创美术，与任何第三方角色形象无关。
        </Text>
      </KdyCard>

      <Text className='kdy-disclaimer'>
        第三方非官方平台 · 与上海科技大学官方系统无关。
      </Text>

      <KdyAgentFab module='profile' page={PAGE_PATHS.profile} />
    </View>
  )
}
