/**
 * 群机器人接入 · wire 契约
 *
 * 与后端 `services/api/src/modules/group-bot/` 对应。
 *
 * ## 为什么"草稿"而不是"直接发布"
 * 群消息里的信息可能不准确、已过期、或不是发布者本人想转载到平台。
 * 机器人只把消息落成**待确认草稿**，由管理员校验后一键发布 ——
 * 这样既拿到效率，又保留"人对内容负责"这一环。
 */

export const GROUP_BOT_PLATFORMS = ['qq', 'wecom'] as const;
export type GroupBotPlatform = (typeof GROUP_BOT_PLATFORMS)[number];

export const GROUP_BOT_PLATFORM_LABELS: Readonly<Record<GroupBotPlatform, string>> = {
  qq: 'QQ 群机器人',
  wecom: '企业微信智能机器人',
};

/** 草稿状态机：pending → approved / rejected（单向） */
export const GROUP_DRAFT_STATUSES = ['pending', 'approved', 'rejected'] as const;
export type GroupDraftStatus = (typeof GROUP_DRAFT_STATUSES)[number];

export const GROUP_DRAFT_STATUS_LABELS: Readonly<Record<GroupDraftStatus, string>> = {
  pending: '待确认',
  approved: '已发布',
  rejected: '已忽略',
};

/** 一条待确认草稿（wire） */
export interface GroupDraftWire {
  readonly id: string;
  readonly platform: GroupBotPlatform;
  /** 群标识（平台的 OpenID，不是群号） */
  readonly groupId: string;
  /** 原始消息文本 —— **不脱敏**，管理员要看到原文才能判断 */
  readonly rawText: string;
  /** 解析出的候选项（见 `packages/shared/src/group-import.ts`） */
  readonly candidates: readonly GroupDraftCandidateWire[];
  readonly status: GroupDraftStatus;
  /** 平台消息 id（用于去重） */
  readonly platformMessageId: string;
  readonly receivedAt: string;
  readonly decidedAt: string | null;
  /** 处理备注（谁、为什么忽略） */
  readonly decisionNote: string | null;
}

/** 草稿里的一条候选项（与 shared 的解析结果同构，但只保留 wire 需要的字段） */
export interface GroupDraftCandidateWire {
  readonly kind: string;
  readonly title: string;
  readonly priceFen: number | null;
  readonly contact: string | null;
  readonly location: string | null;
  readonly confidence: number;
  readonly evidence: readonly { readonly field: string; readonly reason: string }[];
}

/** 分页 */
export interface GroupDraftPage {
  readonly items: readonly GroupDraftWire[];
  readonly nextCursor: string | null;
}

/** 环境变量名（集中声明，避免各处硬编码字符串） */
export const GROUP_BOT_ENV = {
  /** QQ 开放平台给的 Ed25519 公钥（hex）。未配置时 webhook 一律拒绝（fail closed） */
  qqPublicKey: 'GROUP_BOT_QQ_PUBLIC_KEY',
  /** 是否启用（默认关 —— 接入是显式动作，不是默认行为） */
  enabled: 'GROUP_BOT_ENABLED',
} as const;
