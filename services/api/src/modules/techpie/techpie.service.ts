/**
 * TechPie 整合 · 用例层（契约 §7：只编排，不含 IO）
 *
 * 规格 `docs/features/techpie-integration.md` §8.1（8 个端点）；
 * 裁决 `00-FROZEN-CONTRACT.md` §11.18 / §11.19 / §11.20 / §11.21 / §11.22。
 *
 * 依赖通过**显式 token** 注入（而非 `design:paramtypes`），
 * 这样在 vitest 等不做 emitDecoratorMetadata 的转译器下 DI 依然成立。
 *
 * ## 本服务不做的事（同样是设计）
 *
 * · **不**自己碰 cookie / session —— 唯一的出口是 `webview-session/`（不变式 I3）；
 * · **不**接受明文密码（U12）；**不**为需要 CASTGC 的平台建立任何绑定路径（U7）；
 * · **不**谎称续期成功（失败模式 F3）。
 *
 * ## 本轮收敛（§11.20-E 的原话：后端需按 §11.20 收敛）
 *
 * · `/techpie/links` 的元素是 **`TechpieLink`**（`provider` + `PENDING|ACTIVE|EXPIRED|REVOKED|FAILED`）；
 * · `/capabilities` **只返回 `capabilities`**（删掉同值的 `items` 别名）；
 * · 能力条目**只保留单一键名**（`key` / `nameZh` / `phase` / `available` /
 *   `requiredProvider` / `blockedReason` + 非别名的结构性字段）。
 */

import { Inject, Injectable } from '@nestjs/common';
import type { Page } from '@kedaya/contracts';
import {
  CampusBindingRequiredError,
  NotFoundError,
  ValidationError,
} from '../../common/errors/app-error';
import {
  TECHPIE_CAPABILITIES,
  buildCapabilities,
  countUnbound,
  type TechpieCapabilitiesResult,
} from './domain/capabilities';
import {
  CAMPUS_SESSION_PORT,
  isCampusPlatform,
  translateCampusSessionError,
  type BindCredential,
  type CampusPlatform,
  type CampusSessionPort,
} from './domain/ports/campus-session.port';
import { WEBVIEW_ALLOWLIST_PORT, type WebviewAllowlistPort } from './domain/ports/webview-allowlist.port';
import {
  TECHPIE_LINK_REPOSITORY,
  TECHPIE_SYNC_JOB_REPOSITORY,
  toTechpieLinkFromBindingState, toTechpieLinkFromModel,
  type TechpieLink,
  type TechpieLinkModel,
  type TechpieLinkRepository,
  type TechpieListParams,
  type TechpieSyncJobModel,
  type TechpieSyncJobRepository,
} from './domain/techpie.domain';

/**
 * `POST /techpie/links` 的输入（形状见控制器里的 Zod schema）。
 *
 * ⚠️ 契约 §11.19-B：字段是 **`authCode`**（一次性凭证交换码），**不是** `openid`。
 * 契约 §11.20-D：**没有** `platform` / `credential` 等兼容别名 —— 一个概念一个名字。
 */
export interface CreateLinkCommand {
  provider: unknown;
  authCode: unknown;
}

@Injectable()
export class TechpieService {
  constructor(
    @Inject(TECHPIE_LINK_REPOSITORY) private readonly links: TechpieLinkRepository,
    @Inject(TECHPIE_SYNC_JOB_REPOSITORY) private readonly jobs: TechpieSyncJobRepository,
    @Inject(CAMPUS_SESSION_PORT) private readonly campusSession: CampusSessionPort,
    @Inject(WEBVIEW_ALLOWLIST_PORT) private readonly allowlist: WebviewAllowlistPort,
  ) {}

  /* ---------------- 1/3. 绑定列表与详情 ---------------- */

  /**
   * `GET /techpie/links` —— 返回 `TechpieLink[]`，**不含任何凭证**（规格 §8.3）。
   *
   * 游标分页（契约 §6.1）。投影统一走 domain 的 `toTechpieLink`
   * （逐字段挑选），因此这里**结构上**不可能泄漏 `tokenCipher` / `externalUserId`。
   */
  async listLinks(userId: string, params: TechpieListParams): Promise<Page<TechpieLink>> {
    const page = await this.links.listByUser(userId, params);
    return { items: page.items.map(toTechpieLinkFromModel), nextCursor: page.nextCursor };
  }

  /** `GET /techpie/links/:id` —— 绑定详情。**非本人一律 404**（不泄漏"这个 id 存在"）。 */
  async getLink(userId: string, id: string): Promise<TechpieLink> {
    return toTechpieLinkFromModel(await this.requireOwnedLink(userId, id));
  }

  /* ---------------- 2. 发起绑定 ---------------- */

  /**
   * `POST /techpie/links` —— 发起绑定。
   *
   * Phase 0 **只接受 `ecard` + `authCode`**（校园卡走独立 OPENID 通道，规格 §2.5）。
   * 其余组合由 `CampusSessionPort.bind` 拒绝，错误在这里翻译成契约错误码：
   *
   * | 端口原因 | HTTP | `code` | `details.reason` |
   * | --- | --- | --- | --- |
   * | `PHASE_BLOCKED` | 403 | `FORBIDDEN` | `PHASE_BLOCKED` |
   * | `PLAIN_PASSWORD_REFUSED` | 403 | `FORBIDDEN` | `PLAIN_PASSWORD_REFUSED` |
   * | `ALREADY_LINKED` | 409 | `CONFLICT` | `ALREADY_LINKED` |
   * | `INVALID_CREDENTIAL` | 409 | `CONFLICT` | `INVALID_CREDENTIAL` |
   */
  async createLink(userId: string, command: CreateLinkCommand): Promise<TechpieLink> {
    const provider = this.parseProvider(command.provider);
    const credential = this.parseCredential(command.authCode);

    try {
      return toTechpieLinkFromBindingState(await this.campusSession.bind(userId, provider, credential));
    } catch (error) {
      throw translateCampusSessionError(error);
    }
  }

  /* ---------------- 4. 解绑 ---------------- */

  /**
   * `DELETE /techpie/links/:id` —— 解绑（承载契约 §11.2 的 `close` 语义）。
   *
   * 硬要求（冻结 OpenAPI 的原话）：**必须真正删除凭证副本**，
   * 而不只是把 link 标记为失效 —— 否则"解绑"只是让用户以为凭证没了。
   * 因此先 `CampusSessionPort.unbind`（硬删 `CampusSession` 行），再软删 link。
   */
  async deleteLink(userId: string, id: string): Promise<{ id: string; deleted: true }> {
    const link = await this.requireOwnedLink(userId, id);
    await this.campusSession.unbind(userId, link.provider);
    // `unbind` 已经把 link 标成 REVOKED + 软删；这里只在它没覆盖到的情况下兜底。
    const after = await this.links.findById(id);
    if (after && !after.deletedAt) await this.links.softDelete(id);
    return { id, deleted: true };
  }

  /* ---------------- 5. 手动续期（契约 §11.2 冻结 action） ---------------- */

  /**
   * `POST /techpie/links/:id/renew` —— 手动续期。
   *
   * Phase 0 下上游**没有**续期能力（规格 §6.3 R4 / U8），因此这里**如实报错**：
   * `409 CONFLICT` + `details.reason = 'RENEW_NOT_SUPPORTED'`。
   * **绝不谎称"已续期"**（失败模式 F3）。
   */
  async renewLink(userId: string, id: string): Promise<TechpieLink> {
    const link = await this.requireOwnedLink(userId, id);
    try {
      return toTechpieLinkFromBindingState(await this.campusSession.renew(userId, link.provider));
    } catch (error) {
      throw translateCampusSessionError(error);
    }
  }

  /* ---------------- 6. 能力清单 ---------------- */

  /**
   * `GET /techpie/capabilities` —— 当前用户可用的校园能力清单。
   *
   * **未绑定项不是错误**：它们返回能力条目 + `CAMPUS_BINDING_REQUIRED` 提示，
   * 客户端据此**引导用户去绑定**（契约 §5 硬规则 3、ADR §5.4、不变式 I4）。
   *
   * 纯本地计算（不调上游）—— 因此天然满足契约 §8"启动不被上游拖死"。
   */
  async capabilities(userId: string): Promise<TechpieCapabilitiesResult> {
    const bindings = await this.campusSession.listBindings(userId);
    const view = bindings.map((binding) => ({ provider: binding.provider, status: binding.status }));

    return {
      // ⚠️ 契约 §11.20-D：只有 `capabilities` 一个名字 —— 删掉了同值的 `items` 别名
      capabilities: buildCapabilities(TECHPIE_CAPABILITIES, view),
      allowlistPlaceholder: this.allowlist.allowlistPlaceholder,
      unboundCount: countUnbound(TECHPIE_CAPABILITIES, view),
    };
  }

  /* ---------------- 7. 同步任务 ---------------- */

  /** `GET /techpie/sync-jobs` —— 我的同步任务状态（游标分页）。 */
  async listSyncJobs(userId: string, params: TechpieListParams): Promise<Page<TechpieSyncJobModel>> {
    return this.jobs.listByUser(userId, params);
  }

  /* ---------------- 内部 ---------------- */

  /** 取一条**属于本人**且未软删的绑定；否则 404（不区分"不存在"与"不是你的"）。 */
  private async requireOwnedLink(userId: string, id: string): Promise<TechpieLinkModel> {
    const link = await this.links.findById(id);
    if (!link || link.userId !== userId || Boolean(link.deletedAt)) {
      throw new NotFoundError('绑定不存在或非本人');
    }
    return link;
  }

  /**
   * 解析 `provider`。
   *
   * ⚠️ 只接受**一个**键名（§11.20-D）：旧的 `platform` 兼容写法已删除 ——
   * 控制器 schema 用 `.strict()`，因此带 `platform` 的请求在**进入本函数之前**
   * 就已经是 `400 VALIDATION_FAILED`，而不是被静默忽略。
   */
  private parseProvider(raw: unknown): CampusPlatform {
    if (!isCampusPlatform(raw)) {
      throw new ValidationError('provider 不是受支持的校园平台', {
        reason: 'UNKNOWN_PLATFORM',
        supported: ['cas', 'egate', 'cpdaily', 'jwc', 'ecard', 'techpie'],
      });
    }
    return raw;
  }

  /**
   * 解析绑定凭证。
   *
   * ⚠️ 契约 §11.19-B：wire 上是 `authCode`（一次性交换码），**不是** `openid`。
   * ⚠️ 明文密码在 wire 上**根本没有位置**（`TechpieLinkCreate` 只有 `provider` + `authCode`），
   * 因此 U12 的拒绝是**结构性**的：请求里出现 `password` / `credential`
   * 会在 schema 的 `.strict()` 处直接失败，连**读**都不会读到。
   * 端口层仍保留 `password` 变体的拒绝逻辑（纵深防御，"拒绝逻辑只有一处"）。
   */
  private parseCredential(raw: unknown): BindCredential {
    if (typeof raw !== 'string' || raw.trim().length === 0) {
      throw new ValidationError('authCode 必须是非空字符串（wx.login() 的一次性 code）', {
        reason: 'INVALID_CREDENTIAL',
      });
    }
    // Phase 0 唯一支持的通道是 wechat（校园卡 OPENID 通道，规格 §2.5）。
    return { kind: 'openid', channel: 'wechat', authCode: raw.trim() };
  }
}

/** 未绑定时的错误（供其他模块复用 —— 契约 §5 硬规则 3 / 不变式 I4） */
export function bindingRequired(platform: CampusPlatform): CampusBindingRequiredError {
  return new CampusBindingRequiredError(`请先绑定校园系统（${platform}）后再使用该功能`, { platform });
}
