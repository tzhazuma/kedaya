import { Text, View } from '@tarojs/components'
import { useState } from 'react'

import { getContainer } from '../../../../app/container'
import { PAGE_PATHS } from '../../../../app/routes'
import { navigateTo, toast } from '../../../../platform/navigation'
import { KdyButton, KdyCard, KdyMascot } from '../../../components'
import { KdyField } from '../../../components/KdyField'
import { KdyHeading } from '../../../components/KdyHeading'
import { useWechatAuth } from '../../../hooks'
import { backAfterAuthSuccess } from '../backAfterAuthSuccess'
import '../auth.scss'
import './index.scss'

/**
 * 登录页（微信一键登录 + 邮箱密码）。
 *
 * 两条路径签发的是**同一套 KedaYa 自有 JWT**（契约 §5 第一级身份层）：
 *   · 微信：`Taro.login()` → code → 后端 `jscode2session` → openid → 自有 JWT；
 *     首次登录会自动建号，一步到位。
 *   · 邮箱：`/auth/account/login`。
 * 登录 ≠ 已绑定校园系统：`profile.campusBound` 恒为 false，
 * 校园能力由后端返回 `CAMPUS_BINDING_REQUIRED` 引导用户去绑定。
 *
 * 页面顺序是**先微信、后邮箱**：小程序里绝大多数用户只有一种可用登录方式，
 * 把邮箱表单放在首屏第一眼会让人以为"必须先注册个邮箱账号"。
 * 所以首屏是一块"一键登录"的主视觉，邮箱表单退到「或使用邮箱密码」之后 ——
 * 需要它的人一眼能找到，不需要它的人不用先读三个输入框。
 *
 * 这一页**不出现任何演示账号 / 演示模式的字样**：它是产品给真实用户看的门面，
 * Mock 凭据放在开发用的折叠面板里（见 `KdyDemoTools`）与 `docs/local-development.md`。
 */
export default function LoginPage() {
  const container = getContainer()
  const auth = container.useCases.auth
  const wechat = useWechatAuth()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(): Promise<void> {
    if (submitting) return
    setError(null)
    setSubmitting(true)
    const result = await auth.login({ email, password })
    setSubmitting(false)

    if (!result.ok) {
      setError(result.error.message)
      return
    }
    toast('欢迎回来鸭', 'success')
    await backAfterAuthSuccess()
  }

  return (
    <View className='kdy-page kdy-auth'>
      <KdyHeading title='欢迎回来' subtitle='登录后即可发布、接单、发帖。' />

      <KdyCard className='kdy-auth__quick-card' elevated>
        <View className='kdy-auth__quick'>
          <View className='kdy-auth__quick-mark'>
            <KdyMascot size={46} />
          </View>
          <View className='kdy-auth__quick-body'>
            <Text className='kdy-auth__quick-title'>微信一键登录</Text>
            <Text className='kdy-auth__quick-note'>
              首次使用会自动建号，昵称与头像稍后随时可改。
            </Text>
          </View>
        </View>

        {wechat.error !== null && <Text className='kdy-auth__error'>{wechat.error}</Text>}

        <View className='kdy-auth__actions'>
          <KdyButton size='lg' block loading={wechat.pending} onClick={() => void wechat.loginWithWechat()}>
            一键登录
          </KdyButton>
        </View>
      </KdyCard>

      <View className='kdy-auth__divider'>
        <View className='kdy-auth__divider-line' />
        <Text className='kdy-auth__divider-text'>或使用邮箱密码</Text>
        <View className='kdy-auth__divider-line' />
      </View>

      <KdyCard elevated={false}>
        <View className='kdy-auth__form'>
          <KdyField
            label='邮箱'
            value={email}
            onChange={setEmail}
            placeholder='请输入校园邮箱或常用邮箱'
            maxLength={254}
          />
          <KdyField
            label='密码'
            value={password}
            onChange={setPassword}
            placeholder='请输入密码'
            password
            maxLength={64}
          />
        </View>

        {error !== null && <Text className='kdy-auth__error'>{error}</Text>}

        <View className='kdy-auth__actions'>
          <KdyButton variant='secondary' block loading={submitting} onClick={() => void handleSubmit()}>
            登录
          </KdyButton>
        </View>

        <View className='kdy-auth__links'>
          <Text
            className='kdy-auth__link'
            onClick={() => {
              void navigateTo(PAGE_PATHS.authRegister)
            }}
          >
            注册新账号
          </Text>
          <Text
            className='kdy-auth__link'
            onClick={() => {
              void navigateTo(PAGE_PATHS.authForgot)
            }}
          >
            忘记密码
          </Text>
        </View>
      </KdyCard>

      <Text className='kdy-disclaimer'>
        第三方非官方平台 · 与上海科技大学官方系统无关。
      </Text>
    </View>
  )
}
