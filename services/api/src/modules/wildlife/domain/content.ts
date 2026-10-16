/**
 * wildlife · 备注内容安全与伦理确认（规格 §8.2 / §10.3）
 *
 * ## 伦理勾选**不是**同意门（规格 §8.2，必须说清，否则会被误实现）
 *
 * | | 同意门 | 这里的勾选 |
 * | --- | --- | --- |
 * | 性质 | 独立授权状态，可撤回 | **单次表单的操作确认** |
 * | 缺失后果 | **整个模块不可用**（`CONSENT_REQUIRED`） | **该次提交被拒**（`VALIDATION_FAILED`） |
 * | 是否影响浏览 | 是 | **否** —— 浏览地图/区域/他人上报完全不受影响 |
 *
 * 契约 §9 的同意门只适用于 `wellbeing` / `dorm-harmony` / `ai-portrait`。
 * **`wildlife` 不在此列，不得引入 `CONSENT_REQUIRED`。**
 */
import { ValidationError } from '../../../common/errors/app-error';

/** 备注长度上限（规格 §2.6：`note` ≤200 字） */
export const NOTE_MAX_LENGTH = 200;
/** 审核拒绝原因长度上限（规格 §2.6：≤200 字） */
export const REJECT_REASON_MAX_LENGTH = 200;

/** 逗号分隔的关键词白名单 → 去空去重。**代码里不硬编码词库**（词表由运维配置） */
export function parseKeywordList(raw: string | undefined | null): string[] {
  if (!raw) return [];
  return [...new Set(raw.split(',').map((item) => item.trim()).filter(Boolean))];
}

/** 命中第一个违禁词（大小写不敏感）；未命中返回 null */
export function findBannedKeyword(text: string | null | undefined, keywords: readonly string[]): string | null {
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const keyword of keywords) {
    if (keyword && lower.includes(keyword.toLowerCase())) return keyword;
  }
  return null;
}

/** 备注校验：长度 + 内容安全。命中违禁词 → `VALIDATION_FAILED` / `CONTENT_REJECTED` */
export function assertNoteAcceptable(
  note: string | null | undefined,
  bannedKeywords: readonly string[] = [],
): void {
  if (note === null || note === undefined) return;
  if (note.length > NOTE_MAX_LENGTH) {
    throw new ValidationError(`备注不能超过 ${NOTE_MAX_LENGTH} 字`, {
      reason: 'NOTE_TOO_LONG',
      maxLength: NOTE_MAX_LENGTH,
    });
  }
  const hit = findBannedKeyword(note, bannedKeywords);
  if (hit) {
    throw new ValidationError('备注包含不被允许的内容', { reason: 'CONTENT_REJECTED' });
  }
}

/**
 * 伦理确认校验（规格 §10.3）。
 *
 * 缺它 → 该次提交被拒（`VALIDATION_FAILED` / `ETHICS_NOT_ACKNOWLEDGED`），
 * **但浏览不受任何影响**。
 */
export function assertEthicsAcknowledged(acknowledged: unknown): void {
  if (acknowledged !== true) {
    throw new ValidationError('请先阅读并勾选动物保护与投喂规范提示', {
      reason: 'ETHICS_NOT_ACKNOWLEDGED',
    });
  }
}

/**
 * 伦理提示文案（规格 §8.2：≤5 条，每条 ≤20 字）。
 *
 * E1–E8 的精简版。**不做同意门**：位置在上报表单提交按钮上方，
 * 勾选即可提交；同一用户只提示一次。
 */
export const ETHICS_HIGHLIGHTS: readonly string[] = [
  '禁止投喂人类食物',
  '禁止追撵、捕捉、触摸',
  '禁止闪光灯拍夜行动物',
  '禁止公开巢穴与育雏位置',
  '发现受伤动物请勿自行处理',
];
