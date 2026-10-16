/**
 * 找搭子 · 列表游标（规格 §5.9，验收 T20）
 *
 * ## 契约冲突（规格 U3，必须显式记录）
 *
 * 契约 `api-contract §3.1` 说"cursor 就是上一页最后一条的 ULID"。
 * 那个假设成立的前提是**列表按 createdAt 排序**。规格 §5.3 还想要
 * `sort=startsAt_asc`（组队场景下"什么时候"比"什么时候发的"重要），
 * 而 `startsAt` 的顺序与 id 的顺序**不一致** —— 用 `id < cursor` 会**跳条**。
 *
 * 规格 §5.9 给的裁决建议是"推荐后者（强制 createdAt_desc）"，
 * 但那会丢掉 `startsAt_asc` 这个对组队真正有用的排序。
 *
 * **本实现的取舍**（记入交付说明，需 Lead 确认）：
 *
 * | sort | 游标 | 是否偏离契约 §3.1 |
 * | --- | --- | --- |
 * | `createdAt_desc`（**默认**） | 不透明 base64url(id)，复用 `common/pagination/cursor.ts` | 否，逐字符合 |
 * | `startsAt_asc` | 不透明 base64url(`${startsAt.toISOString()}|${id}`) | **是**，复合游标 |
 *
 * 两个游标都是**不透明**的（客户端不该解析），且都严格校验
 * （重新编码后必须与原文一致），因此"复合游标"对客户端而言与单键游标无差别 ——
 * 这也是把偏离控制在最小面的方式。
 */

import { ValidationError } from '../../../common/errors/app-error';

const SEPARATOR = '|';

export interface PostCursor {
  startsAt: Date;
  id: string;
}

/** 复合游标：`base64url(<ISO 时间>|<id>)` */
export function encodePostCursor(startsAt: Date, id: string): string {
  return Buffer.from(`${startsAt.toISOString()}${SEPARATOR}${id}`, 'utf8').toString('base64url');
}

/**
 * 解码复合游标。垃圾输入抛 `VALIDATION_FAILED`（不是静默取第一页 ——
 * 静默会让"翻页翻不动"表现成"数据丢了"）。
 */
export function decodePostCursor(cursor?: string | null): PostCursor | undefined {
  if (cursor === undefined || cursor === null || cursor === '') return undefined;

  let decoded: string;
  try {
    decoded = Buffer.from(cursor, 'base64url').toString('utf8');
  } catch {
    throw new ValidationError('cursor 不是合法的分页游标');
  }

  // 严格性：必须能原样重编码回去（base64url 解码对垃圾输入是宽容的）
  if (decoded.length === 0 || Buffer.from(decoded, 'utf8').toString('base64url') !== cursor) {
    throw new ValidationError('cursor 不是合法的分页游标');
  }

  // 用**第一个**分隔符切分：ISO 时间串里不可能出现 `|`，而 id 理论上有这个可能
  // （cuid/ULID 不会有，但用 firstIndexOf 更不容易在未来被误伤）。
  const index = decoded.indexOf(SEPARATOR);
  if (index <= 0 || index === decoded.length - 1) {
    throw new ValidationError('cursor 不是合法的分页游标');
  }

  const iso = decoded.slice(0, index);
  const id = decoded.slice(index + 1);
  const startsAt = new Date(iso);
  if (Number.isNaN(startsAt.getTime())) {
    throw new ValidationError('cursor 里的时间不是合法 ISO 时间');
  }

  return { startsAt, id };
}
