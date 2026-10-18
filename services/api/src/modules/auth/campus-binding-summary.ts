/**
 * `/auth/campus-bindings` 的 wire 类型与投影（契约 §11.19-C / §11.20-A / §11.20-C）
 *
 * ## 为什么这个文件存在
 *
 * 仓库里同时存在**两个**"绑定"的 wire 形状，它们**刻意不同名不同形**：
 *
 * | 端点 | 元素类型 | 平台字段名 | 值的枚举 |
 * | --- | --- | --- | --- |
 * | `/techpie/links` | `TechpieLink` | `provider` | §11.20-C 统一枚举 |
 * | `/auth/campus-bindings` | `CampusBindingSummary`（本文件） | `platform` | §11.20-C 统一枚举 |
 *
 * §11.19-C 的裁决理由：同名两形状是**最坏的一类契约缺陷** ——
 * 实现者会按名字去猜，猜错不报错、只静默错。因此：
 *   · `/auth/*` 面向"登录态"的绑定**状态摘要**用 `CampusBindingSummary`；
 *   · `/techpie/*` 面向"可管理的绑定资源"用 `TechpieLink`（有 id、可解绑、可续期）。
 *
 * ## 两个形状的**唯一真相是同一张表**
 *
 * 两者都投影自 `TechpieLink` 表（techpie 的 `CAMPUS_SESSION_PORT`）。
 * 合并两条分支时，`/auth/campus-bindings` 一度还留着**另一套**实现
 * （auth 自己的大写 `CampusPlatform` + `CampusBinding` 表），于是：
 *   · GET 读到了另一张表（内存夹具里连表都没有 → 500）；
 *   · POST 不经过 §11.20 的平台闸门（`cpdaily` 得到 400 而不是 403 `PHASE_BLOCKED`）。
 * 这两条由 `test/techpie-http.spec.ts` 的「§11.19-C」与「Phase 1+ 的绑定被拒绝」用例钉死。
 *
 * ## 可空字段：为空时**省略键**，不下发 `null`（§11.22-D）
 *
 * `expiresAt` 在 Phase 0 的 OPENID 通道下没有值，因此它**不出现**。
 * `lastRenewedAt`（冻结 OpenAPI 里的字段）**本轮刻意不下发**：
 * Phase 0 的上游没有续期能力（`CampusSessionPort.renew` 直接抛
 * `RENEW_NOT_SUPPORTED`），编一个时间等于谎称"已续期"（失败模式 F3）。
 */

import {
  isActiveLinkStatus,
  type CampusBindingState,
} from '../techpie/domain/ports/campus-session.port';

/**
 * 绑定状态摘要（**wire 类型**，契约 §11.19-C）。
 *
 * ⚠️ 字段名是 `platform`（不是 `provider`）—— 与 `/techpie/links` 刻意区分。
 * 值的枚举是 §11.20-C 的统一枚举（小写），不是 auth 内部遗留的大写平台拼法。
 */
export interface CampusBindingSummary {
  /** §11.20-C 统一枚举：`cas | egate | cpdaily | jwc | ecard | techpie` */
  platform: CampusBindingState['provider'];
  /** 现在是否可用（状态 ACTIVE）。`false` = 绑定过但已过期/已撤销，或从未绑定 */
  bound: boolean;
  /** 授权到期时间（ISO，§11.22-D：为空则**整个键不出现**） */
  expiresAt?: string;
}

/** `CampusBindingState`（port 类型）→ `CampusBindingSummary`（wire 类型） */
export function toCampusBindingSummary(state: CampusBindingState): CampusBindingSummary {
  return {
    platform: state.provider,
    bound: isActiveLinkStatus(state.status),
    // §11.22-D：可空字段为空时省略键，而不是下发 `null`
    ...(state.expiresAt === null ? {} : { expiresAt: state.expiresAt }),
  };
}
