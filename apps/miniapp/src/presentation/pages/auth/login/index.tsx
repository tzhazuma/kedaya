import { Text, View } from '@tarojs/components'
import { useState } from 'react'

import { getContainer } from '../../../../app/container'
import { PAGE_PATHS } from '../../../../app/routes'
import { navigateTo, toast } from '../../../../platform/navigation'
import { KdyButton, KdyCard, KdyChip } from '../../../components'
import { KdyField } from '../../../components/KdyField'
import { KdyHeading } from '../../../components/KdyHeading'
import { useCountdown } from '../../../hooks/useCountdown'
import { useWechatAuth } from '../../../hooks'
import { backAfterAuthSuccess } from '../backAfterAuthSuccess'
import '../auth.scss'
import './index.scss'

/**
 * 登录页（微信一键登录 + 邮箱密码 + 邮箱验证码）。
 *
 * 三条路径签发的是**同一套 KedaYa 自有 JWT**（契约 §5 第一级身份层）：
 *   · 微信：`Taro.login()` → code → 后端 `jscode2session` → openid → 自有 JWT；
 *     首次登录会自动建号（`isNewUser`），随后引导「完善昵称与头像」。
 *   · 邮箱密码：`POST /auth/account/login`。
 *   · 邮箱验证码（免密）：`POST /auth/account/login/code` 发码 →
 *     `POST /auth/account/login/code/verify` 换 JWT；首次登录自动建号。
 *     仅接受 `@shanghaitech.edu.cn` / `@stu.shanghaitech.edu.cn`（后端 `isCampusEmail`）。
 * 登录 ≠ 已绑定校园系统：`profile.campusBound` 恒为 false，
 * 校园能力由后端返回 `CAMPUS_BINDING_REQUIRED` 引导用户去绑定。
 */
type EmailMode = 'password' | 'code'

export default function LoginPage() {
  const container = getContainer()
  const auth = container.useCases.auth
  const wechat = useWechatAuth()
  const countdown = useCountdown()

  const [mode, setMode] = useState<EmailMode>('password')

  // 邮箱 + 密码
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // 邮箱验证码（免密）
  const [codeEmail, setCodeEmail] = useState('')
  const [code, setCode] = useState('')
  const [codeError, setCodeError] = useState<string | null>(null)
  const [codeNotice, setCodeNotice] = useState<string | null>(null)
  const [devCode, setDevCode] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [codeSubmitting, setCodeSubmitting] = useState(false)

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

  async function handleSendCode(): Promise<void> {
    if (sending || countdown.secondsLeft > 0) return
    setCodeError(null)
    setCodeNotice(null)
    setSending(true)
    const result = await auth.requestLoginCode(codeEmail)
    setSending(false)

    if (!result.ok) {
      setCodeError(result.error.message)
      return
    }
    countdown.start(60)
    setCodeNotice(`验证码已发送到 ${result.value.email}，10 分钟内有效`)
    setDevCode(result.value.devCode ?? null)
  }

  async function handleCodeSubmit(): Promise<void> {
    if (codeSubmitting) return
    setCodeError(null)
    setCodeSubmitting(true)
    const result = await auth.loginWithCode({ email: codeEmail, code })
    setCodeSubmitting(false)

    if (!result.ok) {
      setCodeError(result.error.message)
      return
    }
    toast('欢迎回来鸭', 'success')
    await backAfterAuthSuccess()
  }

  return (
    <View className='kdy-page kdy-auth'>
      <KdyHeading
        title='欢迎回来'
        subtitle='登录后即可发布、接单、发帖，和同学一起过日子。'
        eyebrow='KEDAYA · 账号'
      />

      <KdyCard title='微信一键登录' elevated={false}>
        <Text className='kdy-auth__tip'>
          使用当前微信账号登录；第一次使用会自动创建可达鸭账号，
          随后你可以设置昵称与头像。我们只获取微信标识用于登录，不会读取你的聊天记录。
        </Text>

        {wechat.error !== null && <Text className='kdy-auth__error'>{wechat.error}</Text>}

        <View className='kdy-auth__actions'>
          <KdyButton block loading={wechat.pending} onClick={() => void wechat.loginWithWechat()}>
            微信一键登录 / 注册
          </KdyButton>
        </View>
      </KdyCard>

      <KdyCard title='邮箱登录' elevated={false}>
        <View className='kdy-auth__modes'>
          <KdyChip active={mode === 'password'} onClick={() => setMode('password')}>
            密码登录
          </KdyChip>
          <KdyChip active={mode === 'code'} onClick={() => setMode('code')}>
            验证码登录（免密）
          </KdyChip>
        </View>

        {mode === 'password' ? (
          <>
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
              <KdyButton
                variant='secondary'
                block
                loading={submitting}
                onClick={() => void handleSubmit()}
              >
                登录
              </KdyButton>
            </View>
          </>
        ) : (
          <>
            <Text className='kdy-auth__tip'>
              用上海科技大学邮箱收取一次性验证码，免密码登录。
              第一次使用会自动建号，之后可以随时补一个密码。
            </Text>

            <View className='kdy-auth__form'>
              <View className='kdy-auth__inline'>
                <KdyField
                  label='校园邮箱'
                  value={codeEmail}
                  onChange={setCodeEmail}
                  placeholder='name@stu.shanghaitech.edu.cn'
                  maxLength={254}
                />
                <KdyButton
                  size='sm'
                  variant='ghost'
                  loading={sending}
                  disabled={countdown.secondsLeft > 0 || codeEmail.trim() === ''}
                  onClick={() => void handleSendCode()}
                >
                  {countdown.secondsLeft > 0 ? `${countdown.secondsLeft}s` : '发送验证码'}
                </KdyButton>
              </View>

              <KdyField
                label='验证码'
                value={code}
                onChange={setCode}
                placeholder='6 位数字'
                type='number'
                maxLength={6}
              />
            </View>

            {codeNotice !== null && <Text className='kdy-auth__tip'>{codeNotice}</Text>}
            {codeError !== null && <Text className='kdy-auth__error'>{codeError}</Text>}
            {devCode !== null && devCode !== '' && (
              <Text className='kdy-auth__dev' onClick={() => setCode(devCode)}>
                开发模式：后端未配置邮件服务，验证码直接返回 —— {devCode}（点此填入）
              </Text>
            )}

            <View className='kdy-auth__actions'>
              <KdyButton block loading={codeSubmitting} onClick={() => void handleCodeSubmit()}>
                验证码登录 / 注册
              </KdyButton>
            </View>
          </>
        )}

        {container.env.useMock && (
          <Text className='kdy-auth__dev'>
            当前是本地演示模式（未连后端）。演示账号：demo@kedaya.dev / Kedaya2026；
            验证码登录会直接显示验证码。
          </Text>
        )}

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
        可达鸭是第三方非官方校园服务平台，与上海科技大学官方系统无关。
      </Text>
    </View>
  )
}
