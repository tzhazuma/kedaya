/**
 * 媒体存储错误 —— 与业务错误分开，方便 `MediaService` 把"存储不可用"
 * 映射成 `UPSTREAM_UNAVAILABLE`，而不是笼统的 500。
 */
export class MediaStorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MediaStorageError';
  }
}
