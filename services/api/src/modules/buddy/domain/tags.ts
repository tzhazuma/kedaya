/**
 * 找搭子 · 封闭标签表 —— **已收敛到唯一真相**
 *
 * ⚠️ 本文件不再自己维护数据。标签表在 `@kedaya/contracts` 的 `buddy-tags`，
 * 全仓只有那一份。这里只做 re-export，保持既有 import 路径不变。
 *
 * **为什么**：收敛前四端各有一份且互不相同（服务端 62 / 小程序 62 / **Web 46**），
 * 导致 **Web 用户选到的标签会被后端 `UNKNOWN_TAG` 拒**。
 * 根因是没有唯一真相，所以修法是收敛，而不是"把 Web 改成 62 条"。
 */
export {
  BUDDY_TAGS,
  TAG_KEYS,
  tagLabel,
  tagLabels,
  isKnownTag,
  unknownTags,
  activeTags,
  MAX_INTEREST_TAGS,
  MAX_ACTIVITY_TAGS,
  MAX_POST_TAGS,
  MAX_PREFERRED_AREAS,
  SKILL_LEVELS,
  SKILL_RANK,
  isSkillLevel,
  skillRank,
  CAMPUS_LOCATIONS,
  isKnownLocation,
  normalizeLocation,
  type BuddyTagDef,
  type BuddyTagGroup,
  type BuddySkillLevel,
} from '@kedaya/contracts';
