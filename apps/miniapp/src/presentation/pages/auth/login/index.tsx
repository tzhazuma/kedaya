import { Text, View } from '@tarojs/components'
import { useState } from 'react'

import { getContainer } from '../../../../app/container'
import { PAGE_PATHS } from '../../../../app/routes'
import { navigateTo, toast } from '../../../../platform/navigation'
import { KdyButton, KdyCard, KdyChip, KdyMascot } from '../../../components'
import { KdyField } from '../../../components/KdyField'
import { KdyHeading } from '../../../components/KdyHeading'
import { useCountdown, useWechatAuth } from '../../../hooks'
import { backAfterAuthSuccess } from '../backAfterAuthSuccess'
import '../auth.scss'
import './index.scss'

/**
 * 登录页（微信一键登录 + 邮箱密码 / 邮箱验证码）。
 *
 * 三条路径签发的是**同一套 KedaYa 自有 JWT**（契约 §5 第一级身份层）：
 *   · 微信：`Taro.login()` → code → 后端 `jscode2session` → openid → 自有 JWT；
 *     首次登录会自动建号，一步到位。
 *   · 邮箱密码：`POST /auth/account/login`。
 *   · 邮箱验证码（免密）：`POST /auth/account/login/code` 发码 →
 *     `POST /auth/account/login/code/verify` 换 JWT；**首次登录自动建号**。
 *     仅接受 `@shanghaitech.edu.cn` / `@stu.shanghaitech.edu.cn`（后端 `isCampusEmail`）。
 * 登录 ≠ 已绑定校园系统：`profile.campusBound` 恒为 false，
 * 校园能力由后端返回 `CAMPUS_BINDING_REQUIRED` 引导用户去绑定。
 *
 * 页面顺序是**先微信、后邮箱**：小程序里绝大多数用户只有一种可用登录方式，
 * 把邮箱表单放在首屏第一眼会让人以为"必须先注册个邮箱账号"。
 * 所以首屏是一块"一键登录"的主视觉，邮箱表单退到「或使用邮箱」之后 ——
 * 需要它的人一眼能找到，不需要它的人不用先读三个输入框。
 *
 * 邮箱内部再分**密码 / 验证码**两档（`KdyChip` 切换）：
 * 验证码是给「忘了密码」和「不想给平台存密码」的人准备的 ——
 * 忘记密码要走邮件找回（多一封邮件、多一次跳转），验证码登录只多一次输入。
 * 首次用验证码登录会建一个**免密账号**，之后仍可用验证码进，也可以在设置里补密码。
 *
 * 这一页**不出现任何演示账号 / 演示模式的字样**：它是产品给真实用户看的门面，
 * Mock 凭据放在开发用的折叠面板里（见 `KdyDemoTools`）与 `docs/local-development.md`。
 */

/** 邮箱登录的两种凭据形态 */
type EmailMode = 'password' | 'code'

export default function LoginPage() {
  const container = getContainer()
  const auth = container.useCases.auth
  const wechat = useWechatAuth()

  const [emailMode, setEmailMode] = useState<EmailMode>('password')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [sendingCode, setSendingCode] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const countdown = useCountdown()

  /** 发验证码（60 秒冷却由后端强制，这里只做视觉倒计时） */
  async function handleSendCode(): Promise<void> {
    if (sendingCode || countdown.secondsLeft > 0) return
    setError(null)
    setSendingCode(true)
    const result = await auth.requestLoginCode(email)
    setSendingCode(false)

    if (!result.ok) {
      setError(result.error.message)
      return
    }
    // 后端**不区分邮箱是否已注册**（防枚举），所以这里也不提示"未注册"
    // 冷却 60 秒（后端也有同样的发送频控，这里只做视觉倒计时）
    countdown.start(60)
    toast('验证码已发送，请查收校园邮箱', 'success')
  }

  async function handleSubmit(): Promise<void> {
    if (submitting) return
    setError(null)
    setSubmitting(true)

    const result =
      emailMode === 'code'
        ? await auth.loginWithCode({ email, code })
        : await auth.login({ email, password })
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
        <Text className='kdy-auth__divider-text'>或使用邮箱</Text>
        <View className='kdy-auth__divider-line' />
      </View>

      <KdyCard elevated={false}>
        {/* 密码 / 验证码 二选一 */}
        <View className='kdy-auth__modes'>
          <KdyChip
            active={emailMode === 'password'}
            onClick={() => {
              setEmailMode('password')
              setError(null)
            }}
          >
            邮箱密码
          </KdyChip>
          <KdyChip
            active={emailMode === 'code'}
            onClick={() => {
              setEmailMode('code')
              setError(null)
            }}
          >
            邮箱验证码
          </KdyChip>
        </View>

        <View className='kdy-auth__form'>
          <KdyField
            label='邮箱'
            value={email}
            onChange={setEmail}
            placeholder={
              emailMode === 'code' ? '校园邮箱，如 you@stu.shanghaitech.edu.cn' : '请输入校园邮箱或常用邮箱'
            }
            maxLength={254}
          />

          {emailMode === 'password' ? (
            <KdyField
              label='密码'
              value={password}
              onChange={setPassword}
              placeholder='请输入密码'
              password
              maxLength={64}
            />
          ) : (
            <View className='kdy-auth__code-row'>
              <View className='kdy-auth__code-field'>
                <KdyField
                  label='验证码'
                  value={code}
                  onChange={setCode}
                  placeholder='6 位数字'
                  maxLength={6}
                />
              </View>
              <KdyButton
                variant='secondary'
                size='sm'
                disabled={sendingCode || countdown.secondsLeft > 0}
                onClick={() => void handleSendCode()}
              >
                {countdown.secondsLeft > 0 ? `${countdown.secondsLeft}s` : '获取验证码'}
              </KdyButton>
            </View>
          )}
        </View>

        {emailMode === 'code' && (
          <Text className='kdy-auth__hint'>
            首次用验证码登录会自动建号（免密）。仅支持上海科技大学邮箱
            （<Text className='kdy-auth__hint-strong'>@shanghaitech.edu.cn</Text> /
            <Text className='kdy-auth__hint-strong'>@stu.shanghaitech.edu.cn</Text>）。
          </Text>
        )}

        {error !== null && <Text className='kdy-auth__error'>{error}</Text>}

        <View className='kdy-auth__actions'>
          <KdyButton variant='secondary' block loading={submitting} onClick={() => void handleSubmit()}>
            {emailMode === 'code' ? '验证码登录' : '登录'}
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
          {emailMode === 'password' && (
            <Text
              className='kdy-auth__link'
              onClick={() => {
                void navigateTo(PAGE_PATHS.authForgot)
              }}
            >
              忘记密码
            </Text>
          )}
        </View>
      </KdyCard>

      <Text className='kdy-disclaimer'>
        第三方非官方平台 · 与上海科技大学官方系统无关。
      </Text>
    </View>
  )
}
