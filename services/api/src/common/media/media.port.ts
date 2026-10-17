/**
 * 媒体存储端口（契约 §7：`application`/业务模块只依赖端口，实现可替换）。
 *
 * 为什么必须"可替换"：微信云托管**容器没有持久化存储** —— 写进容器文件系统的
 * 图片会在下一次发布时凭空消失。因此：
 *   · `local`（本地磁盘）：**仅供开发/自测**，让整条链路在没有云存储时也能跑通；
 *   · `s3`：S3 兼容对象存储，**同一份实现在腾讯云 COS、阿里云 OSS、MinIO、
 *     Cloudflare R2、AWS S3 上都能用** —— 这正是"先实现接口，到时候配置即可"的落点；
 *   · `disabled`（默认）：明确地"没有配置存储"，接口返回可读的错误、
 *     客户端据此**隐藏选图入口**（不给一个点了必然失败的死路）。
 *
 * 安全约定：
 *   1. 对象 key **完全由服务端生成**（`media/<yyyy>/<mm>/<uuid>.<ext>`），
 *      绝不含用户输入 —— 否则就是路径穿越 + 可枚举他人文件；
 *   2. `put` 之前**必须**经过 `image-metadata.sanitizeImage`（EXIF GPS 剥离），
 *      端口签名上不做强制（用类型表达不了），由 `MediaService` 唯一入口保证；
 *   3. `publicUrl` 只负责拼地址，不做鉴权 —— 因此**私有桶需要配 CDN 签名**，
 *      这一点在 `docs/deploy.md` 里写明。
 */

/** 存储实现类型（也是 `MEDIA_STORAGE` 环境变量的取值） */
export type MediaStorageKind = 'disabled' | 'local' | 's3';

export interface MediaPutInput {
  /** 服务端生成的相对 key，例如 `media/2026/10/8f3c....jpg` */
  key: string;
  body: Buffer;
  contentType: string;
}

export interface MediaStoragePort {
  readonly kind: MediaStorageKind;
  /** 是否真的可用。`false` 时客户端不应显示选图入口 */
  readonly enabled: boolean;
  put(input: MediaPutInput): Promise<void>;
  /** 删除对象（幂等：对象不存在也算成功，便于"删帖顺带删图"） */
  remove(key: string): Promise<void>;
  /**
   * 拼接可访问地址。
   * · `s3` 返回**绝对 URL**（对象存储域名或 CDN 域名）；
   * · `local` 返回**根相对路径**（`/api/v1/media/files/<key>`），
   *   由服务层按当前请求补全 origin —— 这样本地开发不用配域名。
   */
  publicUrl(key: string): string;
}

export const MEDIA_STORAGE = Symbol('KEDAYA_MEDIA_STORAGE');
export const MEDIA_OPTIONS = Symbol('KEDAYA_MEDIA_OPTIONS');
export const MEDIA_URL_POLICY = Symbol('KEDAYA_MEDIA_URL_POLICY');

/** 上传限制（由 `MEDIA_*` 环境变量解析而来，见 `media.module.ts`） */
export interface MediaOptions {
  /** 单张上限（字节） */
  maxBytes: number;
  /** 单次/单条内容最多几张 */
  maxCount: number;
  /** 单边最大像素数（挡掉"20000×20000 的纯色图"这类内存炸弹） */
  maxDimension: number;
  /** 允许的 MIME 白名单 */
  accept: readonly string[];
}

/** 上传成功后的返回体（客户端直接拿去填 `imageUrls`） */
export interface UploadedImage {
  /** 服务端生成的对象 key —— 删除时用它，**不要**让客户端从 URL 反推 */
  key: string;
  /** 可直接给 `<Image src>` 用的绝对地址 */
  url: string;
  bytes: number;
  width: number | null;
  height: number | null;
  contentType: string;
  /** 元数据（含 EXIF GPS）已剥离。恒为 true —— 值的存在是为了让客户端/审核能看见这件事 */
  metadataStripped: true;
}

/** 下发给客户端的存储能力（客户端据此决定是否显示选图入口、以及限制提示） */
export interface MediaCapabilities {
  enabled: boolean;
  kind: MediaStorageKind;
  /** 单张上限（字节，剥离后的原图大小） */
  maxBytes: number;
  /** 单次选择上限（张） */
  maxCount: number;
  /** 允许的 MIME 白名单（客户端据此筛掉 HEIC/WebP，避免白传一趟） */
  accept: readonly string[];
}
