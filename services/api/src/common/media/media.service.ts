import { randomUUID } from 'node:crypto';

import { Inject, Injectable, Logger } from '@nestjs/common';
import { UpstreamUnavailableError, ValidationError } from '../errors/app-error';
import { ImageRejectedError, sanitizeImage, SUPPORTED_IMAGE_TYPES } from './image-metadata';
import { MediaStorageError } from './media.errors';
import {
  MEDIA_OPTIONS,
  MEDIA_STORAGE,
  type MediaCapabilities,
  type MediaOptions,
  type MediaStoragePort,
  type UploadedImage,
} from './media.port';

/**
 * 媒体用例层 —— 上传的唯一入口。
 *
 * 顺序很重要，且**不可调换**：
 *   1. 存储是否可用（不可用就别解析图片，直接给可读错误）；
 *   2. base64 解码 + **先按原始大小拦一次**（避免把 20 MB 的 base64 拽进内存再校验）；
 *   3. 魔术字节嗅探（不信任声明的 MIME）→ 判类型；
 *   4. **剥离元数据**（EXIF GPS）→ 同时拿到真实宽高做一次合理性校验；
 *   5. 生成 key（服务端生成，不含用户输入）→ 落存储；
 *   6. 拼绝对地址返回。
 *
 * 第 4 步是契约 A2.5 的落点：`sanitizeImage` 抛错一律转成 `VALIDATION_FAILED`，
 * 绝不"剥离失败就原样存"。
 */
@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);

  constructor(
    @Inject(MEDIA_STORAGE) private readonly storage: MediaStoragePort,
    @Inject(MEDIA_OPTIONS) private readonly options: MediaOptions,
  ) {}

  capabilities(): MediaCapabilities {
    return {
      enabled: this.storage.enabled,
      kind: this.storage.kind,
      maxBytes: this.options.maxBytes,
      maxCount: this.options.maxCount,
      accept: this.options.accept,
    };
  }

  /**
   * 上传一张图片。
   *
   * @param dataUrl `data:image/jpeg;base64,...`（客户端压缩后就是这么发的）
   * @param origin  当前请求的 origin（本地磁盘模式下用来把相对路径补成绝对地址）
   */
  async uploadImage(dataUrl: string, origin: string): Promise<UploadedImage> {
    if (!this.storage.enabled) {
      throw new UpstreamUnavailableError(
        '图片存储尚未配置，暂时不能上传图片。请联系管理员配置对象存储（docs/deploy.md「媒体存储」）。',
      );
    }

    const decoded = this.decodeDataUrl(dataUrl);
    if (decoded.bytes.length > this.options.maxBytes) {
      throw new ValidationError(
        `图片不能超过 ${Math.round(this.options.maxBytes / 1024)} KB（当前约 ${Math.round(
          decoded.bytes.length / 1024,
        )} KB），请换一张或重新压缩`,
      );
    }

    let sanitized: ReturnType<typeof sanitizeImage>;
    try {
      sanitized = sanitizeImage(decoded.bytes);
    } catch (error) {
      if (error instanceof ImageRejectedError) throw new ValidationError(error.message);
      throw error;
    }

    if (sanitized.width !== null && sanitized.width > this.options.maxDimension) {
      throw new ValidationError(`图片宽度不能超过 ${this.options.maxDimension} 像素，请先压缩`);
    }
    if (sanitized.height !== null && sanitized.height > this.options.maxDimension) {
      throw new ValidationError(`图片高度不能超过 ${this.options.maxDimension} 像素，请先压缩`);
    }

    const key = buildMediaKey(sanitized.type);
    try {
      await this.storage.put({ key, body: sanitized.bytes, contentType: sanitized.type });
    } catch (error) {
      // 存储故障是"上游不可用"（503），不是客户端的错，也不该是 500
      const message = error instanceof MediaStorageError ? error.message : String(error);
      this.logger.error(`媒体写入失败（key=${key}）：${message}`);
      throw new UpstreamUnavailableError('图片上传失败，请稍后重试');
    }

    const url = this.absoluteUrl(this.storage.publicUrl(key), origin);
    this.logger.log(
      `已接收图片 ${key}（${sanitized.width}×${sanitized.height}，` +
        `${decoded.bytes.length}→${sanitized.bytes.length} 字节，已剥离元数据）`,
    );

    return {
      key,
      url,
      bytes: sanitized.bytes.length,
      width: sanitized.width,
      height: sanitized.height,
      contentType: sanitized.type,
      /** 契约 A2.5：能进存储的图一定过了 `sanitizeImage`，这里如实标注 */
      metadataStripped: true,
    };
  }

  /**
   * 删除一张图（幂等）。
   *
   * key 必须是**我们自己生成的形状**才允许删 —— 否则 `DELETE ?key=media-...` 就成了
   * "遍历删除任意对象"的入口（对象存储的 key 空间里可能还有别的东西）。
   */
  async deleteImage(key: string): Promise<void> {
    if (!KEY_PATTERN.test(key)) {
      throw new ValidationError('图片标识无效');
    }
    if (!this.storage.enabled) return; // 没存储="已经不存在"
    try {
      await this.storage.remove(key);
    } catch (error) {
      const message = error instanceof MediaStorageError ? error.message : String(error);
      this.logger.error(`媒体删除失败（key=${key}）：${message}`);
      throw new UpstreamUnavailableError('图片删除失败，请稍后重试');
    }
  }

  /** data URL → 字节。只接受 base64 形态，且必须是图片 MIME */
  private decodeDataUrl(dataUrl: string): { mime: string; bytes: Buffer } {
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) {
      throw new ValidationError('图片格式不正确（需要 data URL）');
    }
    const separator = dataUrl.indexOf(';base64,');
    if (separator < 0) throw new ValidationError('图片格式不正确（需要 base64 编码）');

    const mime = dataUrl.slice(5, separator).toLowerCase();
    if (!(SUPPORTED_IMAGE_TYPES as readonly string[]).includes(mime)) {
      throw new ValidationError('只支持 JPG / PNG 图片');
    }

    const base64 = dataUrl.slice(separator + 8).replace(/\s/g, '');
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
      throw new ValidationError('图片内容不是合法的 base64');
    }

    const bytes = Buffer.from(base64, 'base64');
    if (bytes.length === 0) throw new ValidationError('图片内容为空');
    return { mime, bytes };
  }

  /** 相对路径补成绝对地址：微信小程序的 `<Image src>` 不接受相对路径 */
  private absoluteUrl(url: string, origin: string): string {
    if (/^https?:\/\//i.test(url)) return url;
    const base = origin.replace(/\/+$/, '');
    return `${base}${url.startsWith('/') ? '' : '/'}${url}`;
  }
}

/** 与 `media-url.ts` 的白名单、`LocalDiskMediaStorage` 的 SAFE_KEY 保持一致 */
const KEY_PATTERN = /^media-\d{8}-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png)$/;

/**
 * 生成对象 key：`media-<YYYYMMDD>-<uuid>.<ext>`。
 *
 * 刻意**不含 `/`**：本地磁盘模式的文件路由因此不需要通配符
 * （Express 5 的 path-to-regexp 对裸 `*` 的处理变过，少踩一个坑），
 * 同时"不可能路径穿越"这件事变成结构上就成立，而不是靠过滤。
 */
export function buildMediaKey(type: string, now: Date = new Date()): string {
  const stamp = now.toISOString().slice(0, 10).replace(/-/g, '');
  const ext = type === 'image/png' ? 'png' : 'jpg';
  return `media-${stamp}-${randomUUID()}.${ext}`;
}
