import { Global, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { API_BASE_PATH } from '@kedaya/contracts';
import { DisabledMediaStorage } from './disabled-media.storage';
import { LocalDiskMediaStorage } from './local-disk-media.storage';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';
import { createMediaUrlPolicy } from './media-url';
import {
  MEDIA_OPTIONS,
  MEDIA_STORAGE,
  MEDIA_URL_POLICY,
  type MediaOptions,
  type MediaStoragePort,
} from './media.port';
import { S3MediaStorage } from './s3-media.storage';

/**
 * 媒体基础设施模块（`@Global`：与 PrismaModule / ComplianceModule 同级的基础设施）。
 *
 * 三种存储由 `MEDIA_STORAGE` 环境变量选择：
 *   · `disabled`（**默认**）—— 没有配置就是没有配置，客户端会隐藏选图入口；
 *   · `local`              —— 本地磁盘，**仅供开发/自测**（云托管重启即丢）；
 *   · `s3`                 —— S3 兼容对象存储（腾讯云 COS / 阿里云 OSS / MinIO / R2）。
 *
 * `s3` 缺少必需变量时**启动即失败**：少配一个 key 却静默降级到"上传全 500"，
 * 是最难排查的一类线上事故（与 `DATABASE_URL` 的处理保持一致的原则）。
 */

const DEFAULT_MAX_BYTES = 2 * 1024 * 1024; // 2 MB
const DEFAULT_MAX_COUNT = 9;
const DEFAULT_MAX_DIMENSION = 8_000;

/** 需要出现但允许为空的 s3 变量（缺一个就报清楚哪个） */
function requireEnv(config: ConfigService, name: string): string {
  const value = config.get<string>(name);
  if (value === undefined || value.trim() === '') {
    throw new Error(
      `MEDIA_STORAGE=s3 但缺少环境变量 ${name}。` +
        '请补齐 MEDIA_S3_ENDPOINT / MEDIA_S3_REGION / MEDIA_S3_BUCKET / ' +
        'MEDIA_S3_ACCESS_KEY_ID / MEDIA_S3_SECRET_ACCESS_KEY，或先用 MEDIA_STORAGE=disabled。',
    );
  }
  return value.trim();
}

function buildStorage(config: ConfigService, logger: Logger): MediaStoragePort {
  const kind = (config.get<string>('MEDIA_STORAGE') ?? 'disabled').trim().toLowerCase();

  if (kind === 'local') {
    if (config.get<string>('NODE_ENV') === 'production') {
      // 不打 pass：有些自建部署确实挂了持久卷。但必须让人一眼看见风险。
      logger.warn(
        'MEDIA_STORAGE=local：图片写在容器文件系统里，微信云托管**重启/发布后会全部丢失**。' +
          '生产请改用 MEDIA_STORAGE=s3（COS / OSS / MinIO 均可），见 docs/deploy.md。',
      );
    }
    const directory = config.get<string>('MEDIA_LOCAL_DIR') ?? `${process.cwd()}/.media`;
    logger.log(`媒体存储：本地磁盘（${directory}）—— 仅适用于开发与自测`);
    return new LocalDiskMediaStorage({
      directory,
      urlBase: `${API_BASE_PATH}/media/files`,
    });
  }

  if (kind === 's3') {
    const publicBaseUrl = config.get<string>('MEDIA_PUBLIC_BASE_URL');
    const storage = new S3MediaStorage({
      endpoint: requireEnv(config, 'MEDIA_S3_ENDPOINT'),
      region: requireEnv(config, 'MEDIA_S3_REGION'),
      bucket: requireEnv(config, 'MEDIA_S3_BUCKET'),
      credentials: {
        accessKeyId: requireEnv(config, 'MEDIA_S3_ACCESS_KEY_ID'),
        secretAccessKey: requireEnv(config, 'MEDIA_S3_SECRET_ACCESS_KEY'),
        ...(config.get<string>('MEDIA_S3_SESSION_TOKEN') === undefined
          ? {}
          : { sessionToken: config.get<string>('MEDIA_S3_SESSION_TOKEN') as string }),
      },
      forcePathStyle: config.get<string>('MEDIA_S3_FORCE_PATH_STYLE') === 'true',
      ...(publicBaseUrl === undefined || publicBaseUrl === '' ? {} : { publicBaseUrl }),
    });
    logger.log('媒体存储：S3 兼容对象存储');
    return storage;
  }

  if (kind !== 'disabled') {
    throw new Error(
      `MEDIA_STORAGE 取值非法：${kind}（可选：disabled / local / s3）。`,
    );
  }
  logger.warn('媒体存储未配置（MEDIA_STORAGE=disabled）：图片上传功能关闭，客户端会隐藏选图入口');
  return new DisabledMediaStorage();
}

@Global()
@Module({
  controllers: [MediaController],
  providers: [
    MediaService,
    {
      provide: MEDIA_STORAGE,
      inject: [ConfigService],
      useFactory: (config: ConfigService): MediaStoragePort =>
        buildStorage(config, new Logger('MediaModule')),
    },
    {
      provide: MEDIA_OPTIONS,
      inject: [ConfigService],
      useFactory: (config: ConfigService): MediaOptions => ({
        maxBytes: Number(config.get<string>('MEDIA_MAX_BYTES') ?? DEFAULT_MAX_BYTES),
        maxCount: Number(config.get<string>('MEDIA_MAX_COUNT') ?? DEFAULT_MAX_COUNT),
        maxDimension: Number(config.get<string>('MEDIA_MAX_DIMENSION') ?? DEFAULT_MAX_DIMENSION),
        accept: ['image/jpeg', 'image/png'],
      }),
    },
    {
      provide: MEDIA_URL_POLICY,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const publicBaseUrl = config.get<string>('MEDIA_PUBLIC_BASE_URL');
        return createMediaUrlPolicy(
          publicBaseUrl === undefined || publicBaseUrl === '' ? {} : { publicBaseUrl },
        );
      },
    },
  ],
  exports: [MediaService, MEDIA_STORAGE, MEDIA_OPTIONS, MEDIA_URL_POLICY],
})
export class MediaModule {}
