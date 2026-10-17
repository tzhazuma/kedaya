import { Text, View } from '@tarojs/components'
import { useState } from 'react'

import { getContainer } from '../../../../app/container'
import { passwordIssues } from '../../../../domain/models/auth'
import { toast } from '../../../../platform/navigation'
import { KdyButton, KdyCard } from '../../../components'
import { KdyField } from '../../../components/KdyField'
import { KdyHeading } from '../../../components/KdyHeading'
import { useCountdown } from '../../../hooks/useCountdown'
import { backAfterAuthSuccess } from '../backAfterAuthSuccess'
import '../auth.scss'
import './index.scss'

/**
 * 绑定邮箱（给微信账号补一条后路）。
 *
 * 为什么必须有这一页：只用微信一键注册的账号**没有任何找回手段** ——
 * 换手机、微信异常或被封，就再也进不来了。绑上邮箱密码后：
 *   · 多一条登录路径（邮箱 + 密码）；
 *   · 可以用「忘记密码」自助重置；
 *   · 「解绑微信」才有意义（后端会检查账号是否还有别的登录方式）。
 *
 * 凭据挂在**同一个 userId** 上，不会新建账号（后端 `/auth/account/bind-email`）。
 */
export default function BindEmailPage() {
  const auth = getContainer().useCases.auth
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
    const result = await auth.requestBindEmailCode(email)
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
    const result = await auth.bindEmail({ email, code, password })
    setSubmitting(false)

    if (!result.ok) {
      setError(result.error.message)
      return
    }
    toast('邮箱绑定成功', 'success')
    await backAfterAuthSuccess()
  }

  return (
    <View className='kdy-page kdy-auth'>
      <KdyHeading
        title='绑定邮箱'
        subtitle='给账号加一条后路：以后可以用邮箱 + 密码登录，也能自助重置密码。'
        eyebrow='KEDAYA · 账号安全'
      />

      <KdyCard title='填写信息' elevated={false}>
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
            label='设置密码'
            value={password}
            onChange={setPassword}
            placeholder='至少 8 位，含字母和数字'
            password
            maxLength={64}
            error={issues.length > 0 ? issues.join('、') : null}
            hint='请使用与其他网站不同的密码'
          />
        </View>

        {notice !== null && <Text className='kdy-auth__tip'>{notice}</Text>}
        {error !== null && <Text className='kdy-auth__error'>{error}</Text>}
        {devCode !== null && devCode !== '' && (
          <Text className='kdy-auth__dev' onClick={() => setCode(devCode)}>
            开发模式：后端未配置邮件服务，验证码直接返回 —— {devCode}（点此填入）
          </Text>
        )}

        <View className='kdy-auth__actions'>
          <KdyButton block loading={submitting} onClick={() => void handleSubmit()}>
            绑定并保存
          </KdyButton>
        </View>
      </KdyCard>

      <Text className='kdy-disclaimer'>
        可达鸭是第三方非官方校园服务平台，与上海科技大学官方系统无关。
      </Text>
    </View>
  )
}
