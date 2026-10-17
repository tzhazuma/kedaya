/**
 * 找搭子 · 权威标签表的读取用例（规格 §3.2，跨端 wire 缺口 1）
 *
 * ## 为什么需要这个端点
 *
 * 服务端的封闭标签表是**权威**：`assertKnownTags` 对表外的 key 抛
 * `UNKNOWN_TAG:<key>`，直接拒绝用户提交。但在本端点出现之前，
 * **没有任何端点让客户端拿到这张表** —— 小程序只能内置一份镜像，
 * 并在 `GET /buddy/tags` 404 时回落到镜像。
 *
 * 后果与 `packages/contracts/src/buddy-tags.ts` 文件头记录的是同一类缺陷：
 * 一旦镜像与服务端漂移，用户选到的标签会被服务端拒绝（`UNKNOWN_TAG`），
 * 而客户端在提交前无从得知。修复不是"让镜像更准"，而是**让服务端下发权威表**。
 *
 * ## 这里**没有**第二份标签表
 *
 * 表在 `@kedaya/contracts`（全仓唯一真相，由 `domain/tags.ts` re-export）。
 * 本文件只做一件事：把 `readonly` 的领域形状**投影**成 wire 形状
 * （可选字段补齐为显式值，让客户端不必再猜 `aliases` 缺失是什么意思）。
 *
 * ⚠️ 不要在这里写 `{ key: '...', label: '...' }` 字面量 ——
 * `packages/contracts/src/buddy-tags.test.ts` 有一条守卫测试专门扫这种副本，
 * 而漂移的代价是"用户提交被拒"这种用户可见故障。
 *
 * ## 为什么下发 `isActive` 而不是只下发 active 的子集
 *
 * 下架标签**不删除**（历史帖子仍然引用它，见 `BuddyTagDef` 的注释），
 * 所以客户端在渲染"历史活动详情"时需要能解释一个已下架的 key。
 * 把 `isActive` 一起下发，客户端就能自己决定"选择器只展示 active"
 * （等价于 `activeTags()`），而不用服务端替它丢掉信息。
 *
 * ## 为什么**一并**下发校园地点白名单
 *
 * 地点与标签是同一个文件里的两个命名空间，也踩过同一个坑：收敛前 Web 端
 * 自己维护 15 个**英文 slug**，服务端白名单是 25 个**中文名**，
 * 两者完全不相交 —— Web 用户选的任何地点都会被 `UNKNOWN_LOCATION` 拒。
 * 只下发标签而不下发地点，等于把同一个坑留给地点。所以这里一起给，
 * 并明确标注 **`label` 才是提交值**。
 */

import { Injectable } from '@nestjs/common';
import {
  BUDDY_TAGS,
  CAMPUS_LOCATION_DEFS,
  MAX_ACTIVITY_TAGS,
  MAX_INTEREST_TAGS,
  MAX_POST_TAGS,
  MAX_PREFERRED_AREAS,
  type BuddyTagGroup,
} from '../domain/tags';

/** wire 形状的单个标签：所有字段都**显式存在**（缺失 = 客户端要自己猜默认值） */
export interface BuddyTagView {
  key: string;
  label: string;
  group: BuddyTagGroup;
  /** 别名词表，**仅用于搜索**，不参与匹配（规格 §3.2）。无别名时是 `[]` 而非缺省 */
  aliases: string[];
  /** `false` = 已下架：不出现在选择器里，但历史数据仍可能引用 */
  isActive: boolean;
}

/** 数量上限（规格 §3.2）。客户端应当用它做**提交前**的本地校验，而不是提交后看 400 */
export interface BuddyTagLimitsView {
  maxInterestTags: number;
  maxActivityTags: number;
  maxPostTags: number;
  maxPreferredAreas: number;
}

/**
 * 校园地点的 wire 形状。
 *
 * ⚠️ **`label` 才是提交值（wire value）**，`key` 只是稳定的机器标识（埋点/i18n）。
 * 服务端 `assertKnownLocation` 校验的是**中文名**，所以客户端必须提交 `label`。
 *
 * 这**不是**可选的补充：收敛前 Web 端自己维护了 15 个英文 slug
 * （`gym`/`stadium`/`north-gate`…），与服务端白名单的 25 个中文名
 * **两个命名空间完全不相交** —— Web 用户选的任何地点都会被判为不在白名单。
 * 与标签漂移是同一类缺陷（用户提交被拒），根因同样是"没有唯一真相"。
 * 所以下发权威标签表时必须**一并下发地点表**，否则等于把同一个坑留着。
 */
export interface BuddyLocationView {
  key: string;
  label: string;
}

export interface BuddyTagsView {
  tags: BuddyTagView[];
  limits: BuddyTagLimitsView;
  locations: BuddyLocationView[];
}

@Injectable()
export class BuddyTagsService {
  /**
   * 权威标签表 + 数量上限 + 校园地点白名单。
   *
   * 纯投影、无 IO：同一进程内永远是同一份数据，因此不需要缓存，
   * 也不需要 `Idempotency-Key`（它是 `GET`）。
   */
  list(): BuddyTagsView {
    return {
      tags: BUDDY_TAGS.map((tag) => ({
        key: tag.key,
        label: tag.label,
        group: tag.group,
        aliases: [...(tag.aliases ?? [])],
        // 契约里 `isActive` 是可选字段且缺省表示"在架"（`activeTags()` 判的是 `!== false`），
        // 这里统一补齐成显式布尔值，避免三端各自解释 undefined。
        isActive: tag.isActive !== false,
      })),
      limits: {
        maxInterestTags: MAX_INTEREST_TAGS,
        maxActivityTags: MAX_ACTIVITY_TAGS,
        maxPostTags: MAX_POST_TAGS,
        maxPreferredAreas: MAX_PREFERRED_AREAS,
      },
      // 与标签同源（同一个 `@kedaya/contracts/src/buddy-tags.ts`）。
      // ⚠️ 仍然是**占位清单**（规格未决问题 U10 未关闭）—— 端点如实下发，
      // 不假装它已经过产品/运营确认（真实清单由 Lead + 运营替换）。
      locations: CAMPUS_LOCATION_DEFS.map((location) => ({
        key: location.key,
        label: location.label,
      })),
    };
  }
}
