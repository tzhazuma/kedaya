import { MediaStorageError } from './media.errors';
import type { MediaPutInput, MediaStorageKind, MediaStoragePort } from './media.port';
import { signS3Request, type S3Credentials } from './s3-signature';

/**
 * S3 兼容对象存储存储实现。
 *
 * "S3 兼容"就是本文件的价值所在：**同一份代码**同时支持
 *   · 腾讯云 COS（`https://<bucket>.cos.<region>.myqcloud.com`）
 *   · 阿里云 OSS（`https://<bucket>.oss-<region>.aliyuncs.com`）
 *   · MinIO / Cloudflare R2 / AWS S3 / 七牛…
 * 因此"先实现接口，到时候配置即可"不需要改一行代码，只要填环境变量。
 *
 * 关于上传方式：这里走**服务端签名直传（PUT）**，而不是"客户端拿预签名 URL 直传"。
 * 取舍写清楚，免得后人以为是没想到：
 *   · 服务端中转的好处是 EXIF 剥离**一定发生**（A2.5）。预签名直传要剥离元数据，
 *     就得让客户端先处理 —— 而客户端是可以被抓包替换的，等于没剥离；
 *   · 代价是流量走服务端一遍。当前上限 2 MB/张、且客户端已压缩，
 *     这个代价可以接受；将来若要做大图，正确做法是"客户端传到临时区 →
 *     服务端处理后转存正式区"，而不是降低剥离要求。
 */

export interface S3MediaOptions {
  /** 例如 `https://cos.ap-shanghai.myqcloud.com`（不带 bucket） */
  endpoint: string;
  region: string;
  bucket: string;
  credentials: S3Credentials;
  /**
   * 路径风格（`endpoint/bucket/key`）。
   * 腾讯云 COS / 阿里云 OSS 用虚拟主机风格（默认 false）；
   * 自建 MinIO、部分 S3 网关需要路径风格。
   */
  forcePathStyle?: boolean;
  /**
   * 对外访问基址（CDN / 自定义域名）。给了就用它拼 URL；
   * 不给则按 endpoint + bucket 拼。生产建议配上，避免依赖对象存储的默认域名。
   */
  publicBaseUrl?: string;
  /** 请求超时（毫秒） */
  timeoutMs?: number;
}

export class S3MediaStorage implements MediaStoragePort {
  readonly kind: MediaStorageKind = 's3';
  readonly enabled = true;

  private readonly options: S3MediaOptions;
  private readonly timeoutMs: number;

  constructor(options: S3MediaOptions) {
    this.options = options;
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  /** 组装对象 URL（`key` 里不含 `/`，见 media.service.ts 的 key 生成规则） */
  private objectUrl(key: string): string {
    const { endpoint, bucket, forcePathStyle } = this.options;
    const url = new URL(endpoint);
    if (forcePathStyle === true) {
      url.pathname = `${url.pathname.replace(/\/+$/, '')}/${bucket}/${key}`;
      return url.toString();
    }
    url.host = `${bucket}.${url.host}`;
    url.pathname = `/${key}`;
    return url.toString();
  }

  private async send(
    method: 'PUT' | 'DELETE',
    key: string,
    body: Buffer,
    contentType?: string,
  ): Promise<Response> {
    const url = this.objectUrl(key);
    const headers: Record<string, string> = {};
    if (contentType !== undefined) headers['content-type'] = contentType;

    const signed = signS3Request({
      method,
      url,
      ...(contentType === undefined ? {} : { headers: { 'content-type': contentType } }),
      body,
      region: this.options.region,
      service: 's3',
      credentials: this.options.credentials,
      date: new Date(),
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await fetch(url, {
        method,
        headers: signed,
        ...(method === 'PUT' ? { body: new Uint8Array(body) } : {}),
        signal: controller.signal,
      });
    } catch (error) {
      throw new MediaStorageError(
        `对象存储请求失败：${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  async put(input: MediaPutInput): Promise<void> {
    const response = await this.send('PUT', input.key, input.body, input.contentType);
    if (!response.ok) {
      // 读一小段响应体：403 SignatureDoesNotMatch 之类必须让人看得见
      const detail = await response.text().catch(() => '');
      throw new MediaStorageError(
        `对象存储拒绝上传（HTTP ${response.status}）：${detail.slice(0, 300)}`,
      );
    }
  }

  async remove(key: string): Promise<void> {
    const response = await this.send('DELETE', key, Buffer.alloc(0));
    // 404 视为已删除（幂等）
    if (!response.ok && response.status !== 404) {
      const detail = await response.text().catch(() => '');
      throw new MediaStorageError(
        `对象存储拒绝删除（HTTP ${response.status}）：${detail.slice(0, 300)}`,
      );
    }
  }

  publicUrl(key: string): string {
    const base = this.options.publicBaseUrl;
    if (base !== undefined && base !== '') return `${base.replace(/\/+$/, '')}/${key}`;
    return this.objectUrl(key);
  }
}
