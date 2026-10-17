/**
 * TechPie 整合 · techpie（契约 §4）
 *
 * 本文件由 scripts/scaffold.mjs 生成；要改形状请改脚本里的 SPEC 表，
 * 改完重跑 `npm run scaffold`，避免 15 个模块各写一套。
 *
 * ── 本轮手工增量（与脚手架不同，改 SPEC 时需一并同步）───────────────
 *   · `TechpieLinkModel` 补回 `id`：脚手架漏了它，而列表 / 详情 / 游标分页
 *     和客户端的详情跳转全靠它（与 `canteen.domain.ts` 是同一处修正）；
 *   · `TechpieLinkListFilters`：列表的两个筛选维度（`category` 精确 / `q` 模糊）；
 *   · `TECHPIE_SYNCED_STATUS`：`sync` 领域动作写入的唯一字面量，收敛魔法字符串。
 *
 * ⚠️ 注意：`docs/architecture/02-domain-model.md` §2.9 里那张 `TechpieLink`
 * 字段表（provider / tokenCipher / lastSyncAt…）是**对接对方系统**的设想形态，
 * 与当前落库的表**不是一回事**。真实表就是下面这几个字段（key/name/category/
 * url/status），真正的「整合」要等 GeekPie 侧给出协议与凭据，本轮不做。
 */
import type { ResourceRepository } from '../../../common/crud/resource';

/** 领域模型：字段与 Prisma 行字段一一对应（domain 层不 import Prisma） */
export interface TechpieLinkModel {
  /**
   * 主键。脚手架生成的模型漏了它，但列表返回的 Prisma 行**总是**带 id：
   * 详情页、分享落地路径与游标分页都靠它，缺了它这个模块不可用。
   */
  id: string;
  /** 稳定唯一标识（后端唯一索引）。客户端把它当技术标识自动生成，不展示给用户 */
  key: string;
  /** 服务名称（列表卡片主文案，例如「教务系统」） */
  name: string;
  /** 分类短码；白名单在客户端（`TECHPIE_CATEGORIES`），服务端只当自由字符串存 */
  category: string;
  /** 服务地址（http(s) 外链） */
  url: string;
  /** 状态：Prisma 默认 `active`，`sync` 动作写 `synced`，其余按未知处理 */
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

/** 创建输入。本模块支持匿名（无必填归属字段），实名身份与匿名 handle 解耦存储（契约 §9）。 */
export interface CreateTechpieLinkInput {
  key: string;
  name: string;
  category: string;
  url: string;
  status?: string;
}

/** 更新输入（全部可选） */
export interface UpdateTechpieLinkInput {
  key?: string;
  name?: string;
  category?: string;
  url?: string;
  status?: string;
}

/**
 * 列表筛选条件（controller 用 Zod 白名单校验后组装 → service 原样透传 →
 * data 层显式翻译成 Prisma `where`）。
 *
 * 刻意用 `type` 而不是 `interface`：类型别名带隐式索引签名，可直接赋给
 * `ListParams['filters']` 的 `Record<string, string | number | boolean | undefined>`。
 *
 * ⚠️ 这里**没有** `description` 维度：Prisma 的 `TechpieLink` 没有说明列
 * （见文件头）。`q` 因此覆盖 `name` + `url` 两个真实存在的文本列，
 * 而不是假装有一个说明字段。
 */
export type TechpieLinkListFilters = {
  /** 分类短码，精确匹配 */
  category?: string;
  /** 关键词：服务名 / 地址的 `contains` 模糊匹配（不区分大小写） */
  q?: string;
};

/**
 * `sync` 写入的状态字面量。
 *
 * ⚠️ 它的真实语义见 `techpie.service.ts`：**不是**去对端拉数据，
 * 只是把 status 这一列改成这个字符串。客户端把它读作「人工核对过」，
 * 因为这里确实没有任何自动化同步发生 —— 名字叫 synced，行为是打标记。
 */
export const TECHPIE_SYNCED_STATUS = 'synced';

/** 端口：service 只依赖本类型，实现见 data/techpie.repository.ts */
export type TechpieLinkRepository = ResourceRepository<
  TechpieLinkModel,
  CreateTechpieLinkInput,
  UpdateTechpieLinkInput
>;

export const TECHPIE_LINK_REPOSITORY = Symbol('KEDAYA_TECHPIE_LINK_REPOSITORY');
