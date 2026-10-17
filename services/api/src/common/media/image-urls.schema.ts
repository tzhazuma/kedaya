import { z } from 'zod';

import { MAX_IMAGES_PER_ITEM } from './media-url';

/**
 * 请求体里 `imageUrls` 的形状（三个带图模块共用）。
 *
 * 这里只做**形状与数量**校验：
 *   · 数量上限写死在 `MAX_IMAGES_PER_ITEM`，与客户端提示、服务层二次校验同源；
 *   · 单个地址限长 512（正常地址 ~120 字符），避免超长字符串进库、进日志。
 *
 * 「地址是否真的来自本平台」由服务层的 `MediaUrlPolicy` 判定 ——
 * 那是**业务规则**，不适合塞进 HTTP 层的 schema（Zod 里写不了要读配置的规则）。
 */
export const imageUrlsSchema = z
  .array(z.string().trim().min(1).max(512))
  .max(MAX_IMAGES_PER_ITEM);

/** 创建 / 更新接口里的可选形态（不传 = 不涉及图片，与空数组语义不同） */
export const optionalImageUrlsSchema = imageUrlsSchema.optional();
