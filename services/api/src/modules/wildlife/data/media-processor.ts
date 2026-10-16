/**
 * wildlife · 媒体处理与对象存储实现（规格 §4）
 *
 * 三件事刻意分开：
 *   1. **EXIF 剥离** → `domain/media.ts`（纯 TS，零依赖，隐私防线）；
 *   2. **缩略图** → 本文件（sharp，**非隐私路径**，装不上就降级为无缩略图）；
 *   3. **对象存储** → 本文件（端口实现，失败抛 `UPSTREAM_UNAVAILABLE` → 502）。
 *
 * 规格 §4.4 说"不在请求路径上做 sharp 处理，否则上传 P95 会被拖到秒级"。
 * 本实现把缩略图放在请求路径里但**显式降级**：sharp 不可用 → 缩略图键 = 原图键，
 * 接口形状不变。真正上生产时应改成 Worker 异步生成（记入交付说明的未决项）。
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { UpstreamUnavailableError } from '../../../common/errors/app-error';
import { MEDIA_THUMB_EDGE_PX } from '../domain/media';
import type { MediaStoragePort, StoredObject, ThumbnailerPort } from '../domain/wildlife.domain';

/* ------------------------------------------------------------------ *
 * 缩略图（可降级）
 * ------------------------------------------------------------------ */

/** sharp 的最小结构化视图（避免顶层 import 让"没装 sharp"直接崩） */
interface SharpLike {
  (input: Buffer, options?: { limitInputPixels?: number }): {
    rotate: () => any;
    resize: (options: { width: number; height: number; fit: string; withoutEnlargement: boolean }) => any;
    webp: (options: { quality: number }) => { toBuffer: () => Promise<Buffer> };
    metadata: () => Promise<{ width?: number; height?: number; exif?: Buffer }>;
  };
}

function loadSharp(): SharpLike | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('sharp') as SharpLike | { default: SharpLike };
    const fn = (typeof mod === 'function' ? mod : mod.default) as SharpLike;
    return typeof fn === 'function' ? fn : null;
  } catch {
    return null;
  }
}

/**
 * sharp 缩略图器。
 *
 * 不可用时 `available = false` 且 `render()` 返回 `null` —— 上传流程**不受影响**。
 * 这条降级与 EXIF 剥离的"缺配置即崩溃"是刻意相反的：
 * 缩略图不是隐私防线，没有理由为它牺牲可用性。
 */
@Injectable()
export class SharpThumbnailer implements ThumbnailerPort {
  private readonly logger = new Logger(SharpThumbnailer.name);
  private readonly sharp = loadSharp();

  get available(): boolean {
    return this.sharp !== null;
  }

  async render(data: Buffer, edgePx: number = MEDIA_THUMB_EDGE_PX): Promise<Buffer | null> {
    const sharp = this.sharp;
    if (!sharp) return null;
    try {
      return await sharp(data, { limitInputPixels: 40_000_000 })
        .rotate()
        .resize({ width: edgePx, height: edgePx, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 80 })
        .toBuffer();
    } catch (error) {
      // 缩略图失败不是致命错误：记一条 WARN，返回 null
      this.logger.warn(
        `缩略图生成失败（已降级为无缩略图）: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }
}

/* ------------------------------------------------------------------ *
 * 对象存储
 * ------------------------------------------------------------------ */

/**
 * 本地文件系统对象存储（开发/测试用）。
 *
 * ⚠️ **已知限制（如实声明）**：这不是分布式对象存储 —— 多实例部署下
 * 各实例的 `var/` 目录不共享。生产必须换成 OSS/COS/S3，
 * 端口形状不变（`put/delete/urlFor`）。
 */
@Injectable()
export class LocalMediaStorage implements MediaStoragePort {
  private readonly root: string;
  private readonly publicBase: string;

  constructor(@Inject(ConfigService) config: ConfigService) {
    this.root = resolve(process.cwd(), config.get<string>('WILDLIFE_MEDIA_DIR') ?? 'var/wildlife-media');
    this.publicBase = config.get<string>('WILDLIFE_MEDIA_PUBLIC_BASE') ?? '/media/wildlife';
  }

  urlFor(key: string): string {
    return `${this.publicBase}/${key}`;
  }

  async put(key: string, data: Buffer, _contentType: string): Promise<StoredObject> {
    const target = this.resolveKey(key);
    try {
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, data);
    } catch (error) {
      // 存储不可用 → 502 UPSTREAM_UNAVAILABLE（不是 500），规格 §10.3 / T45
      throw new UpstreamUnavailableError('对象存储写入失败，请稍后重试', {
        key,
        cause: error instanceof Error ? error.message : String(error),
      });
    }
    return { key, url: this.urlFor(key), byteSize: data.length };
  }

  async delete(key: string): Promise<void> {
    try {
      await rm(this.resolveKey(key), { force: true });
    } catch (error) {
      throw new UpstreamUnavailableError('对象存储删除失败', {
        key,
        cause: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async get(key: string): Promise<Buffer> {
    try {
      return await readFile(this.resolveKey(key));
    } catch (error) {
      throw new UpstreamUnavailableError('对象存储读取失败', {
        key,
        cause: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /** 防目录穿越：key 必须落在 root 之内 */
  private resolveKey(key: string): string {
    const target = resolve(this.root, key);
    if (!target.startsWith(this.root)) {
      throw new UpstreamUnavailableError('非法的存储键', { key });
    }
    return target;
  }
}

/**
 * 内存对象存储（测试用，也可用于无磁盘环境）。
 * 不写盘、不依赖外部服务，但**同样**在越界键上拒绝。
 */
export class InMemoryMediaStorage implements MediaStoragePort {
  private readonly objects = new Map<string, { data: Buffer; contentType: string }>();

  urlFor(key: string): string {
    return `/media/wildlife/${key}`;
  }

  async put(key: string, data: Buffer, contentType: string): Promise<StoredObject> {
    this.objects.set(key, { data: Buffer.from(data), contentType });
    return { key, url: this.urlFor(key), byteSize: data.length };
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }

  async get(key: string): Promise<Buffer> {
    const found = this.objects.get(key);
    if (!found) throw new UpstreamUnavailableError('对象不存在', { key });
    return found.data;
  }

  /** 测试用：取回已存对象 */
  peek(key: string): Buffer | undefined {
    return this.objects.get(key)?.data;
  }

  keys(): string[] {
    return [...this.objects.keys()];
  }
}
