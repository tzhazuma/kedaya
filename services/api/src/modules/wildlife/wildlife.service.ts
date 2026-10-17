/**
 * 猫鸟黑天鹅 · wildlife（契约 §4）
 *
 * 本文件由 scripts/scaffold.mjs 生成；要改形状请改脚本里的 SPEC 表，
 * 改完重跑 `npm run scaffold`，避免 15 个模块各写一套。
 */
import { Inject, Injectable } from '@nestjs/common';
import type { Page } from '@kedaya/contracts';
import { CrudService } from '../../common/crud/crud.service';
import type { ListParams } from '../../common/crud/resource';
import {} from '../../common/errors/app-error';
import {
  WILDLIFE_SPOT_REPOSITORY,
  type CreateWildlifeSpotInput,
  type WildlifeSpotModel,
  type WildlifeSpotRepository,
  type UpdateWildlifeSpotInput,
} from './domain/wildlife.domain';

/**
 * 用例层（契约 §7）：只编排，不含 IO。
 * 依赖通过**显式 token** 注入（而非 design:paramtypes），
 * 这样在 vitest 等不做 emitDecoratorMetadata 的转译器下 DI 依然成立。
 */
@Injectable()
export class WildlifeSpotService extends CrudService<WildlifeSpotModel, CreateWildlifeSpotInput, UpdateWildlifeSpotInput> {
  constructor(
    @Inject(WILDLIFE_SPOT_REPOSITORY) private readonly repo: WildlifeSpotRepository,
  ) {
    super(repo, 'wildlife', '猫鸟黑天鹅');
  }

  /**
   * 列表：**原样透传** `params`（含 `filters`）。
   *
   * 为什么这里看起来"什么都没做"却是刻意的：
   *   · 可筛什么由 controller 的 Zod 白名单决定，怎么翻译成 SQL 由 data 层的
   *     `buildWhere` 决定 —— service 一加工，白名单就形同虚设（有人会顺手
   *     `{ [key]: value }` 铺开整个 filters），而且模块之间必然漂移；
   *   · 显式覆写而不是直接继承，是为了让"service 不碰筛选"这件事在代码里可见，
   *     下一个改这个模块的人不会以为"只是漏写了加工"。
   */
  override list(params: ListParams): Promise<Page<WildlifeSpotModel>> {
    return super.list(params);
  }

  /** 本模块支持匿名，忽略请求主体（契约 §9：匿名与实名解耦） */
  override async create(input: CreateWildlifeSpotInput, _actorId?: string): Promise<WildlifeSpotModel> {
    return super.create(input);
  }

  /**
   * 领域动作：确认为有效活动点（契约 §6.1 的 `POST /items/:id/confirm`）。
   *
   * 语义是**改状态**（`status = 'confirmed'`），不是「+1 计数」：
   *   · 先 `detail()` 再写 —— 不存在的 id 统一 NotFoundError，与 CRUD 的语义一致；
   *   · 幂等：已经是 confirmed 时再点一次仍然返回同一实体，**不报 CONFLICT**。
   *     这是"它不是个人投票"的直接后果 —— 状态是全校共享的一个字段，
   *     因此客户端只能靠 `status` 判断按钮态，而不是靠"我点过没有"；
   *   · 不校验主体：观察点是大家共建的公共信息，确认不需要登录
   *     （本控制器只有类级别的 `OptionalAuthGuard`）。
   */
  async confirm(id: string): Promise<WildlifeSpotModel> {
    await this.detail(id);
    return this.repo.update(id, { status: 'confirmed' });
  }
}
