/**
 * 本地缓存 key（集中管理，禁止散落在业务代码里拼字符串）。
 *
 * 前缀带 schema 版本号：缓存结构变更时改版本号即可让旧缓存自然失效。
 */
export const STORAGE_SCHEMA_VERSION = 1

export const STORAGE_PREFIX = `kedaya:v${STORAGE_SCHEMA_VERSION}:`

export const StorageKeys = {
  /** 会话（token + profile） */
  session: `${STORAGE_PREFIX}session`,
  /** 拼单列表缓存（契约 §8 第 1 步 hydrate 用） */
  groupBuyListCache: `${STORAGE_PREFIX}cache:groupbuy:list`,
  /** 拼单详情缓存 */
  groupBuyDetailCache: `${STORAGE_PREFIX}cache:groupbuy:detail`,
  /** 敏感模块二次同意记录（契约 §9） */
  consent: `${STORAGE_PREFIX}consent`,
  /** 跳蚤市场列表缓存 */
  fleaMarketListCache: `${STORAGE_PREFIX}cache:flea-market:list`,
  /** 跑腿列表缓存 */
  errandListCache: `${STORAGE_PREFIX}cache:errand:list`,
  /** 找搭子列表缓存 */
  buddyListCache: `${STORAGE_PREFIX}cache:buddy:list`,
  /** 失物招领列表缓存 */
  lostFoundListCache: `${STORAGE_PREFIX}cache:lost-found:list`,
  /** 论坛帖子列表缓存 */
  forumListCache: `${STORAGE_PREFIX}cache:forum:list`,
  /**
   * 宿舍矛盾：本地保存自己提交过的**追踪码**。
   *
   * 追踪码是查看匿名案子的唯一凭据（服务端只存哈希、无法找回），
   * 所以在本地留一份，用户下次打开还能看进度 —— 这是"匿名 + 可追溯"的关键。
   */
  dormHarmonyTrackCodes: `${STORAGE_PREFIX}dorm-harmony:track-codes`,
} as const

export type StorageKey = (typeof StorageKeys)[keyof typeof StorageKeys]
