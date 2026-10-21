/**
 * 模块交付状态（Web 门户展示用，domain 层，零框架依赖 —— 契约 §7）。
 *
 * 冻结契约 §4 只回答"有这 19 个模块"，不回答"哪些已经能用"。但门户必须**如实**
 * 告诉同学每个模块现在到底能做什么：能在 Web 门户用、已在小程序端上线、
 * 还是只有后端接口。这份表就是那个真相来源。
 *
 * 约定：
 *   · 端上真的交付了才改这里，**不要为了宫格好看提前点亮**；
 *   · `stage: 'web'` 必须同时给出 `webHref`（`validateModuleRegistry` 会校验），
 *     否则会出现"标着 Web 已上线、点进去却是占位页"的假象。
 */

export type DeliveryStage =
  /** Web 门户已有真实页面（可点进去使用） */
  | 'web'
  /** 微信小程序端已上线（与后端同一套 API） */
  | 'miniapp'
  /** 只有后端接口，两端都还没有页面 */
  | 'api-only';

export interface ModuleDelivery {
  stage: DeliveryStage;
  /** Web 端的真实路由（仅 `stage === 'web'` 时给出） */
  webHref?: string;
  /** 已交付时：端上到底能做什么（一句话，模块页展示） */
  note?: string;
}

/**
 * key = 冻结模块 id。未登记的模块一律 `api-only`。
 *
 * 现状（2026-10-18）：
 *   · Web 门户：拼单切片 + 管理后台；
 *   · 微信小程序（主端）：**20 / 20** 个模块端上可用 ——
 *     五个核心模块（账号 `auth`、课表 `schedule`、校园卡 `campus-card`、
 *     我的 `profile`、站内信 `notifications`）+ 六个生活模块（拼单、跳蚤、跑腿、
 *     找搭子、失物招领、论坛）+ 宿舍矛盾 + 四个共建型模块（食堂 `canteen`、
 *     常见问题 `faq`、动物观察 `wildlife`、偷外卖 `takeout-guard`）+
 *     技术服务目录 `techpie` + 心理支持 `wellbeing` + AI 画像 `ai-portrait` +
 *     场馆预约 `facility`（列表 / 发起 / 详情）。
 *
 * ⚠️ 校园数据默认走 `CAMPUS_DATA_MODE=mock`（确定性模拟数据，响应标 `simulated: true`）。
 * 「小程序已上线」指的是**端上能用**，不代表已经对接学校真实系统。
 */
const DELIVERY: Readonly<Record<string, ModuleDelivery>> = {
  // ---- 小程序已上线（含后端真实逻辑） ----
  auth: {
    stage: 'miniapp',
    note: '三条并列登录入口（校园 CAS / 邮箱密码 / 微信快捷），账号自助改资料与绑定解绑；令牌可撤销轮换，连续失败会锁定。',
  },
  profile: {
    stage: 'miniapp',
    note: '我的：账号状态、隐私开关与敏感模块同意（可撤回）、数据导出、我的资产入口。',
  },
  'campus-map': {
    stage: 'miniapp',
    note:
      '快递站、地下车库、食堂菜单、活动场地与自习空间的列表与「下一站」安排。' +
      '**照片一律不内置**：`map.niyiwei.com` 的地库与菜单照片是另一参赛组同学手拍，' +
      '著作权归拍摄者；我们的校验层主动拒收该域名，且有图必须署名。',
  },
  petition: {
    stage: 'miniapp',
    note:
      '把同学之间的共同需求汇总成一份**可核对**的诉求：附议人数、征集时间窗、' +
      '对接部门都在页面上；达到门槛后由发起人生成一封正式邮件发给对应部门。' +
      '⚠️ 这里的「众筹」**不筹钱**，筹的是「有多少人真的需要」—— 页面里没有任何金额字段。' +
      '附议匿名（只统计人数），发起人实名（部门需要能联系到的人）。' +
      '本轮只有契约规则层与小程序页面，**服务端还没有对应接口**，数据暂存本机。',
  },
  deadlines: {
    stage: 'miniapp',
    note:
      '把散在 Blackboard / Gradescope / Piazza / e云平台的截止日期聚到一处，按紧迫度排序、' +
      '标出来源与是否已交。**收集方式是用户自己粘贴**已有的作业列表 —— 不代登录任何平台、' +
      '不存平台密码。认不出的行会原样回显，不静默丢弃。',
  },
  schedule: {
    stage: 'miniapp',
    note: '今日课表（正在上 / 下一节还有多久）、本周课表与学期切换、一键同步教务、手动加课；未绑定校园系统时明确提示而不是显示空课表。',
  },
  'campus-card': {
    stage: 'miniapp',
    note: '余额与低余额提醒、「还能撑几天」估算、消费流水与异常扣款、消费集中地；挂失只给可执行指引（对校园卡系统没有写权限，不谎称已挂失）。',
  },
  notifications: {
    stage: 'miniapp',
    note: '站内信列表（游标分页、未读筛选、全部已读）+ tabBar 未读红点；点击按服务端下发的页面路径跳转，未知路径一律不可点。',
  },
  'flea-market': {
    stage: 'miniapp',
    note: '闲置发布、关键词与分类筛选、详情、降价 / 预定 / 售出状态流转。',
  },
  errand: {
    stage: 'miniapp',
    note: '代取、代买、代送任务发布，接单与送达确认，悬赏金额按整数分记账。',
  },
  buddy: {
    stage: 'miniapp',
    note: '组队招募、名额管理与加入退出；满员自动转为 full，只有招募中才能关闭。',
  },
  'lost-found': {
    stage: 'miniapp',
    note: '寻物与招领登记、搜索筛选、认领确认。',
  },
  forum: {
    stage: 'miniapp',
    note: '版块浏览、发帖（支持匿名）、回复与举报；关闭的帖子默认不出现在列表。',
  },
  'dorm-harmony': {
    stage: 'miniapp',
    note: '匿名提交、二次同意门、凭一次性追踪码跟进；没有公开列表（接口恒 403），错误文案统一以防枚举。',
  },

  // ---- 共建型模块（同学共建 + 人工核对） ----
  canteen: {
    stage: 'miniapp',
    note: '营养管家：菜品库检索（食堂 / 品类 / 菜名，已下架的不返回）、每餐记录与六项营养汇总、每日需求与缺口推荐、拍照识别候选（演示期为 mock，界面明示）、忌口/过敏原**硬过滤**。写菜品库需管理员（Web 后台有专用页）。所有饮食建议仅供参考，不做医学判断、不替代医生。',
  },
  faq: {
    stage: 'miniapp',
    note: '问答库：分类与搜索、手风琴展开、「有用」投票（幂等，同一账号只计一次）；另有「我的工单」提交与查看。',
  },
  wildlife: {
    stage: 'miniapp',
    note: '动物活动地图（区域圈 + 聚合热点）、上报观测（照片 / 定位 / 物种）与推断轨迹（明确标注不是实测路径）；含投喂规范与位置模糊化说明。',
  },
  'takeout-guard': {
    stage: 'miniapp',
    note: '**本人可见**的偷外卖报备记录（归属只从登录态取，非本人 404）：记录 → 升级 → 解决三段状态跟进，不是公开举报墙。',
  },

  // ---- 校园能力整合 ----
  techpie: {
    stage: 'miniapp',
    note: '校园系统绑定管理（当前仅校园卡 OPENID 通道可用）、校园能力清单按「未登录 / 待绑定 / 本阶段不提供」分别引导，以及同学共建 + 人工核对的服务目录。',
  },

  // ---- 高敏模块（二次同意门在数据加载之前） ----
  wellbeing: {
    stage: 'miniapp',
    note: '倾听与预约入口：危机热线在首屏（接口失败也有兜底号码）、二次同意门在**加载数据之前**；只做倾听与预约，不做诊断、不做治疗，不接分享与举报。',
  },
  'ai-portrait': {
    stage: 'miniapp',
    note: '只读画像：每条标签都能查到来源，明确标注心理支持与宿舍矛盾**不参与**画像；后端暂无画像时给空态，不在客户端编造标签。',
  },

  facility: {
    stage: 'miniapp',
    note: '场馆预约：列表 / 发起 / 详情三页，取消走领域动作 POST /items/:id/cancel；时段冲突由服务端判定。',
  },

  // ---- Web + 小程序都已上线 ----
  groupbuy: {
    stage: 'web',
    webHref: '/groupbuy',
    note: '拼单列表与详情（Web 垂直切片），小程序端同步可用。',
  },
};

/** 未登记模块的兜底：只有接口 */
export const DEFAULT_DELIVERY: ModuleDelivery = { stage: 'api-only' };

export function deliveryOf(id: string): ModuleDelivery {
  return DELIVERY[id] ?? DEFAULT_DELIVERY;
}

export function deliveryStageLabel(stage: DeliveryStage): string {
  switch (stage) {
    case 'web':
      return 'Web 已上线';
    case 'miniapp':
      return '小程序已上线';
    case 'api-only':
      return '接口就绪';
  }
}

/** 端上是否已经能真的用（Web 或小程序任一端上线） */
export function isDelivered(delivery: ModuleDelivery): boolean {
  return delivery.stage !== 'api-only';
}
