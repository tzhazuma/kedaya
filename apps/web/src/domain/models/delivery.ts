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
 * 现状（2026-10）：
 *   · Web 门户：拼单切片 + 管理后台；
 *   · 微信小程序：账号体系（注册/登录/改密/找回）+ 拼单 + 跳蚤 + 跑腿 + 找搭子 +
 *     失物招领 + 论坛 + 宿舍矛盾（匿名）+ 我的；
 *   · 其余模块：后端已挂 `/api/v1/<route>/items`（脚手架级 CRUD），端上页面待做。
 */
const DELIVERY: Readonly<Record<string, ModuleDelivery>> = {
  // ---- 小程序已上线（含后端真实逻辑） ----
  auth: {
    stage: 'miniapp',
    note: '邮箱 + 密码账号体系：注册（邮箱验证码）、登录、忘记密码、修改密码；令牌可撤销轮换，连续失败会锁定。',
  },
  profile: {
    stage: 'miniapp',
    note: '我的：账号状态、隐私与合规说明、敏感模块的同意记录与撤回。',
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
