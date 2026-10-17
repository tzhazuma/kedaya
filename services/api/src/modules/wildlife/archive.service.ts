import { createHash, randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import sharp from 'sharp';
import { WILDLIFE_CATEGORIES, isOnCampus, blurredCampusPoint } from '@kedaya/contracts';
import type { WildlifeAnimal, WildlifePhoto, WildlifeSighting } from '@kedaya/contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { AppError, ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../common/errors/app-error';
import type { AnimalInput, AnimalUpdate, ArchiveQuery, SightingInput, SightingUpdate } from './domain/archive.schemas';

const author = { select: { id: true, displayName: true } } as const;
const animalInclude = { creator: author, avatar: true, _count: { select: { sightings: { where: { moderationStatus: 'public' } } } } } as const;
const sightingInclude = { author, animal: { select: { id: true, name: true } }, photos: { include: { image: true }, orderBy: { sortOrder: 'asc' } } } as const;
type AnimalRow = Prisma.WildlifeAnimalGetPayload<{ include: typeof animalInclude }>;
type SightingRow = Prisma.WildlifeSightingGetPayload<{ include: typeof sightingInclude }>;
export const wildlifeUploadDir = () => resolve(process.env.WILDLIFE_UPLOAD_DIR ?? './uploads/wildlife');
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const photo = (image: { id: string } | null): WildlifePhoto | null => image ? { id: image.id, url: `/api/v1/wildlife/photos/${image.id}` } : null;
function animalDto(r: AnimalRow): WildlifeAnimal {
  return { id: r.id, name: r.name, category: r.category, avatar: photo(r.avatar), appearance: r.appearance, commonArea: r.commonArea,
    description: r.description, createdBy: r.createdBy, creator: r.creator, createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(), mergedIntoId: r.mergedIntoId, sightingCount: r._count.sightings };
}
function sightingDto(r: SightingRow): WildlifeSighting {
  return { id: r.id, category: r.category, description: r.description, place: r.place, latitude: r.latitude, longitude: r.longitude,
    locationBlurred: r.locationBlurred, observedAt: r.observedAt.toISOString(), createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(), createdBy: r.createdBy, author: r.author, animalId: r.animalId,
    animal: r.animal, photos: r.photos.map(p => photo(p.image)!) };
}

@Injectable()
export class WildlifeArchiveService {
  constructor(@Inject(PrismaService) private readonly db: PrismaService) {}
  categories() { return WILDLIFE_CATEGORIES; }
  private category(id: string) {
    const value = WILDLIFE_CATEGORIES.find(c => c.id === id);
    if (!value) throw new ValidationError('不支持的动物类别');
    return value;
  }
  private canEdit(owner: string, actor: string) {
    const admins = (process.env.WILDLIFE_ADMIN_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean);
    if (owner !== actor && !admins.includes(actor)) throw new ForbiddenError('只能修改自己创建的内容');
  }
  private async images(ids: string[], actor: string) {
    const count = await this.db.wildlifeImage.count({ where: { id: { in: ids }, createdBy: actor } });
    if (count !== ids.length) throw new ValidationError('照片不存在或不属于当前用户');
  }
  private async writeLimit(actor: string) {
    const since = new Date(Date.now() - 60_000);
    const counts = await Promise.all([
      this.db.wildlifeSighting.count({ where: { createdBy: actor, createdAt: { gte: since } } }),
      this.db.wildlifeAnimal.count({ where: { createdBy: actor, createdAt: { gte: since } } }),
    ]);
    if (counts[0]! + counts[1]! >= 12) throw new AppError('RATE_LIMITED', '发布过于频繁，请一分钟后重试');
  }
  async listAnimals(q: ArchiveQuery) {
    const where: Prisma.WildlifeAnimalWhereInput = { moderationStatus: 'public', mergedIntoId: null, category: q.category,
      ...(q.search ? { OR: ['name', 'appearance', 'commonArea'].map(field => ({ [field]: { contains: q.search, mode: 'insensitive' } })) } : {}) };
    const rows = await this.db.wildlifeAnimal.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: q.limit + 1, ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}), include: animalInclude });
    return { items: rows.slice(0, q.limit).map(animalDto), nextCursor: rows.length > q.limit ? rows[q.limit - 1]!.id : null };
  }
  async animal(id: string) {
    const row = await this.db.wildlifeAnimal.findFirst({ where: { id, moderationStatus: 'public' }, include: animalInclude });
    if (!row) throw new NotFoundError('居民身份卡不存在');
    return animalDto(row);
  }
  async listSightings(q: ArchiveQuery) {
    const where: Prisma.WildlifeSightingWhereInput = { moderationStatus: 'public', category: q.category, animalId: q.animalId,
      latitude: { gte: q.south, lte: q.north }, longitude: { gte: q.west, lte: q.east },
      observedAt: { ...(q.since ? { gte: new Date(q.since) } : {}), ...(q.until ? { lte: new Date(q.until) } : {}) } };
    const rows = await this.db.wildlifeSighting.findMany({ where, orderBy: [{ observedAt: 'desc' }, { id: 'desc' }],
      take: q.limit + 1, ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}), include: sightingInclude });
    return { items: rows.slice(0, q.limit).map(sightingDto), nextCursor: rows.length > q.limit ? rows[q.limit - 1]!.id : null };
  }
  async sighting(id: string) {
    const row = await this.db.wildlifeSighting.findFirst({ where: { id, moderationStatus: 'public' }, include: sightingInclude });
    if (!row) throw new NotFoundError('偶遇记录不存在');
    return sightingDto(row);
  }
  async createAnimal(body: AnimalInput, actor: string): Promise<WildlifeAnimal> {
    const previous = await this.db.wildlifeAnimal.findUnique({ where: { createdBy_clientRequestId: { createdBy: actor, clientRequestId: body.clientRequestId } }, include: animalInclude });
    if (previous) { if (previous.requestHash !== hash(body)) throw new ConflictError('请勿重复使用发布编号'); return animalDto(previous); }
    this.category(body.category); await this.images(body.avatarId ? [body.avatarId] : [], actor); await this.writeLimit(actor);
    try { return animalDto(await this.db.wildlifeAnimal.create({ data: { ...body, createdBy: actor, requestHash: hash(body) }, include: animalInclude })); }
    catch (e) { if ((e as { code?: string }).code === 'P2002') return this.createAnimal(body, actor); throw e; }
  }
  async updateAnimal(id: string, body: AnimalUpdate, actor: string) {
    const previous = await this.animal(id); this.canEdit(previous.createdBy, actor);
    if (body.category && body.category !== previous.category) {
      if (previous.sightingCount > 0) throw new ConflictError('已有足迹的居民不能更改类别');
      this.category(body.category);
    }
    if (body.avatarId && body.avatarId !== previous.avatar?.id) await this.images([body.avatarId], actor);
    return animalDto(await this.db.wildlifeAnimal.update({ where: { id }, data: body, include: animalInclude }));
  }
  private async prepareSighting(body: Omit<SightingInput, 'clientRequestId'>, actor: string, existingPhotoIds: string[] = [],
    previous?: Pick<WildlifeSighting, 'latitude' | 'longitude' | 'locationBlurred'>) {
    const unchangedBlur = previous?.locationBlurred && body.latitude === previous.latitude && body.longitude === previous.longitude;
    if (!isOnCampus(body) && !unchangedBlur) throw new ValidationError('发现地点必须位于上海科技大学校园内');
    const kind = this.category(body.category);
    if (new Date(body.observedAt).getTime() > Date.now() + 300_000) throw new ValidationError('发现时间不能在未来');
    if (body.animalId) {
      const animal = await this.animal(body.animalId);
      if (animal.mergedIntoId) throw new ConflictError('这张身份卡已合并，请选择新档案');
      if (animal.category !== body.category) throw new ValidationError('身份卡与动物类别不一致');
    }
    await this.images(body.photoIds.filter(id => !existingPhotoIds.includes(id)), actor);
    const blurred = body.locationBlurred || kind.sensitive || Boolean(unchangedBlur);
    const point = blurred ? blurredCampusPoint(body) : body;
    return { ...body, locationBlurred: blurred,
      latitude: point.latitude, longitude: point.longitude,
      place: blurred ? '校园附近（位置已模糊）' : body.place };
  }
  async createSighting(body: SightingInput, actor: string): Promise<WildlifeSighting> {
    const previous = await this.db.wildlifeSighting.findUnique({ where: { createdBy_clientRequestId: { createdBy: actor, clientRequestId: body.clientRequestId } }, include: sightingInclude });
    if (previous) { if (previous.requestHash !== hash(body)) throw new ConflictError('请勿重复使用发布编号'); return sightingDto(previous); }
    await this.writeLimit(actor);
    const { photoIds, ...fields } = await this.prepareSighting(body, actor);
    try { return sightingDto(await this.db.wildlifeSighting.create({ data: { ...fields, clientRequestId: body.clientRequestId,
      observedAt: new Date(body.observedAt), createdBy: actor, requestHash: hash(body),
      photos: { create: photoIds.map((imageId, sortOrder) => ({ imageId, sortOrder })) } }, include: sightingInclude })); }
    catch (e) { if ((e as { code?: string }).code === 'P2002') return this.createSighting(body, actor); throw e; }
  }
  async updateSighting(id: string, body: SightingUpdate, actor: string) {
    const previous = await this.sighting(id); this.canEdit(previous.createdBy, actor);
    const data = await this.prepareSighting({ ...previous, photoIds: previous.photos.map(p => p.id), ...body }, actor, previous.photos.map(p => p.id), previous);
    // 原坐标本来就是模糊值：没有重新选点就取消勾选，不能把模糊坐标当成精确位置保存。
    const untouched = data.latitude === previous.latitude && data.longitude === previous.longitude;
    const keepBlurred = previous.locationBlurred && untouched;
    const { category, description, observedAt, animalId, photoIds } = data;
    const place = keepBlurred ? '校园附近（位置已模糊）' : data.place;
    const locationBlurred = data.locationBlurred || keepBlurred;
    return sightingDto(await this.db.wildlifeSighting.update({ where: { id }, data: {
      category, description, place, latitude: data.latitude, longitude: data.longitude, locationBlurred, observedAt: new Date(observedAt), animalId,
      photos: { deleteMany: {}, create: photoIds.map((imageId, sortOrder) => ({ imageId, sortOrder })) },
    }, include: sightingInclude }));
  }
  async removeSighting(id: string, actor: string) {
    const previous = await this.sighting(id); this.canEdit(previous.createdBy, actor);
    await this.db.wildlifeSighting.delete({ where: { id } }); return { id, deleted: true };
  }
  async upload(file: { buffer: Buffer; mimetype: string; size: number } | undefined, actor: string) {
    if (!file || !['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype) || file.size > 8 * 1024 * 1024)
      throw new ValidationError('请上传不超过 8MB 的 JPEG、PNG 或 WebP 图片');
    const count = await this.db.wildlifeImage.count({ where: { createdBy: actor, createdAt: { gte: new Date(Date.now() - 60_000) } } });
    if (count >= 20) throw new AppError('RATE_LIMITED', '上传过于频繁，请稍后重试');
    let buffer: Buffer;
    try {
      const image = sharp(file.buffer, { limitInputPixels: 40_000_000 });
      const meta = await image.metadata();
      if (!['jpeg', 'png', 'webp'].includes(meta.format ?? '') || (meta.pages ?? 1) > 1) throw new Error('Unsupported image');
      // 默认重新编码移除 EXIF，包括拍摄定位。
      buffer = await image.rotate().resize({ width: 1920, height: 1920, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
    } catch { throw new ValidationError('照片损坏或类型不受支持'); }
    await mkdir(wildlifeUploadDir(), { recursive: true });
    const filename = `${randomUUID()}.jpg`, target = resolve(wildlifeUploadDir(), filename);
    await writeFile(target, buffer);
    try { return photo(await this.db.wildlifeImage.create({ data: { filename, size: buffer.length, createdBy: actor } }))!; }
    catch (e) { await unlink(target).catch(() => undefined); throw e; }
  }
  async photoFile(id: string) {
    const row = await this.db.wildlifeImage.findUnique({ where: { id } });
    if (!row) throw new NotFoundError('图片不存在');
    return resolve(wildlifeUploadDir(), row.filename);
  }
}
