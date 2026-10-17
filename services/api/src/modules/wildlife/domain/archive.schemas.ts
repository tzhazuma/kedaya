import { z } from 'zod';
const text = (max: number) => z.string().trim().max(max);
const id = text(100).min(1);
const category = text(50).min(1);
export const animalSchema = z.object({ name: text(60).min(1), category, avatarId: id.nullable(),
  appearance: text(500), commonArea: text(200), description: text(1500), clientRequestId: text(100).min(8) }).strict();
export const sightingSchema = z.object({ category, description: text(1500).min(1), place: text(200).min(1),
  latitude: z.number().finite().min(-90).max(90), longitude: z.number().finite().min(-180).max(180),
  locationBlurred: z.boolean(), observedAt: z.iso.datetime(), animalId: id.nullable(),
  photoIds: z.array(id).max(6).refine(ids => new Set(ids).size === ids.length, '照片不能重复'), clientRequestId: text(100).min(8) }).strict();
export const animalUpdateSchema = animalSchema.omit({ clientRequestId: true }).partial();
export const sightingUpdateSchema = sightingSchema.omit({ clientRequestId: true }).partial();
export const listSchema = z.object({ category: category.optional(), search: text(120).optional(), animalId: id.optional(),
  cursor: id.optional(), limit: z.coerce.number().int().min(1).max(100).default(30),
  south: z.coerce.number().min(-90).max(90).optional(), north: z.coerce.number().min(-90).max(90).optional(),
  west: z.coerce.number().min(-180).max(180).optional(), east: z.coerce.number().min(-180).max(180).optional(),
  since: z.iso.datetime().optional(), until: z.iso.datetime().optional(),
}).refine(q => q.south === undefined || q.north === undefined || q.south <= q.north, '纬度范围错误')
  .refine(q => q.west === undefined || q.east === undefined || q.west <= q.east, '经度范围错误')
  .refine(q => !q.since || !q.until || q.since <= q.until, '时间范围错误');
export type ArchiveQuery = z.infer<typeof listSchema>;
export type AnimalInput = z.infer<typeof animalSchema>;
export type SightingInput = z.infer<typeof sightingSchema>;
export type AnimalUpdate = z.infer<typeof animalUpdateSchema>;
export type SightingUpdate = z.infer<typeof sightingUpdateSchema>;
