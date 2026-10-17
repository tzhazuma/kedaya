import { Text, View } from '@tarojs/components'
import { useState } from 'react'

import { getContainer } from '../../../../app/container'
import { NICKNAME_MAX } from '../../../../domain/models/profile'
import { toast } from '../../../../platform/navigation'
import { KdyAvatar, KdyButton, KdyCard } from '../../../components'
import { KdyField } from '../../../components/KdyField'
import { KdyHeading } from '../../../components/KdyHeading'
import { useStore } from '../../../hooks'
import { backAfterAuthSuccess } from '../../auth/backAfterAuthSuccess'
import '../../auth/auth.scss'
import './index.scss'

/**
 * 编辑资料（昵称 / 头像）。
 *
 * 入口只有一个：「我的 → 编辑资料」（保存后返回上一页）。
 * 以前还有第二个入口（`?from=wechat`，微信首次登录后的「完善资料」），
 * 但那一页在用户眼里就是一个**登录关卡**：点了一键登录却还要再填一次、再按一次保存。
 * 现在微信建号即登录，昵称与头像回到"随时可改"的位置，这一页也只剩一种语义。
 *
 * 微信侧的硬约束（决定了本页的交互）：
 *   · 昵称必须由用户在 `<input type="nickname">` 里确认，代码拿不到；
 *   · 头像必须由用户点击 `<button open-type="chooseAvatar">` 触发；
 *   · 回调给的是**临时文件路径**，所以要立刻压缩成 data URL
 *     才能持久化（见 `platform/avatarPicker.ts`）。
 */
export default function ProfileEditPage() {
  const container = getContainer()
  const auth = container.useCases.auth
  const avatarPicker = container.avatarPicker

  const state = useStore(container.useCases.session)

  const [nickname, setNickname] = useState(state.profile?.nickname ?? '')
  const [avatarDataUrl, setAvatarDataUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)
  const [saving, setSaving] = useState(false)

  if (state.profile === null) {
    return (
      <View className='kdy-page kdy-auth'>
        <KdyHeading title='编辑资料' subtitle='请先登录后再修改昵称与头像。' />
        <KdyCard title='未登录' elevated={false}>
          <Text className='kdy-auth__tip'>登录后即可设置昵称与头像。</Text>
        </KdyCard>
      </View>
    )
  }

  const previewAvatar = avatarDataUrl ?? state.profile.avatarUrl ?? null
  const canPickAvatar = avatarPicker.isAvailable()

  async function handleChooseAvatar(tempFilePath: string): Promise<void> {
    if (picking) return
    setError(null)
    setNotice(null)
    setPicking(true)
    const result = await avatarPicker.readAsDataUrl(tempFilePath)
    setPicking(false)

    if (!result.ok) {
      setError(result.error.message)
      return
    }
    setAvatarDataUrl(result.value.dataUrl)
    setNotice(`已选择头像（${Math.round(result.value.bytes / 1024)} KB），保存后生效`)
  }

  async function handleSave(): Promise<void> {
    if (saving) return
    setError(null)
    setNotice(null)
    setSaving(true)

    const result = await auth.updateProfile({
      displayName: nickname,
      ...(avatarDataUrl === null ? {} : { avatarUrl: avatarDataUrl }),
    })
    setSaving(false)

    if (!result.ok) {
      setError(result.error.message)
      return
    }
    toast('资料已更新', 'success')
    await backAfterAuthSuccess()
  }

  return (
    <View className='kdy-page kdy-auth'>
      <KdyHeading title='编辑资料' subtitle='昵称与头像会显示在你发布的内容旁边。' />

      <KdyCard title='头像' elevated={false}>
        <View className='kdy-profile-edit__avatar'>
          <KdyAvatar src={previewAvatar} size={96} />
          <View className='kdy-profile-edit__avatar-action'>
            {canPickAvatar ? (
              <KdyButton
                size='sm'
                variant='ghost'
                loading={picking}
                openType='chooseAvatar'
                onChooseAvatar={(detail) => void handleChooseAvatar(detail.avatarUrl)}
              >
                {previewAvatar === null ? '选择微信头像' : '更换头像'}
              </KdyButton>
            ) : (
              <Text className='kdy-auth__tip'>
                选择微信头像需要在微信小程序内使用（当前端暂不支持）。
              </Text>
            )}
            <Text className='kdy-auth__tip'>头像会压缩到 64 KB 以内再上传。</Text>
          </View>
        </View>
      </KdyCard>

      <KdyCard title='昵称' elevated={false}>
        <KdyField
          label='昵称'
          value={nickname}
          onChange={setNickname}
          placeholder='例如：可达鸭本鸭'
          type='nickname'
          maxLength={NICKNAME_MAX}
          hint='微信内可点输入框上方的「使用微信昵称」一键填入'
        />
      </KdyCard>

      {notice !== null && <Text className='kdy-auth__tip'>{notice}</Text>}
      {error !== null && <Text className='kdy-auth__error'>{error}</Text>}

      <View className='kdy-auth__actions'>
        <KdyButton block loading={saving} onClick={() => void handleSave()}>
          保存
        </KdyButton>
      </View>

      <Text className='kdy-disclaimer'>
        第三方非官方平台 · 与上海科技大学官方系统无关。
      </Text>
    </View>
  )
}
