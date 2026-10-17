import {
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { AuthGuard } from '../../common/auth/auth.guard';
import { CurrentUser } from '../../common/auth/current-user';
import { ZodBody, ZodQuery } from '../../common/pipes/zod-validation.pipe';
import { LocalDiskMediaStorage } from '../../common/media/local-disk-media.storage';
import { MEDIA_STORAGE, type MediaStoragePort } from '../../common/media/media.port';
import { MediaService } from '../../common/media/media.service';
import { SkipEnvelope } from '../../common/media/skip-envelope.decorator';

/**
 * 媒体 HTTP 层。
 *
 * 端点分工：
 *   · `GET  /media/config`        公开：告诉客户端"能不能传图、能传多大、几张"。
 *     有了它，未配置对象存储时客户端**隐藏选图入口**，而不是让用户点进去失败。
 *   · `POST /media/images`        需登录：上传一张（base64 data URL），返回可访问地址。
 *   · `DELETE /media/images?key=` 需登录：删除（幂等），供"删帖顺带删图"使用。
 *   · `GET  /media/files/:key`    公开：**仅本地磁盘模式**下回图片字节（开发/自测用）。
 *     S3 模式下文件由对象存储/CDN 直接提供，这个路由返回 404。
 *
 * 上传用 base64 JSON 而不是 `multipart/form-data`，取舍写在这里：
 *   · 客户端本来就把图压到几百 KB 再发（`Taro.compressImage`），
 *     base64 的 +33% 膨胀在这个量级下可以接受；
 *   · 免掉 multer 依赖与"多部分解析"这一层攻击面；
 *   · 与既有头像链路（data URL）同形，客户端只需一套处理逻辑。
 *   代价是请求体上限要提高（见 `main.ts` 的 body parser 配置）。
 */

const uploadSchema = z.object({
  /** `data:image/jpeg;base64,...`；上限由 body parser 与 MEDIA_MAX_BYTES 双重把关 */
  dataUrl: z.string().min(1).max(8_000_000),
});

const deleteQuerySchema = z.object({
  key: z.string().min(1).max(160),
});

@ApiTags('media · 媒体')
@Controller('media')
export class MediaController {
  constructor(
    @Inject(MediaService) private readonly service: MediaService,
    @Inject(MEDIA_STORAGE) private readonly storage: MediaStoragePort,
  ) {}

  @Get('config')
  @ApiOperation({
    summary: '媒体能力（公开）',
    description:
      '客户端据此决定是否显示选图入口：`enabled=false` 表示服务端尚未配置对象存储。' +
      '同时给出单张字节上限、单次张数与可接受的 MIME。',
  })
  config() {
    return this.service.capabilities();
  }

  @Post('images')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: '上传图片（登录用户）',
    description:
      '只接受 JPG / PNG 的 base64 data URL。服务端会**剥离 EXIF/GPS 等元数据**后落对象存储' +
      '（契约 A2.5），因此返回的图片可直接公开展示。',
  })
  upload(
    @CurrentUser() _userId: string,
    @ZodBody(uploadSchema) body: { dataUrl: string },
    @Req() request: Request,
  ) {
    return this.service.uploadImage(body.dataUrl, resolveOrigin(request));
  }

  @Delete('images')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '删除图片（登录用户，幂等）' })
  async remove(@ZodQuery(deleteQuerySchema) query: { key: string }): Promise<{
    key: string;
    deleted: true;
  }> {
    await this.service.deleteImage(query.key);
    return { key: query.key, deleted: true };
  }

  @Get('files/:key')
  @SkipEnvelope()
  @ApiOperation({
    summary: '读取图片文件（仅本地磁盘模式）',
    description: 'S3 模式下图片由对象存储直接提供，本路由返回 404。',
  })
  async file(@Param('key') key: string, @Res() response: Response): Promise<void> {
    if (!(this.storage instanceof LocalDiskMediaStorage)) {
      response.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: '图片由对象存储直接提供' } });
      return;
    }

    try {
      const bytes = await this.storage.read(key);
      response
        .status(200)
        .setHeader(
          'Content-Type',
          key.endsWith('.png') ? 'image/png' : 'image/jpeg',
        )
        // 内容不可变（key 里带 uuid），可以放心长缓存
        .setHeader('Cache-Control', 'public, max-age=31536000, immutable')
        .send(bytes);
    } catch {
      response
        .status(404)
        .json({ ok: false, error: { code: 'NOT_FOUND', message: '图片不存在' } });
    }
  }
}

/**
 * 取当前请求的 origin（用于把相对路径补成绝对地址）。
 *
 * 只信任 `X-Forwarded-Proto` 的 `http`/`https` 两个值，host 走白名单字符集 ——
 * 这个值会写进返回给客户端的 URL 里，不能让它变成反射型注入的载体。
 * 生产环境建议直接配 `MEDIA_PUBLIC_BASE_URL`，就完全不需要走这段推导。
 */
export function resolveOrigin(request: Request): string {
  const forwardedProto = firstHeader(request.headers['x-forwarded-proto']);
  const proto = forwardedProto === 'http' || forwardedProto === 'https' ? forwardedProto : request.protocol;
  const forwardedHost = firstHeader(request.headers['x-forwarded-host']);
  const host = sanitizeHost(forwardedHost ?? request.get('host') ?? 'localhost');
  return `${proto}://${host}`;
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0]?.trim();
  return value?.split(',')[0]?.trim();
}

function sanitizeHost(host: string): string {
  return /^[A-Za-z0-9.\-:[\]]{1,255}$/.test(host) ? host : 'localhost';
}
