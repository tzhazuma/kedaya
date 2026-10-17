import { SetMetadata, type CustomDecorator } from '@nestjs/common';

/**
 * 标记"这个处理器自己写响应体，不要套统一信封"。
 *
 * 目前唯一的用户是 `GET /api/v1/media/files/:key`（本地磁盘模式下直接把图片字节吐回去）。
 * 若交给 `EnvelopeInterceptor`，它会在处理器已经 `res.send()` 之后再 `res.json(...)`，
 * 结果是 `Cannot set headers after they are sent` —— 一个只在本地开发模式
 * 才会触发的诡异 500，非常难查。用一个显式装饰器把这种接口标出来，比
 * "在拦截器里猜路径"可靠得多。
 */
export const SKIP_ENVELOPE_KEY = 'kedaya:skip-envelope';

export function SkipEnvelope(): CustomDecorator<string> {
  return SetMetadata(SKIP_ENVELOPE_KEY, true);
}
