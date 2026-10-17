import Taro from '@tarojs/taro'
import type { WildlifePhoto } from '@kedaya/contracts/wildlife'
import { getContainer } from '../app/container'
import { createWildlifeArchive } from '../application/wildlife/archive'
import { parseEnvelope } from '../data/api/request'

export const getWildlife = () => createWildlifeArchive(getContainer().apiClient)
export function wildlifePhotoUrl(url: string) { return url.startsWith('/') ? `${getContainer().env.apiBaseUrl.replace(/\/$/, '')}${url}` : url }
export async function uploadWildlifePhoto(path: string): Promise<WildlifePhoto> {
  const container = getContainer()
  const auth = await container.apiClient.get('/auth/me')
  if (!auth.ok) throw new Error(auth.error.message)
  const token = container.tokenStore.getAccessToken()
  const response = await Taro.uploadFile({ url: `${container.env.apiBaseUrl.replace(/\/$/, '')}/api/v1/wildlife/photos`,
    filePath: path, name: 'file', header: { Authorization: `Bearer ${token}` }, timeout: 30_000 })
  let raw: unknown
  try { raw = JSON.parse(response.data) } catch { throw new Error('上传服务返回格式错误') }
  const result = parseEnvelope<WildlifePhoto>(raw, 'wildlife-upload')
  if (!result.ok) throw new Error(result.error.message)
  if (response.statusCode < 200 || response.statusCode >= 300) throw new Error('照片上传失败')
  return result.data
}
export async function chooseWildlifePhotos(count: number) {
  const media = await Taro.chooseMedia({ count, mediaType: ['image'], sourceType: ['album', 'camera'], sizeType: ['compressed'] })
  const photos: WildlifePhoto[] = []
  for (const file of media.tempFiles) {
    if (file.size > 8 * 1024 * 1024) throw new Error('每张照片不得超过 8MB')
    photos.push(await uploadWildlifePhoto(file.tempFilePath))
  }
  return photos
}
export const wildlifeNavigate = (page: string, query: Record<string, string> = {}) => Taro.navigateTo({
  url: `/presentation/pages/wildlife/${page}/index?${Object.entries(query).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')}`,
})
export async function wildlifeLocation() {
  const result = await Taro.getLocation({ type: 'gcj02' })
  return { latitude: result.latitude, longitude: result.longitude }
}
