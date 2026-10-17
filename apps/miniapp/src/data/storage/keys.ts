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
  /** 跳蚤市场列表缓存 */
  fleaMarketListCache: `${STORAGE_PREFIX}cache:flea-market:list`,
  /** 跑腿列表缓存 */
  errandListCache: `${STORAGE_PREFIX}cache:errand:list`,
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
  /**
   * 已绑定的校园系统（第二级能力）**离线视图**。
   *
   * 只缓存"哪些平台可用 + 到期时间"，不缓存任何 session / cookie
   * （那些只存在于服务端加密存储里）。用途：断网时身份页仍能正确显示
   * "已绑定教务系统"，而不是一闪而过的"未绑定"误导用户。
   * 实际 key 会拼上用户标识，避免多账号切换时串味。
   */
  campusBindings: `${STORAGE_PREFIX}cache:campus:bindings`,
  /**
   * **Mock 上游**自己保存的绑定状态 / 课表。
   *
   * 与 `campusBindings` 分开是刻意的：一个是"服务端视图的离线缓存"，
   * 一个是"模拟数据源自身的状态"。混用会让"离线缓存旧数据"和
   * "模拟上游里真的没绑定"无法区分，测出的问题也不是真问题。
   */
  mockCampusBindings: `${STORAGE_PREFIX}mock:campus:bindings`,
  /** 课表（mock 模式下由本地模拟上游写入；真实模式下仅作离线兜底） */
  mockCampusCourses: `${STORAGE_PREFIX}mock:campus:courses`,
  /** 「今日课表」视图缓存：断网时显示"上一次看到的课表 + 时间" */
  scheduleTodayCache: `${STORAGE_PREFIX}cache:schedule:today`,
  /** 「本周课表」视图缓存 */
  scheduleWeekCache: `${STORAGE_PREFIX}cache:schedule:week`,
  /** 校园卡总览缓存：**只在连不上后端时**兜底（正常的上游降级由服务端完成） */
  campusCardCache: `${STORAGE_PREFIX}cache:campus-card:overview`,
  /** 隐私开关缓存：断网时开关仍可展示（但不允许假装保存成功） */
  privacySettingsCache: `${STORAGE_PREFIX}cache:privacy:settings`,
  /** 站内信列表缓存：断网进「消息」页也能看到上次拉到的通知 */
  notificationListCache: `${STORAGE_PREFIX}cache:notifications:list`,
  /** 野生动物（档案 / 观察点）列表缓存 */
  wildlifeListCache: `${STORAGE_PREFIX}cache:wildlife:list`,
  /** 食堂营养列表缓存 */
  canteenListCache: `${STORAGE_PREFIX}cache:canteen:list`,
  /**
   * 营养管家「今日营养」缓存（ADR 0006）。
   * 与 `canteenListCache` 分开：那是菜品目录，这是**本人**的当日汇总，
   * 形状与失效时机都不同（记录一餐就要失效）。
   */
  nutritionTodayCache: `${STORAGE_PREFIX}cache:nutrition:today`,
  /** 常见问题列表缓存 */
  faqListCache: `${STORAGE_PREFIX}cache:faq:list`,
  /**
   * 「我已标记有帮助」的本地记录。
   *
   * 与列表缓存分开：它是**用户行为**，形状也不同（`string[]`），
   * 被一次列表刷新覆盖掉会导致重复计数。
   */
  faqHelpfulMarks: `${STORAGE_PREFIX}faq:helpful-marks`,
  /** 偷外卖列表缓存（仅"我的记录"） */
  takeoutGuardListCache: `${STORAGE_PREFIX}cache:takeout-guard:list`,
  /** 心理支持列表缓存（仅「我的预约」） */
  wellbeingListCache: `${STORAGE_PREFIX}cache:wellbeing:list`,
  /**
   * AI 画像的**公开来源清单**离线缓存（非敏感：断网时"哪类数据用在哪、哪类被排除"仍说得出口）。
   * 画像本体刻意**不缓存** —— 它是服务端结论，落盘会在换账号/换设备后被当成自己的数据读出来。
   */
  aiPortraitSourcesCache: `${STORAGE_PREFIX}cache:ai-portrait:sources`,
  /**
   * 首页展示的入口清单（`domain/models/homeEntries` 的入口 id 数组）。
   *
   * 运行时会拼上用户标识（`${homeLayout}:${userId ?? 'anonymous'}`）：
   * 首页是「我的首页」，换账号就该换一份，而不是把上一个人的常用服务
   * 显示给下一个人（同一台手机上换号登录是真实场景）。
   *
   * 与隐私开关相反，这份偏好**不需要**服务端确认：它只是本机的界面状态，
   * 写入失败最坏是"下次进来自定义没生效"，不会造成"以为关掉了其实没关"。
   * 因此允许乐观更新（见 `application/homeLayout/homeLayoutUseCases`）。
   */
  homeLayout: `${STORAGE_PREFIX}home:layout`,
} as const

export type StorageKey = (typeof StorageKeys)[keyof typeof StorageKeys]
