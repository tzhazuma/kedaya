/** 野生居民档案：事件与动物身份分开建模，坐标统一使用 GCJ-02。 */
export interface WildlifeCategory {
  id: string; label: string; glyph: string; color: string; sensitive: boolean;
}
export const WILDLIFE_CATEGORIES: readonly WildlifeCategory[] = [
  { id: 'cat', label: '猫', glyph: '猫', color: '#DC8B38', sensitive: false },
  { id: 'bird', label: '鸟类', glyph: '鸟', color: '#528AB0', sensitive: false },
  { id: 'swan', label: '黑天鹅', glyph: '鹅', color: '#65587C', sensitive: false },
  { id: 'hedgehog', label: '刺猬', glyph: '猬', color: '#947352', sensitive: false },
  { id: 'squirrel', label: '松鼠', glyph: '松', color: '#B86C45', sensitive: false },
  { id: 'insect', label: '昆虫', glyph: '虫', color: '#66854B', sensitive: false },
  { id: 'other', label: '其他动物', glyph: '野', color: '#5F8172', sensitive: false },
];
// 张江校区中心，GCJ-02；作为初始视野，不作为用户的目击位置。
export const WILDLIFE_CAMPUS = { latitude: 31.1773, longitude: 121.5940, scale: 16 };
export interface WildlifePhoto { id: string; url: string }
export interface WildlifeAuthor { id: string; displayName: string }
export interface WildlifeAnimal {
  id: string; name: string; category: string; avatar: WildlifePhoto | null;
  appearance: string; commonArea: string; description: string;
  createdBy: string; createdAt: string; updatedAt: string;
  creator: WildlifeAuthor; sightingCount: number; mergedIntoId: string | null;
}
export interface WildlifeSighting {
  id: string; category: string; description: string; place: string;
  latitude: number; longitude: number; locationBlurred: boolean;
  observedAt: string; createdAt: string; updatedAt: string; createdBy: string;
  author: WildlifeAuthor; animalId: string | null;
  animal: { id: string; name: string } | null; photos: WildlifePhoto[];
}
export interface WildlifePage<T> { items: T[]; nextCursor: string | null }
export interface WildlifeSightingInput {
  category: string; description: string; place: string;
  latitude: number; longitude: number; locationBlurred: boolean;
  observedAt: string; animalId: string | null; photoIds: string[];
  clientRequestId: string;
}
export interface WildlifeAnimalInput {
  name: string; category: string; avatarId: string | null;
  appearance: string; commonArea: string; description: string; clientRequestId: string;
}
