/**
 * 展示名（昵称）与头像的**唯一规则来源**。
 *
 * 为什么单独抽一个文件：
 *   邮箱注册、微信一键登录、资料修改三条路径都要"取一个可用的昵称"，
 *   如果各写一套，就会出现「注册时能过、改资料时被拒」这类不一致。
 *   这里只做纯函数，不含 IO，两端（后端 / 小程序）可以照着同一套规则校验。
 */

/** 昵称上限（按**码点**计，不是 UTF-16 长度，避免把 emoji 截半） */
export const DISPLAY_NAME_MAX = 24;

/** 头像 data URL 上限（64 KB）。超过请客户端先压缩 —— 见 `AvatarInput` 注释 */
export const AVATAR_DATA_URL_MAX_BYTES = 64 * 1024;

/** 允许的头像 MIME（微信 `chooseMedia` 只会产出这几种） */
export const AVATAR_ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'] as const;

/**
 * 规范昵称：去掉控制字符与零宽字符、裁剪首尾空白、按码点截断。
 * 返回 `null` 表示"没有可用昵称"，由调用方决定兜底名。
 */
export function sanitizeDisplayName(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = value
    // C0/C1 控制字符、零宽空格/连接符、BOM —— 它们在 UI 上不可见但会污染展示名。
    // eslint-disable-next-line no-control-regex -- 本条规则的例外就在这里：目的正是剔除控制字符
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029\ufeff]/g, '')
    .trim();
  if (cleaned.length === 0) return null;
  return [...cleaned].slice(0, DISPLAY_NAME_MAX).join('');
}

/** 邮箱前缀派生昵称（纯 ASCII 场景，与迁移前的行为保持一致） */
export function deriveNameFromEmail(email: string): string {
  const prefix = email.split('@')[0] ?? '';
  const cleaned = prefix.replace(/[^0-9A-Za-z._-]/g, '');
  return cleaned.length >= 2 ? cleaned.slice(0, DISPLAY_NAME_MAX) : '新同学';
}

/**
 * 微信身份派生昵称。
 *
 * 微信**不再**允许静默获取昵称（`getUserInfo` 已回收，只留下用户主动填写的
 * `<input type="nickname">`），因此首次微信登录时我们先用一个稳定的兜底名，
 * 用户可以在「完善资料」里一键用微信昵称覆盖它。
 */
export function deriveNameFromWechat(openid: string): string {
  const tail = openid.replace(/[^0-9A-Za-z]/g, '').slice(-4);
  return tail.length === 0 ? '微信同学' : `微信用户${tail}`;
}

export interface AvatarValidation {
  ok: boolean;
  /** 规范化后的 data URL（ok 时必定存在） */
  dataUrl?: string;
  reason?: string;
}

/**
 * 校验客户端上传的头像 data URL。
 *
 * 当前里程碑**没有接对象存储**（契约 §7 的 retention 表把图片归到对象存储，
 * 但本地/演示环境没有 OSS）。因此这里把头像压缩后以 data URL 存在
 * `User.avatarUrl` 里 —— 换来的是"头像真的能用"。
 *
 * 代价与约束（必须诚实标注）：
 *   · 只接受 base64 data URL，且限制 64 KB，防止把库当图床；
 *   · 接入 OSS 后，这里应改为"上传接口返回 URL"，`avatarUrl` 语义不变。
 */
export function validateAvatarDataUrl(value: unknown): AvatarValidation {
  if (typeof value !== 'string' || value.length === 0) {
    return { ok: false, reason: '头像数据为空' };
  }
  const matched = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(value);
  if (!matched) {
    return { ok: false, reason: '头像必须是 jpeg / png / webp 的 base64 data URL' };
  }
  const mime = matched[1] as (typeof AVATAR_ALLOWED_MIME)[number];
  const payload = matched[2] ?? '';
  // base64 体积 → 3/4；再叠加 data URL 头部，统一按解码后大小判断
  const approxBytes = Math.floor((payload.length * 3) / 4);
  if (approxBytes > AVATAR_DATA_URL_MAX_BYTES) {
    return {
      ok: false,
      reason: `头像不能超过 ${Math.floor(AVATAR_DATA_URL_MAX_BYTES / 1024)} KB，请先压缩`,
    };
  }
  return { ok: true, dataUrl: `data:${mime};base64,${payload}` };
}

/** 头像 URL 是否可接受（https 外链，或上面的 data URL） */
export function isAcceptableAvatarUrl(value: string): boolean {
  if (value.startsWith('data:image/')) return validateAvatarDataUrl(value).ok;
  return /^https:\/\/[^\s]+$/.test(value) && value.length <= 2048;
}
