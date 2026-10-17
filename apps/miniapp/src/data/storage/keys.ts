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
  /** 野生动物地图缓存（底图 / 物种 / 区域 / 热点 / 轨迹 / 观测） */
  wildlifeMapCache: `${STORAGE_PREFIX}cache:wildlife:map`,
  /** 野生动物推断轨迹缓存 */
  wildlifeTracksCache: `${STORAGE_PREFIX}cache:wildlife:tracks`,
  /** 野生动物上报表单的物种 / 个体缓存 */
  wildlifeReportCache: `${STORAGE_PREFIX}cache:wildlife:report`,
  /**
   * 伦理提示的本地确认标记（规格 §8.2「同一用户只提示一次」）。
   *
   * ⚠️ 这**不是**同意记录：`wildlife` 敏感级为 `low`、**无同意门**，
   * 契约 §9 的同意门只适用于 `wellbeing` / `dorm-harmony` / `ai-portrait`。
   * 这里存的是「表单操作确认」的时间戳，不产生任何授权状态。
   */
  wildlifeEthicsAck: `${STORAGE_PREFIX}wildlife:ethics-ack`,
  /* ---------------- 找搭子（`buddy`） ---------------- */
  /**
   * 搭子列表缓存（按板块分片：`${buddyListCache}:${section}`）。
   * 分片是必须的 —— 否则切板块时 `hydrate()` 会把上一个板块的缓存渲染出来。
   */
  buddyListCache: `${STORAGE_PREFIX}cache:buddy:list`,
  /** 搭子详情缓存（按 id 分片） */
  buddyDetailCache: `${STORAGE_PREFIX}cache:buddy:detail`,
  /** 推荐缓存（按板块分片） */
  buddyRecommendationCache: `${STORAGE_PREFIX}cache:buddy:recommendations`,
  /** 我的匹配资料缓存 */
  buddyProfileCache: `${STORAGE_PREFIX}cache:buddy:profile`,
  /**
   * 我提交过的匹配反馈（本地记忆，UPSERT 语义）。
   *
   * 只用于**按钮态**（哪个已 like / dislike / skip）与离线提示；
   * 真正的反馈数据在服务端（`@@unique([userId, targetPostId, section])`）。
   */
  buddyFeedback: `${STORAGE_PREFIX}buddy:feedback`,
  /* ---------------- TechPie 整合 / 校园能力（`techpie` / `campus-card`） ---------------- */
  /**
   * 绑定列表缓存（`GET /techpie/links` 的结果）。
   *
   * ⚠️ 缓存里存的是 `CampusBindingSummary[]` —— 形状上**没有任何凭证字段**
   * （契约 §11.4 I1）。写入前会再做一次禁用键扫描，见
   * `application/techpie/listBindings.ts` 的 `writeCache`。
   */
  techpieBindingListCache: `${STORAGE_PREFIX}cache:techpie:links`,
  /** 校园能力清单缓存（`GET /techpie/capabilities`） */
  techpieCapabilityCache: `${STORAGE_PREFIX}cache:techpie:capabilities`,
  /**
   * 校园卡流水缓存（`GET /campus-card/items`）。
   *
   * 余额由**最新一笔流水**的 `balanceFen` 推导，因此余额不需要单独的缓存键。
   */
  campusCardTransactionCache: `${STORAGE_PREFIX}cache:campus-card:transactions`,
  /** 敏感模块二次同意记录（契约 §9） */
  consent: `${STORAGE_PREFIX}consent`,
} as const

export type StorageKey = (typeof StorageKeys)[keyof typeof StorageKeys]
