import { ValidationError } from '../errors/app-error';

/**
 * 图片地址校验（业务模块的写入路径共用）。
 *
 * 为什么不能"客户端传什么 URL 就存什么"：
 *   1. **防盗链/反追踪**：允许任意外链，别人就能把 1×1 的追踪像素塞进帖子，
 *      或者把我们的帖子变成"给外部站点导流 + 泄露访问者 IP"的载体；
 *   2. **防脏数据**：外链会失效（对方删图 / 改目录），列表里就是一片碎图；
 *   3. **防注入**：URL 进页面、进日志、进分享卡片，形状必须可控。
 *
 * 因此只接受**本服务自己产出的地址**：
 *   · S3/CDN 模式：以 `MEDIA_PUBLIC_BASE_URL` 为前缀的绝对地址；
 *   · 本地模式：`<origin>/api/v1/media/files/media-<8位日期>-<uuid>.<jpg|png>`；
 *   · 证据是"对象 key 的形状"——它由 `MediaService` 生成，客户端伪造不了时间戳与 uuid
 *     之外的任何东西，而伪造出来的 key 在存储里并不存在（显示时就是坏图，
 *     不会引入任何外部依赖）。
 */

/** 与 `MediaService` 生成规则一一对应 */
const MEDIA_KEY_PATTERN = /^media-\d{8}-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png)$/;

/**
 * 单条内容最多几张图。
 *
 * 与 `MEDIA_MAX_COUNT` 默认值保持一致 —— 但这里刻意**写死在代码里**：
 * 它是接口契约的一部分（客户端与 Zod schema 都用它），不能因为某个环境
 * 把 `MEDIA_MAX_COUNT` 调大就让接口悄悄接受 100 张。
 */
export const MAX_IMAGES_PER_ITEM = 9;

/** 本服务对外暴露媒体文件的路径（本地/磁盘模式） */
const LOCAL_MEDIA_PATH_PATTERN = /^\/api\/v1\/media\/files\/([^/?#]+)$/;

export interface MediaUrlPolicy {
  /** 地址是否被允许 */
  isAllowed(url: string): boolean;
  /** 允许则原样返回，否则抛 `VALIDATION_FAILED` */
  assertAllowed(url: string): string;
}

export interface MediaUrlPolicyOptions {
  /** 对外访问基址（配置了 CDN / 自定义域名时用于放过这些地址） */
  publicBaseUrl?: string;
}

export function createMediaUrlPolicy(options: MediaUrlPolicyOptions = {}): MediaUrlPolicy {  const allowedPrefixes = [options.publicBaseUrl]
    .filter((value): value is string => typeof value === 'string' && value !== '')
    .map((value) => value.replace(/\/+$/, '') + '/');

  const isAllowed = (url: string): boolean => {
    if (typeof url !== 'string' || url.length === 0 || url.length > 512) return false;

    if (allowedPrefixes.some((prefix) => url.startsWith(prefix))) {
      // 前缀匹配通过后，还要确认 key 形状（否则 `.../anything` 也能过）
      const tail = url.slice(url.lastIndexOf('/') + 1);
      return MEDIA_KEY_PATTERN.test(tail);
    }

    // 本地/相对形态：只认我们自己的文件路由 + 合法 key
    let pathname: string;
    try {
      pathname = new URL(url, 'http://localhost').pathname;
    } catch {
      return false;
    }
    const match = LOCAL_MEDIA_PATH_PATTERN.exec(pathname);
    if (match === null) return false;
    const key = match[1];
    return key !== undefined && MEDIA_KEY_PATTERN.test(key);
  };

  return {
    isAllowed,
    assertAllowed(url: string): string {
      if (!isAllowed(url)) {
        throw new ValidationError('图片地址无效：只能使用本平台上传的图片（请重新上传）');
      }
      return url;
    },
  };
}

/** 单测里没有 DI 容器：没注入策略时退回默认策略（仍然校验，不放松） */
export function resolveMediaUrlPolicy(policy?: MediaUrlPolicy): MediaUrlPolicy {
  return policy ?? createMediaUrlPolicy();
}

/**
 * 校验并归一化一组图片地址（业务模块写入路径共用）。
 *
 * 规则：
 *   · 最多 `MAX_IMAGES_PER_ITEM` 张（超了报错而不是静默截断 —— 静默截断会让用户
 *     以为"传上去了"）；
 *   · 空串 / 重复地址丢弃（同一张图点两次不该占两个位置）；
 *   · 每个地址都要过 `MediaUrlPolicy`（只允许本平台上传的图，防外链与追踪像素）。
 */
export function normalizeImageUrls(urls: unknown, policy: MediaUrlPolicy): string[] {
  if (urls === undefined || urls === null) return [];
  if (!Array.isArray(urls)) throw new ValidationError('图片列表格式不正确');
  if (urls.length > MAX_IMAGES_PER_ITEM) {
    throw new ValidationError(`最多只能上传 ${MAX_IMAGES_PER_ITEM} 张图片`);
  }

  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of urls) {
    if (typeof raw !== 'string') throw new ValidationError('图片地址必须是字符串');
    const url = raw.trim();
    if (url === '' || seen.has(url)) continue;
    seen.add(url);
    result.push(policy.assertAllowed(url));
  }
  return result;
}
