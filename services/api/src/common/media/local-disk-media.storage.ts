import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import { MediaStorageError } from './media.errors';
import type { MediaPutInput, MediaStorageKind, MediaStoragePort } from './media.port';

/**
 * 本地磁盘存储 —— **仅供开发与自测**。
 *
 * 为什么明明要上线还要留着它：微信云托管容器**没有持久化存储**，
 * 在没有云存储账号的环境里（比如现在这个开发机）必须有一条能跑通全链路的路径，
 * 否则「选图 → 剥离 EXIF → 落库 → 列表里看到图」这段永远没法验证。
 *
 * 三条安全细节：
 *   1. key 由服务端生成且**不含 `/`**，但这里仍然做一次白名单校验 —— 防的是
 *      将来有人改了 key 生成逻辑却忘了这里，导致 `../../etc/passwd` 被读出；
 *   2. 写入用 `mkdir -p` + 临时写入，避免并发下读到半个文件；
 *   3. 生产环境用它会**打日志警告**（见 `media.module.ts`），因为重启即丢图。
 */

/** key 白名单：只允许字母数字与 `-` `_` `.`。**不含** `/` —— 因此不可能路径穿越 */
const SAFE_KEY = /^[A-Za-z0-9._-]{1,128}$/;

export interface LocalDiskMediaOptions {
  /** 落盘目录（默认 `<cwd>/.media`） */
  directory: string;
  /** 对外暴露的根相对路径前缀（默认 `/api/v1/media/files`） */
  urlBase: string;
}

export class LocalDiskMediaStorage implements MediaStoragePort {
  readonly kind: MediaStorageKind = 'local';
  readonly enabled = true;

  private readonly root: string;
  private readonly urlBase: string;

  constructor(options: LocalDiskMediaOptions) {
    this.root = resolve(options.directory);
    this.urlBase = options.urlBase.replace(/\/+$/, '');
  }

  private pathFor(key: string): string {
    if (!SAFE_KEY.test(key)) throw new MediaStorageError(`非法的存储 key：${key}`);
    return join(this.root, key);
  }

  async put(input: MediaPutInput): Promise<void> {
    const target = this.pathFor(input.key);
    try {
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, input.body);
    } catch (error) {
      throw new MediaStorageError(
        `写入本地媒体目录失败：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async remove(key: string): Promise<void> {
    try {
      await rm(this.pathFor(key), { force: true });
    } catch (error) {
      throw new MediaStorageError(
        `删除本地媒体文件失败：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  publicUrl(key: string): string {
    return `${this.urlBase}/${key}`;
  }

  /** 读取（只给本地模式的文件路由用；S3 模式由对象存储自己发文件） */
  async read(key: string): Promise<Buffer> {
    try {
      return await readFile(this.pathFor(key));
    } catch {
      throw new MediaStorageError('文件不存在');
    }
  }
}
