import { Text, View } from '@tarojs/components'
import { useState } from 'react'

import { getContainer } from '../../../../app/container'
import { PAGE_PATHS } from '../../../../app/routes'
import { navigateTo, toast } from '../../../../platform/navigation'
import { passwordIssues } from '../../../../domain/models/auth'
import { KdyButton, KdyCard, KdyMascot } from '../../../components'
import { KdyField } from '../../../components/KdyField'
import { KdyHeading } from '../../../components/KdyHeading'
import { useCountdown } from '../../../hooks/useCountdown'
import { useWechatAuth } from '../../../hooks'
import { backAfterAuthSuccess } from '../backAfterAuthSuccess'
import '../auth.scss'
import './index.scss'

/**
 * 注册页：微信快捷注册 + 邮箱验证码注册。
 *
 * 邮箱三步都在同一页完成（不分页），因为验证码只有 10 分钟有效，
 * 跳来跳去容易超时；而且用户能一直看到自己填过的邮箱。
 * 微信路径不填任何表单：`Taro.login()` → 后端建号 → 直接就是已登录状态
 * （昵称与头像在「我的 → 编辑资料」里随时可补，不挡在注册流程中间）。
 */
export default function RegisterPage() {
  const container = getContainer()
  const auth = container.useCases.auth
  const wechat = useWechatAuth()
  const countdown = useCountdown()

  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [devCode, setDevCode] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const issues = password.length === 0 ? [] : passwordIssues(password)

  async function handleSendCode(): Promise<void> {
    if (sending || countdown.secondsLeft > 0) return
    setError(null)
    setNotice(null)
    setSending(true)
    const result = await auth.requestRegisterCode(email)
    setSending(false)

    if (!result.ok) {
      setError(result.error.message)
      return
    }
    countdown.start(60)
    setNotice(`验证码已发送到 ${result.value.email}，10 分钟内有效`)
    setDevCode(result.value.devCode ?? null)
  }

  async function handleSubmit(): Promise<void> {
    if (submitting) return
    setError(null)
    setSubmitting(true)
    const result = await auth.register({
      email,
      code,
      password,
      ...(displayName.trim() === '' ? {} : { displayName: displayName.trim() }),
    })
    setSubmitting(false)

    if (!result.ok) {
      setError(result.error.message)
      return
    }
    toast('注册成功，欢迎加入', 'success')
    await backAfterAuthSuccess()
  }

  return (
    <View className='kdy-page kdy-auth'>
      <KdyHeading
        title='创建账号'
        subtitle='一个邮箱就够了。不会向任何校园系统索要你的密码。'
      />

      <KdyCard className='kdy-auth__quick-card' elevated>
        <View className='kdy-auth__quick'>
          <View className='kdy-auth__quick-mark'>
            <KdyMascot size={46} />
          </View>
          <View className='kdy-auth__quick-body'>
            <Text className='kdy-auth__quick-title'>微信一键注册</Text>
            <Text className='kdy-auth__quick-note'>
              不想填邮箱？直接建号，之后随时可以补邮箱密码。
            </Text>
          </View>
        </View>

        {wechat.error !== null && <Text className='kdy-auth__error'>{wechat.error}</Text>}

        <View className='kdy-auth__actions'>
          <KdyButton size='lg' block loading={wechat.pending} onClick={() => void wechat.loginWithWechat()}>
            一键注册
          </KdyButton>
        </View>
      </KdyCard>

      <View className='kdy-auth__divider'>
        <View className='kdy-auth__divider-line' />
        <Text className='kdy-auth__divider-text'>或用邮箱注册</Text>
        <View className='kdy-auth__divider-line' />
      </View>

      <KdyCard elevated={false}>
        <View className='kdy-auth__form'>
          <View className='kdy-auth__inline'>
            <KdyField
              label='邮箱'
              value={email}
              onChange={setEmail}
              placeholder='name@example.com'
              maxLength={254}
            />
            <KdyButton
              size='sm'
              variant='ghost'
              loading={sending}
              disabled={countdown.secondsLeft > 0 || email.trim() === ''}
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

          <KdyField
            label='密码'
            value={password}
            onChange={setPassword}
            placeholder='至少 8 位，含字母和数字'
            password
            maxLength={64}
            error={issues.length > 0 ? issues.join('、') : null}
            hint='建议使用 12 位以上的随机密码，不要用学号或生日'
          />

          <KdyField
            label='昵称'
            value={displayName}
            onChange={setDisplayName}
            placeholder='选填，默认用邮箱前缀'
            type='nickname'
            maxLength={24}
            hint='微信内可点输入框上方的「使用微信昵称」'
          />
        </View>

        {notice !== null && <Text className='kdy-auth__tip'>{notice}</Text>}
        {error !== null && <Text className='kdy-auth__error'>{error}</Text>}
        {devCode !== null && devCode !== '' && (
          <Text
            className='kdy-auth__dev'
            onClick={() => setCode(devCode)}
          >
            开发模式：后端未配置邮件服务，验证码直接返回 —— {devCode}（点此填入）
          </Text>
        )}

        <View className='kdy-auth__actions'>
          <KdyButton block loading={submitting} onClick={() => void handleSubmit()}>
            注册并登录
          </KdyButton>
        </View>

        <View className='kdy-auth__links'>
          <Text
            className='kdy-auth__link'
            onClick={() => {
              void navigateTo(PAGE_PATHS.authLogin)
            }}
          >
            已有账号，去登录
          </Text>
        </View>
      </KdyCard>

      <Text className='kdy-disclaimer'>
        第三方非官方平台 · 与上海科技大学官方系统无关。
      </Text>
    </View>
  )
}
