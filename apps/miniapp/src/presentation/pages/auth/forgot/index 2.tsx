import { Text, View } from '@tarojs/components'
import { useState } from 'react'

import { getContainer } from '../../../../app/container'
import { PAGE_PATHS } from '../../../../app/routes'
import { navigateTo, toast } from '../../../../platform/navigation'
import { passwordIssues } from '../../../../domain/models/auth'
import { KdyButton, KdyCard } from '../../../components'
import { KdyField } from '../../../components/KdyField'
import { KdyHeading } from '../../../components/KdyHeading'
import { useCountdown } from '../../../hooks/useCountdown'
import '../auth.scss'
import './index.scss'

/**
 * 找回密码：邮箱验证码 → 设置新密码。
 *
 * 隐私细节：无论邮箱是否注册过，后端都返回 `sent: true`（防账号枚举），
 * 因此这里**不能**根据返回结果提示"该邮箱不存在"—— 那会泄漏同一信息。
 * 重置成功后所有设备下线，用户需要用新密码重新登录。
 */
export default function ForgotPasswordPage() {
  const container = getContainer()
  const auth = container.useCases.auth
  const countdown = useCountdown()

  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
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
    const result = await auth.requestResetCode(email)
    setSending(false)

    if (!result.ok) {
      setError(result.error.message)
      return
    }
    countdown.start(60)
    setNotice(`如果 ${result.value.email} 已注册，验证码会在几分钟内送达`)
    setDevCode(result.value.devCode ?? null)
  }

  async function handleSubmit(): Promise<void> {
    if (submitting) return
    setError(null)
    setSubmitting(true)
    const result = await auth.resetPassword({ email, code, password })
    setSubmitting(false)

    if (!result.ok) {
      setError(result.error.message)
      return
    }
    toast('密码已重置，请重新登录', 'success')
    await navigateTo(PAGE_PATHS.authLogin)
  }

  return (
    <View className='kdy-page kdy-auth'>
      <KdyHeading
        title='找回密码'
        subtitle='用注册邮箱收一条验证码，就能设置新密码。'
        eyebrow='KEDAYA · 账号安全'
      />

      <KdyCard title='重置密码' elevated={false}>
        <View className='kdy-auth__form'>
          <View className='kdy-auth__inline'>
            <KdyField
              label='邮箱'
              value={email}
              onChange={setEmail}
              placeholder='注册时使用的邮箱'
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
            label='新密码'
            value={password}
            onChange={setPassword}
            placeholder='至少 8 位，含字母和数字'
            password
            maxLength={64}
            error={issues.length > 0 ? issues.join('、') : null}
          />
        </View>

        {notice !== null && <Text className='kdy-auth__tip'>{notice}</Text>}
        {error !== null && <Text className='kdy-auth__error'>{error}</Text>}
        {devCode !== null && devCode !== '' && (
          <Text className='kdy-auth__dev' onClick={() => setCode(devCode)}>
            开发模式：验证码直接返回 —— {devCode}（点此填入）
          </Text>
        )}

        <View className='kdy-auth__actions'>
          <KdyButton block loading={submitting} onClick={() => void handleSubmit()}>
            重置密码
          </KdyButton>
        </View>

        <View className='kdy-auth__links'>
          <Text
            className='kdy-auth__link'
            onClick={() => {
              void navigateTo(PAGE_PATHS.authLogin)
            }}
          >
            返回登录
          </Text>
        </View>
      </KdyCard>

      <Text className='kdy-disclaimer'>
        重置成功后，其他设备上的登录会立即失效。
      </Text>
    </View>
  )
}
