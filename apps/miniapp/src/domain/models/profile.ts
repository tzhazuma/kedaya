/**
 * 展示资料（昵称 / 头像）规则 —— 纯 TypeScript，零框架依赖。
 *
 * 与后端 `services/api/src/modules/auth/domain/display-name.ts` **必须一致**：
 * 客户端校验只是为了即时提示与压缩前的拦截，服务端才是最终裁决。
 */

/** 昵称上限（按**码点**计，避免把 emoji 截半） */
export const NICKNAME_MAX = 24

/** 头像 data URL 上限，与后端 `AVATAR_DATA_URL_MAX_BYTES` 一致（64 KB） */
export const AVATAR_MAX_BYTES = 64 * 1024

/**
 * 规范化昵称：去掉控制字符与零宽字符、裁剪首尾空白、按码点截断到 24。
 *
 * 与后端同一套规则 —— 否则会出现「小程序说能存、后端拒收」的割裂。
 */
export function sanitizeNickname(value: string): string {
  // eslint-disable-next-line no-control-regex -- 本条规则的例外就在这里：目的正是剔除控制字符
  const cleaned = value.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029\ufeff]/g, '').trim()
  return [...cleaned].slice(0, NICKNAME_MAX).join('')
}

/** 昵称是否可用（去空白后至少 1 个字符） */
export function isValidNickname(value: string): boolean {
  return sanitizeNickname(value).length > 0
}

/** data URL 的载荷字节数（base64 → 3/4） */
export function dataUrlBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(',')
  if (comma < 0) return 0
  const payload = dataUrl.slice(comma + 1)
  const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0
  return Math.max(0, Math.floor((payload.length * 3) / 4) - padding)
}

/** 头像 data URL 是否合法（MIME + base64 + 体积），与后端 `validateAvatarDataUrl` 对齐 */
export function isValidAvatarDataUrl(value: string): boolean {
  if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(value)) return false
  return dataUrlBytes(value) <= AVATAR_MAX_BYTES
}
