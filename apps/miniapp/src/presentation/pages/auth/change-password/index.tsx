import { Text, View } from '@tarojs/components'
import { useState } from 'react'

import { getContainer } from '../../../../app/container'
import { PAGE_PATHS } from '../../../../app/routes'
import { navigateTo, toast } from '../../../../platform/navigation'
import { passwordIssues } from '../../../../domain/models/auth'
import { KdyButton, KdyCard } from '../../../components'
import { KdyField } from '../../../components/KdyField'
import { KdyHeading } from '../../../components/KdyHeading'
import { useStore } from '../../../hooks'
import { backAfterAuthSuccess } from '../backAfterAuthSuccess'
import '../auth.scss'
import './index.scss'

/**
 * 修改密码（需登录）。支持邮箱注册的账号。
 *
 * 安全性：改密成功后服务端会作废该账号**所有**会话，并顺带换发一套新令牌，
 * 因此当前设备不会被自己踢下线，而其它设备需要重新登录。
 */
export default function ChangePasswordPage() {
  const container = getContainer()
  const auth = container.useCases.auth
  const session = container.useCases.session
  const state = useStore(session)

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const issues = newPassword.length === 0 ? [] : passwordIssues(newPassword)

  if (state.tokens === null) {
    return (
      <View className='kdy-page kdy-auth'>
        <KdyHeading title='修改密码' subtitle='请先登录后再修改密码。' />
        <KdyCard elevated={false}>
          <Text className='kdy-auth__tip'>当前未登录。</Text>
          <View className='kdy-auth__actions'>
            <KdyButton
              block
              onClick={() => {
                void navigateTo(PAGE_PATHS.authLogin)
              }}
            >
              去登录
            </KdyButton>
          </View>
        </KdyCard>
      </View>
    )
  }

  async function handleSubmit(): Promise<void> {
    if (submitting) return
    setError(null)

    if (newPassword !== confirmPassword) {
      setError('两次输入的新密码不一致')
      return
    }

    setSubmitting(true)
    const result = await auth.changePassword({ currentPassword, newPassword })
    setSubmitting(false)

    if (!result.ok) {
      setError(result.error.message)
      return
    }
    toast('密码已更新', 'success')
    await backAfterAuthSuccess()
  }

  return (
    <View className='kdy-page kdy-auth'>
      <KdyHeading
        title='修改密码'
        subtitle='修改后，其它设备需要重新登录。'
        eyebrow='KEDAYA · 账号安全'
      />

      <KdyCard title='验证当前密码' elevated={false}>
        <View className='kdy-auth__form'>
          <KdyField
            label='当前密码'
            value={currentPassword}
            onChange={setCurrentPassword}
            placeholder='请输入当前密码'
            password
            maxLength={64}
          />
          <KdyField
            label='新密码'
            value={newPassword}
            onChange={setNewPassword}
            placeholder='至少 8 位，含字母和数字'
            password
            maxLength={64}
            error={issues.length > 0 ? issues.join('、') : null}
          />
          <KdyField
            label='确认新密码'
            value={confirmPassword}
            onChange={setConfirmPassword}
            placeholder='再输入一次新密码'
            password
            maxLength={64}
            error={
              confirmPassword.length > 0 && confirmPassword !== newPassword
                ? '两次输入的密码不一致'
                : null
            }
          />
        </View>

        {error !== null && <Text className='kdy-auth__error'>{error}</Text>}

        <View className='kdy-auth__actions'>
          <KdyButton block loading={submitting} onClick={() => void handleSubmit()}>
            保存新密码
          </KdyButton>
        </View>

        <View className='kdy-auth__links'>
          <Text
            className='kdy-auth__link'
            onClick={() => {
              void navigateTo(PAGE_PATHS.authForgot)
            }}
          >
            忘记当前密码？
          </Text>
        </View>
      </KdyCard>
    </View>
  )
}
