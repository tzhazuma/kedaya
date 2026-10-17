import type { MediaCapabilities, MediaPutInput, MediaStorageKind, MediaStoragePort } from './media.port';
import { MediaStorageError } from './media.errors';

/**
 * 「没有配置对象存储」的显式实现 —— 默认形态。
 *
 * 为什么要有这么一个"什么也不做"的实现，而不是让 provider 为 undefined：
 *   · 让"未配置"成为一个**明确的状态**，可以如实告诉客户端
 *     （`GET /media/config` → `enabled: false`），客户端据此**隐藏选图入口**；
 *   · 如果让 provider 为空，业务代码里到处是 `if (!storage)`，最终必然有人漏判，
 *     于是用户点了上传得到 500 —— 那才是真正的"死路"。
 *
 * 错误文案刻意写给**部署者**看（而不是用户）：它出现在服务端日志与接口响应里，
 * 指向具体的环境变量名。
 */
export class DisabledMediaStorage implements MediaStoragePort {
  readonly kind: MediaStorageKind = 'disabled';
  readonly enabled = false;

  async put(_input: MediaPutInput): Promise<void> {
    throw new MediaStorageError(
      '未配置对象存储：请设置 MEDIA_STORAGE=local（仅开发）或 MEDIA_STORAGE=s3 及其 MEDIA_S3_* 变量，' +
        '详见 docs/deploy.md「媒体存储」。',
    );
  }

  async remove(_key: string): Promise<void> {
    // 删除是幂等语义：没有存储时"什么都没删"也就是"已经不存在"，不报错
  }

  publicUrl(key: string): string {
    return `/api/v1/media/files/${key}`;
  }
}

/** 便捷构造：能力声明（下发给客户端的那份） */
export function capabilitiesOf(
  storage: MediaStoragePort,
  limits: { maxBytes: number; maxCount: number; accept: readonly string[] },
): MediaCapabilities {
  return {
    enabled: storage.enabled,
    kind: storage.kind,
    maxBytes: limits.maxBytes,
    maxCount: limits.maxCount,
    accept: limits.accept,
  };
}
