/**
 * 群机器人接入 · 领域层（纯函数，零框架依赖）
 *
 * ## 更正：官方通道确实存在
 *
 * 我此前判断"读群消息不可行"，这个判断**在 QQ 侧是错的**。
 * [QQ 机器人官方 API v2](https://bot.q.qq.com/wiki/develop/api-v2/) 提供
 * `GROUP_MESSAGE_CREATE`「群消息（全量模式）」：
 *
 * > 当机器人开启了"接收所有消息"功能后，群里的**每一条消息（不限于@机器人）**
 * > 都会推送此事件。
 *
 * 事件体带 `id`（消息 ID）、`author`（含 `member_openid` / `member_role`）、
 * `content`（文本）、`group_openid`、`timestamp`、`attachments`（图片 URL）。
 * 生态里已有成熟适配器（MaiBot / AstrBot 都有官方机器人适配器），
 * 说明这条路是**官方支持、可长期运行**的。
 *
 * 「企业微信智能机器人」同样支持接收群消息（被动回调）。
 *
 * ## 仍然成立的两条边界（必须说清，因为影响实现）
 *
 * 1. **个人微信没有官方群消息 API**。企业微信是另一套体系（企微群 ≠ 微信群），
 *    QQ 机器人也只能在**QQ 群**里工作。所以"跳蚤微信群"这类场景，
 *    官方路径是**把群迁到 QQ 群或企业微信群**，而不是去读微信群。
 * 2. **个人微信的"读本地缓存"仍然违规**（SQLCipher 加密 + 协议逆向），
 *    官方支持的是机器人，不是客户端 hook。
 *
 * ## 本模块的定位
 *
 * 它**不自动发布**：群消息里的信息可能不准确、已过期、或不是发布者本人想转载。
 * 机器人只把消息落成「**待确认草稿**」，由管理员在校验后一键发布。
 * 这样既拿到效率，又保留"人对内容负责"这一环。
 */

import { createPublicKey, verify as cryptoVerify } from 'node:crypto';

/* ------------------------------------------------------------------ *
 * 平台
 * ------------------------------------------------------------------ */

export const GROUP_BOT_PLATFORMS = ['qq', 'wecom'] as const;
export type GroupBotPlatform = (typeof GROUP_BOT_PLATFORMS)[number];

/* ------------------------------------------------------------------ *
 * 事件形状（只取我们真正用的字段）—— 与官方文档对齐
 * ------------------------------------------------------------------ */

/**
 * 官方 `User` 对象里我们用到的字段。
 *
 * ⚠️ **wire 是 snake_case**：QQ 的 JSON 就是 `member_openid` / `member_role`。
 * 这里刻意保留官方字段名（不改成 camelCase）—— 一旦"顺手美化"字段名，
 * 解析就会静默拿到 undefined，而错误表现是"消息内容为空被跳过"，
 * 极难查。内部归一化后的 `NormalizedGroupMessage` 才用 camelCase。
 */
export interface QqBotAuthorWire {
  /** 用户在**本机器人**下的 OpenID（不是 QQ 号，不能跨应用关联） */
  readonly member_openid?: string;
  readonly username?: string;
  readonly bot?: boolean;
  /** member | admin | owner */
  readonly member_role?: string;
}

/** 官方 `GROUP_MESSAGE_CREATE` 事件体（节选，snake_case） */
export interface QqBotGroupMessageEventWire {
  readonly id?: string;
  readonly author?: QqBotAuthorWire;
  readonly content?: string;
  readonly group_openid?: string;
  readonly timestamp?: string;
  readonly message_type?: number;
  readonly attachments?: readonly { readonly url?: string; readonly content_type?: string }[];
}

/** 归一化后的一条群消息（本模块内部使用） */
export interface NormalizedGroupMessage {
  /** 平台原始消息 id —— 用于幂等去重（QQ 会重试） */
  readonly platformMessageId: string;
  readonly platform: GroupBotPlatform;
  readonly groupId: string;
  /** 发送者标识（OpenID）。**只用于去重与审计，不对外展示** */
  readonly senderRef: string;
  readonly text: string;
  readonly sentAt: Date;
  /** 附件 URL（图片等）。我们**不下载**，只保留链接供人工核对 */
  readonly attachmentUrls: readonly string[];
}

/* ------------------------------------------------------------------ *
 * 签名验证（QQ 用 Ed25519）
 * ------------------------------------------------------------------ */

/**
 * QQ 机器人回调的签名头。
 *
 * 官方要求：`X-Signature-Ed25519`（hex）+ `X-Signature-Timestamp`，
 * 待签名串是 `timestamp + body`，密钥是开放平台给的 Ed25519 公钥。
 *
 * ⚠️ **必须验签**。不验签的 webhook 等于一个任何人都能 POST 的写接口 ——
 * 伪造请求会往草稿箱里灌垃圾，甚至灌进诱导内容。
 */
export const QQ_SIGNATURE_HEADER = 'x-signature-ed25519';
export const QQ_TIMESTAMP_HEADER = 'x-signature-timestamp';

/**
 * 校验 QQ 回调签名。
 *
 * @param rawBody   原始请求体**字符串**（不能是解析后的对象 —— JSON 重新序列化会改变字节）
 * @param signature  `X-Signature-Ed25519` 的 hex 值
 * @param timestamp  `X-Signature-Timestamp` 的值
 * @param publicKeyHex 开放平台提供的 Ed25519 公钥（hex，带 SPKI 前缀或不带都能处理）
 */
export function verifyQqSignature(input: {
  rawBody: string;
  signature: string;
  timestamp: string;
  publicKeyHex: string;
}): { ok: true } | { ok: false; reason: string } {
  const { rawBody, signature, timestamp, publicKeyHex } = input;

  if (signature.length === 0) return { ok: false, reason: '缺少签名头' };
  if (timestamp.length === 0) return { ok: false, reason: '缺少时间戳头' };
  if (publicKeyHex.length === 0) return { ok: false, reason: '未配置公钥（fail closed）' };
  if (!/^[0-9a-fA-F]+$/.test(signature)) return { ok: false, reason: '签名不是 hex' };

  const message = Buffer.from(timestamp + rawBody, 'utf8');
  const signatureBytes = Buffer.from(signature, 'hex');

  let key;
  try {
    key = createPublicKey({
      key: Buffer.from(publicKeyHex, 'hex'),
      format: 'der',
      type: 'spki',
    });
  } catch {
    // 也接受裸 32 字节公钥：补上 Ed25519 SPKI 头再试
    try {
      const ed25519SpkiPrefix = Buffer.from('302a300506032b6570032100', 'hex');
      key = createPublicKey({
        key: Buffer.concat([ed25519SpkiPrefix, Buffer.from(publicKeyHex, 'hex')]),
        format: 'der',
        type: 'spki',
      });
    } catch {
      return { ok: false, reason: '公钥格式无法解析' };
    }
  }

  try {
    const valid = cryptoVerify(null, message, key, signatureBytes);
    return valid ? { ok: true } : { ok: false, reason: '签名不匹配' };
  } catch {
    return { ok: false, reason: '验签异常' };
  }
}

/**
 * 时间戳新鲜度检查。
 *
 * QQ 会在重试时重放同一个签名，所以**不能**靠签名防重放；
 * 真正防重放靠「消息 id 幂等」。这里只挡明显过期的请求（默认 5 分钟），
 * 避免有人拿旧的合法请求长期重放。
 */
export const TIMESTAMP_MAX_SKEW_MS = 5 * 60 * 1000;

export function isTimestampFresh(timestampSeconds: string, now: Date = new Date()): boolean {
  const seconds = Number(timestampSeconds);
  if (!Number.isFinite(seconds)) return false;
  // QQ 的 timestamp 是**秒**；有些实现给毫秒，这里按量级判断
  const millis = seconds > 1e12 ? seconds : seconds * 1000;
  return Math.abs(now.getTime() - millis) <= TIMESTAMP_MAX_SKEW_MS;
}

/* ------------------------------------------------------------------ *
 * 事件解析
 * ------------------------------------------------------------------ */

/**
 * 把官方事件体归一化。
 *
 * 返回 `null` 表示这条事件我们**不处理**（例如机器人自己发的消息、
 * 空文本、或非文本类型）—— 让调用方明确知道"跳过了"，而不是存一条空草稿。
 */
export function normalizeQqGroupMessage(
  payload: unknown,
): NormalizedGroupMessage | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const event = payload as QqBotGroupMessageEventWire;

  if (typeof event.id !== 'string' || event.id.length === 0) return null;
  if (typeof event.group_openid !== 'string' || event.group_openid.length === 0) return null;

  const author = event.author;
  // 机器人自己发的消息要跳过，否则会自激（我们发出去的消息又变成草稿）
  if (author !== undefined && author.bot === true) return null;

  const text = typeof event.content === 'string' ? event.content.trim() : '';
  // 只处理**文本**消息：图片/卡片我们不做 OCR（宁可让人自己补）
  if (text.length === 0) return null;
  if (event.message_type !== undefined && event.message_type !== 0) return null;

  const ts = typeof event.timestamp === 'string' ? Date.parse(event.timestamp) : Number.NaN;

  return {
    platformMessageId: event.id,
    platform: 'qq',
    groupId: event.group_openid,
    senderRef: author?.member_openid ?? 'unknown',
    text,
    sentAt: Number.isNaN(ts) ? new Date() : new Date(ts),
    // 附件只留链接：下载图片要存对象存储、要过内容审核，那是另一件事
    attachmentUrls: (event.attachments ?? [])
      .map((item) => item.url)
      .filter((url): url is string => typeof url === 'string' && url.length > 0),
  };
}

/* ------------------------------------------------------------------ *
 * 草稿状态机
 * ------------------------------------------------------------------ */

export const GROUP_DRAFT_STATUS = {
  pending: 'pending',
  approved: 'approved',
  rejected: 'rejected',
} as const;
export type GroupDraftStatus = (typeof GROUP_DRAFT_STATUS)[keyof typeof GROUP_DRAFT_STATUS];

export const GROUP_DRAFT_STATUS_LABELS: Readonly<Record<GroupDraftStatus, string>> = {
  pending: '待确认',
  approved: '已发布',
  rejected: '已忽略',
};

/** 只有 `pending` 能被处理；已处理过的不能再处理（幂等冲突） */
export function canDecide(status: string): boolean {
  return status === GROUP_DRAFT_STATUS.pending;
}

/**
 * 群消息 → 草稿标题的默认值。
 *
 * 群消息没有"标题"这个概念，所以取首行并截断；
 * 真正的标题留给人来改 —— 我们只提供一个不空的开头。
 */
export function defaultDraftTitle(text: string, maxLength = 60): string {
  const firstLine = text.split('\n')[0]?.trim() ?? '';
  const base = firstLine.length > 0 ? firstLine : text.trim();
  return base.length > maxLength ? `${base.slice(0, maxLength)}…` : base;
}
