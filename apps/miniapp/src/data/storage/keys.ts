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
} as const

export type StorageKey = (typeof StorageKeys)[keyof typeof StorageKeys]
