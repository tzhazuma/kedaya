/**
 * wildlife · 控制器（规格 §10.1 的 **17 个端点**）
 *
 * | # | 方法 | 路径 | 登录 |
 * | --- | --- | --- | --- |
 * | 1 | GET | `/basemap` | ❌ |
 * | 2 | GET | `/species` | ❌ |
 * | 3 | GET | `/zones` | ❌ |
 * | 4 | GET | `/zones/:id` | ❌ |
 * | 5 | GET | `/spots` | ❌ |
 * | 6 | GET | `/tracks` | ❌ |
 * | 7 | GET | `/tracks/:id` | ❌ |
 * | 8 | GET | `/individuals` | ❌ |
 * | 9 | GET | `/items` | ❌ |
 * | 10 | GET | `/items/:id` | ❌ |
 * | 11 | POST | `/media` | ✅ |
 * | 12 | POST | `/items` | ✅ |
 * | 13 | PATCH | `/items/:id` | ✅ |
 * | 14 | DELETE | `/items/:id` | ✅ |
 * | 15 | POST | `/items/:id/moderate` | ✅ 审核员 |
 * | 16 | POST | `/individuals` | ✅ |
 * | 17 | POST | `/classify` | ✅ |
 *
 * `WildlifeSpot` / `WildlifeTrack` **没有写端点** —— 派生只读，由 Worker 生成（§6.4）。
 *
 * `moderate` 是契约 §11.2 **已冻结**的动作名（规格 §10.2），直接用，不自创。
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IDEMPOTENCY_HEADER, modulePath } from '@kedaya/contracts';
import type { Request } from 'express';
import { z } from 'zod';
import { AuthGuard, OptionalAuthGuard } from '../../common/auth/auth.guard';
import { CurrentUser, OptionalCurrentUser } from '../../common/auth/current-user';
import { IdempotencyInterceptor } from '../../common/idempotency/idempotency.interceptor';
import { normalizeLimit, readCursor } from '../../common/pagination/cursor';
import { ZodBody } from '../../common/pipes/zod-validation.pipe';
import { ValidationError } from '../../common/errors/app-error';
import { NOTE_MAX_LENGTH } from './domain/content';
import { CLASSIFIED_BY_VALUES } from './domain/taxonomy';
import { MEDIA_MAX_BYTES, MEDIA_MAX_PER_SIGHTING } from './domain/media';
import { INDIVIDUAL_NAME_MAX_LENGTH, WildlifeSightingService } from './wildlife.sighting.service';
import { WildlifeQueryService } from './wildlife.query.service';

/* ------------------------------------------------------------------ *
 * Zod schema（契约 §2：全站唯一的校验实现）
 * ------------------------------------------------------------------ */

const geoPointSchema = z.object({ lat: z.number(), lng: z.number() });

/**
 * 上报请求体。
 *
 * 同时接受两套字段名：规格 §10.3 用 `species` + `geo`，
 * 冻结的 OpenAPI 用 `speciesId` + `latitude`/`longitude`。
 * 两者语义相同，**都收**，避免客户端二选一。
 */
const createSightingSchema = z.object({
  species: z.string().min(1).max(64).optional(),
  speciesId: z.string().min(1).max(64).optional(),
  observedAt: z.coerce.date(),
  geo: geoPointSchema.optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  geoAccuracyM: z.number().int().min(1).max(10000).optional(),
  zoneId: z.string().min(1).max(64).nullish(),
  mediaIds: z.array(z.string().min(1).max(64)).max(MEDIA_MAX_PER_SIGHTING).optional(),
  healthConcern: z.boolean().optional(),
  individualId: z.string().min(1).max(64).nullish(),
  note: z.string().max(NOTE_MAX_LENGTH).nullish(),
  isAnonymous: z.boolean().optional(),
  autoSpeciesId: z.string().min(1).max(64).nullish(),
  autoConfidence: z.number().min(0).max(1).nullish(),
  classifiedBy: z.enum(CLASSIFIED_BY_VALUES).optional(),
  ethicsAcknowledged: z.boolean().optional(),
});

/**
 * RFC 7396 Merge Patch：**只**声明可改的字段。
 *
 * `nullish()` 让 `null` 与"键缺省"都通过校验，两者的区别在用例层处理
 * （`null` = 删除字段，缺省 = 不改）。未知键由 Zod 丢弃（记录在交付说明）。
 */
const patchSightingSchema = z.object({
  species: z.string().min(1).max(64).nullish(),
  observedAt: z.coerce.date().nullish(),
  note: z.string().max(NOTE_MAX_LENGTH).nullish(),
});

const moderateSchema = z.object({
  decision: z.enum(['PUBLISHED', 'REJECTED']),
  reason: z.string().max(200).nullish(),
});

const createIndividualSchema = z.object({
  name: z.string().min(1).max(INDIVIDUAL_NAME_MAX_LENGTH),
  speciesId: z.string().min(1).max(64),
  description: z.string().max(500).nullish(),
  coverPhotoUrl: z.string().max(2048).nullish(),
});

const classifySchema = z.object({ mediaId: z.string().min(1).max(64) });

const mediaFormSchema = z.object({
  clientPhotoId: z.string().min(1).max(64).optional(),
  sortOrder: z.coerce.number().int().min(0).max(2).optional(),
});

/** multer 的 memoryStorage 结果（避免依赖未安装的 `@types/multer`） */
interface UploadedFileLike {
  buffer?: Buffer;
  mimetype?: string;
  size?: number;
  originalname?: string;
}

@ApiTags('wildlife · 野生动物')
@Controller(modulePath('wildlife'))
@UseGuards(OptionalAuthGuard)
@UseInterceptors(IdempotencyInterceptor)
export class WildlifeController {
  constructor(
    @Inject(WildlifeQueryService) private readonly query: WildlifeQueryService,
    @Inject(WildlifeSightingService) private readonly sightings: WildlifeSightingService,
  ) {}

  /* ---------------- 1. 底图 ---------------- */

  @Get('basemap')
  @ApiOperation({ summary: '当前底图配置（含 affine / attribution / license）' })
  basemap() {
    return this.query.basemap();
  }

  /* ---------------- 2. 物种 ---------------- */

  @Get('species')
  @ApiOperation({ summary: '物种列表 + 分类树（无需登录）' })
  species() {
    return this.query.species();
  }

  /* ---------------- 3–4. 区域 ---------------- */

  @Get('zones')
  @ApiOperation({ summary: '区域列表（含 feedingPolicy / noticeText；无需登录）' })
  zones() {
    return this.query.zones();
  }

  @Get('zones/:id')
  @ApiOperation({ summary: '区域详情（无需登录）' })
  zoneDetail(@Param('id') id: string) {
    return this.query.zoneDetail(id);
  }

  /* ---------------- 5. 热点（派生只读，延迟 ≥24h） ---------------- */

  @Get('spots')
  @ApiOperation({ summary: '聚合热点（派生只读，≥24h 聚合延迟；无需登录）' })
  spots(@Query() query: Record<string, unknown>) {
    return this.query.spots({
      cursor: readCursor(query),
      limit: normalizeLimit(query.limit),
      speciesId: readString(query.speciesId) ?? readString(query.species),
      zoneId: readString(query.zoneId),
      minConfidence: readNumber(query.minConfidence),
    });
  }

  /* ---------------- 6–7. 轨迹 ---------------- */

  @Get('tracks')
  @ApiOperation({ summary: '推断轨迹列表（isInferred 恒为 true）' })
  tracks(@Query() query: Record<string, unknown>) {
    return this.query.tracks({
      cursor: readCursor(query),
      limit: normalizeLimit(query.limit),
      speciesId: readString(query.speciesId) ?? readString(query.species),
      individualId: readString(query.individualId),
    });
  }

  @Get('tracks/:id')
  @ApiOperation({ summary: '轨迹详情（含服务端下发的 disclaimer）' })
  trackDetail(@Param('id') id: string) {
    return this.query.trackDetail(id);
  }

  /* ---------------- 8. 命名个体 ---------------- */

  @Get('individuals')
  @ApiOperation({ summary: '已命名个体列表（仅 PUBLISHED；无需登录）' })
  individuals(@Query() query: Record<string, unknown>) {
    return this.query.listIndividuals({
      cursor: readCursor(query),
      limit: normalizeLimit(query.limit),
      speciesId: readString(query.speciesId) ?? readString(query.species),
    });
  }

  /* ---------------- 9. 观测列表（仅 PUBLISHED） ---------------- */

  @Get('items')
  @ApiOperation({ summary: '观测记录列表（游标分页，仅 PUBLISHED；无需登录）' })
  listItems(@Query() query: Record<string, unknown>, @OptionalCurrentUser() viewerId?: string) {
    return this.query.listSightings(
      {
        cursor: readCursor(query),
        limit: normalizeLimit(query.limit),
        speciesId: readString(query.speciesId) ?? readString(query.species),
        zoneId: readString(query.zoneId),
      },
      viewerId,
    );
  }

  /* ---------------- 10. 观测详情 ---------------- */

  @Get('items/:id')
  @ApiOperation({ summary: '观测详情（PUBLISHED 公开；非公开仅本人/审核员可见）' })
  itemDetail(@Param('id') id: string, @OptionalCurrentUser() viewerId?: string) {
    return this.query.sightingDetail(id, viewerId);
  }

  /* ---------------- 11. 上传照片 ---------------- */

  /**
   * 上传照片（multipart/form-data）。
   *
   * **服务端强制剥离 EXIF**（含 GPS）—— 客户端承诺不算数，服务端必须断言。
   * 剥离后仍检出元数据则返回 500（`EXIF_STRIP_FAILED`），宁可失败也不放行。
   *
   * 同时兼容**非 multipart** 的裸二进制上传（`application/octet-stream`），
   * 方便原生端与命令行工具。
   */
  @Post('media')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiHeader({ name: IDEMPOTENCY_HEADER, required: true, description: '契约 §11.3：POST 必需' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ summary: '上传照片（返回 mediaId；服务端强制剥离 EXIF）' })
  async uploadMedia(
    @CurrentUser() actorId: string,
    @UploadedFile() file: UploadedFileLike | undefined,
    @Body() body: unknown,
    @Query() query: Record<string, unknown>,
    @Req() request: Request,
  ) {
    const form = mediaFormSchema.parse(body ?? {});
    const clientPhotoId =
      form.clientPhotoId ??
      readString(query.clientPhotoId) ??
      readHeader(request, 'x-client-photo-id') ??
      '';
    if (!clientPhotoId) {
      throw new ValidationError('缺少 clientPhotoId（幂等键，规格 §4.5）', {
        reason: 'CLIENT_PHOTO_ID_REQUIRED',
      });
    }

    // multipart 优先；否则把请求体当作裸二进制读（带上限，防内存打爆）
    const data = file?.buffer ?? (await readRawBody(request));
    return this.sightings.uploadMedia(actorId, {
      data,
      declaredMime: file?.mimetype ?? readHeader(request, 'content-type'),
      clientPhotoId,
      sortOrder: form.sortOrder,
    });
  }

  /* ---------------- 12. 上报观测 ---------------- */

  @Post('items')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiHeader({ name: IDEMPOTENCY_HEADER, required: true, description: '契约 §11.3：POST 必需' })
  @ApiOperation({ summary: '上报观测（发现时间 + 地点 + 照片 + 物种）' })
  createItem(
    @CurrentUser() actorId: string,
    @ZodBody(createSightingSchema) body: z.infer<typeof createSightingSchema>,
  ) {
    return this.sightings.createSighting(actorId, body);
  }

  /* ---------------- 13. 修正（RFC 7396 Merge Patch） ---------------- */

  @Patch('items/:id')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '修正自己的上报（JSON Merge Patch；null 表示删除字段）' })
  patchItem(
    @Param('id') id: string,
    @CurrentUser() actorId: string,
    @ZodBody(patchSightingSchema) body: z.infer<typeof patchSightingSchema>,
  ) {
    return this.sightings.patchSighting(id, actorId, body);
  }

  /* ---------------- 14. 撤回（软删） ---------------- */

  @Delete('items/:id')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '撤回自己的上报（软删）' })
  deleteItem(@Param('id') id: string, @CurrentUser() actorId: string) {
    return this.sightings.deleteSighting(id, actorId);
  }

  /* ---------------- 15. 审核（契约 §11.2 冻结 action：moderate） ---------------- */

  @Post('items/:id/moderate')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiHeader({ name: IDEMPOTENCY_HEADER, required: true, description: '契约 §11.3：POST 必需' })
  @ApiOperation({ summary: '审核观测（PENDING → PUBLISHED/REJECTED；需审核员）' })
  moderate(
    @Param('id') id: string,
    @CurrentUser() actorId: string,
    @ZodBody(moderateSchema) body: z.infer<typeof moderateSchema>,
  ) {
    return this.sightings.moderate(id, actorId, body);
  }

  /* ---------------- 16. 创建命名个体 ---------------- */

  @Post('individuals')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiHeader({ name: IDEMPOTENCY_HEADER, required: true, description: '契约 §11.3：POST 必需' })
  @ApiOperation({ summary: '创建命名个体（"手动给个名字"；需审核后才公开）' })
  createIndividual(
    @CurrentUser() actorId: string,
    @ZodBody(createIndividualSchema) body: z.infer<typeof createIndividualSchema>,
  ) {
    return this.sightings.createIndividual(actorId, body);
  }

  /* ---------------- 17. 请求分类建议 ---------------- */

  @Post('classify')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiHeader({ name: IDEMPOTENCY_HEADER, required: true, description: '契约 §11.3：POST 必需' })
  @ApiOperation({ summary: '请求自动分类建议（无能力时返回空数组 + degraded:true，不报 5xx）' })
  classify(@CurrentUser() actorId: string, @ZodBody(classifySchema) body: { mediaId: string }) {
    return this.sightings.classify(actorId, body);
  }
}

/* ------------------------------------------------------------------ *
 * 辅助
 * ------------------------------------------------------------------ */

function readString(raw: unknown): string | undefined {
  return typeof raw === 'string' && raw.trim() ? raw.trim() : undefined;
}

function readNumber(raw: unknown): number | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const parsed = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function readHeader(request: Request, name: string): string | undefined {
  const raw = request.headers?.[name] ?? request.headers?.[name.toLowerCase()];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/**
 * 读裸请求体（非 multipart 上传路径）。
 *
 * 带上限：超过 5MB 就停止累积并抛 422 ——
 * 不能让一个超大 body 把进程内存打爆（规格 §4.2 的 5MB 上限是**服务端**的）。
 */
async function readRawBody(request: Request): Promise<Buffer> {
  const limit = MEDIA_MAX_BYTES + 1;
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    total += buf.length;
    if (total > limit) {
      throw new ValidationError('上传内容超过 5 MB 上限', { reason: 'MEDIA_TOO_LARGE' });
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}
