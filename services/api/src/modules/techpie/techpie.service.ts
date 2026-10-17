/**
 * TechPie 整合 · techpie（契约 §4）
 *
 * 本文件由 scripts/scaffold.mjs 生成；要改形状请改脚本里的 SPEC 表，
 * 改完重跑 `npm run scaffold`，避免 15 个模块各写一套。
 *
 * ── 本轮手工增量 ──────────────────────────────────────────────────
 *   · `list` 显式覆写为「原样透传」；
 *   · `sync` 的真实语义被写清楚（它**不是**去对端同步，见下）。
 */
import { Inject, Injectable } from '@nestjs/common';
import type { Page } from '@kedaya/contracts';
import { CrudService } from '../../common/crud/crud.service';
import type { ListParams } from '../../common/crud/resource';
import {
  TECHPIE_LINK_REPOSITORY,
  TECHPIE_SYNCED_STATUS,
  type CreateTechpieLinkInput,
  type TechpieLinkModel,
  type TechpieLinkRepository,
  type UpdateTechpieLinkInput,
} from './domain/techpie.domain';

/**
 * 用例层（契约 §7）：只编排，不含 IO。
 * 依赖通过**显式 token** 注入（而非 design:paramtypes），
 * 这样在 vitest 等不做 emitDecoratorMetadata 的转译器下 DI 依然成立。
 */
@Injectable()
export class TechpieLinkService extends CrudService<TechpieLinkModel, CreateTechpieLinkInput, UpdateTechpieLinkInput> {
  constructor(
    @Inject(TECHPIE_LINK_REPOSITORY) private readonly repo: TechpieLinkRepository,
  ) {
    super(repo, 'techpie', 'TechPie 整合');
  }

  /**
   * 列表：把 controller 组装好的 `filters`（`category` 精确 / `q` 模糊）**原样**透传。
   *
   * 基类本就透传整个 `ListParams`，这里显式覆写是把这条契约固定下来：
   * 以后若有人想在 service 层"顺手过滤"，必须先看到这段注释 ——
   * 能筛什么由 controller 的 Zod 白名单决定，怎么翻成 SQL 由 data 层的
   * `buildWhere` 决定，service 一加工白名单就形同虚设。
   */
  override list(params: ListParams): Promise<Page<TechpieLinkModel>> {
    return super.list(params);
  }

  /** 本模块支持匿名，忽略请求主体（契约 §9：匿名与实名解耦） */
  override async create(input: CreateTechpieLinkInput, _actorId?: string): Promise<TechpieLinkModel> {
    return super.create(input);
  }

  /**
   * 领域动作：`POST /items/:id/sync`。
   *
   * ## 它的**真实**语义（必须读清楚，不要在页面 / 文档里说成别的）
   *
   * 现状是：**不去对端拉任何数据**。整个方法只有一次 `update`，把 `status`
   * 这一列写成字面量 `'synced'`。
   *   · 不涉及 GeekPie / TechPie 的接口，没有 token、没有网络请求、没有同步任务；
   *   · 不记录"谁核对的"（本模块匿名，没有归属字段），因此重复调用是**幂等**的
   *     —— 已经是 `synced` 再点一次不报冲突，只是又写一次同样的值；
   *   · 唯一的副作用是 Prisma 的 `@updatedAt` 会把 `updatedAt` 推进到当下，
   *     客户端正是把它当作「最后核对时间」展示（见小程序端 `domain/models/techpie.ts`）。
   *
   * 所以客户端把 `synced` 读作「人工核对过」（而不是「已与系统同步」）——
   * 在没有真实上游的前提下，「已同步」才是会骗人的那个说法。
   * 等 GeekPie 侧给出协议与凭据，再在这里接真正的同步任务（或另开一个动作）。
   *
   * 先 `detail()` 再写：不存在的 id 统一 `NotFoundError`，与 CRUD 的语义一致。
   */
  async sync(id: string): Promise<TechpieLinkModel> {
    await this.detail(id);
    return this.repo.update(id, { status: TECHPIE_SYNCED_STATUS });
  }
}
