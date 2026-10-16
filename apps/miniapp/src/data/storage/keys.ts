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
  /** 论坛版块缓存 */
  forumBoardListCache: `${STORAGE_PREFIX}cache:forum:boards`,
  /** 论坛主题列表缓存 */
  forumPostListCache: `${STORAGE_PREFIX}cache:forum:posts`,
  /** 论坛主题详情缓存（按 id 分片） */
  forumPostDetailCache: `${STORAGE_PREFIX}cache:forum:post`,
  /** FAQ 问答列表缓存 */
  faqArticleListCache: `${STORAGE_PREFIX}cache:faq:articles`,
  /** FAQ「有用」投票记录（幂等的本地依据，与列表缓存分开存） */
  faqHelpfulVotes: `${STORAGE_PREFIX}faq:helpful-votes`,
  /** FAQ 我的工单缓存 */
  faqTicketListCache: `${STORAGE_PREFIX}cache:faq:tickets`,
  /** 敏感模块二次同意记录（契约 §9） */
  consent: `${STORAGE_PREFIX}consent`,
} as const

export type StorageKey = (typeof StorageKeys)[keyof typeof StorageKeys]
