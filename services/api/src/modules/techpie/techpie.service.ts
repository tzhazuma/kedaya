/**
 * TechPie 整合 · 用例层（契约 §7：只编排，不含 IO）
 *
 * 规格 `docs/features/techpie-integration.md` §8.1（8 个端点）；
 * 裁决 `00-FROZEN-CONTRACT.md` §11.18。
 *
 * 依赖通过**显式 token** 注入（而非 `design:paramtypes`），
 * 这样在 vitest 等不做 `emitDecoratorMetadata` 的转译器下 DI 依然成立。
 *
 * ## 本服务不做的事（同样是设计）
 *
 * · **不**自己碰 cookie / session —— 唯一的出口是 `webview-session/`（不变式 I3）；
 * · **不**接受明文密码（U12）；**不**为需要 CASTGC 的平台建立任何绑定路径（U7）；
 * · **不**谎称续期成功（失败模式 F3）。
 */

import { Inject, Injectable } from '@nestjs/common';
import type { Page } from '@kedaya/contracts';
import {
  CampusBindingRequiredError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../common/errors/app-error';
import {
  TECHPIE_CAPABILITIES,
  buildCapabilities,
  type TechpieCapabilitiesResult,
} from './domain/capabilities';
import {
  CAMPUS_SESSION_PORT,
  isCampusPlatform,
  translateCampusSessionError,
  type BindCredential,
  type CampusBindingSummary,
  type CampusPlatform,
  type CampusSessionPort,
} from './domain/ports/campus-session.port';
import { WEBVIEW_ALLOWLIST_PORT, type WebviewAllowlistPort } from './domain/ports/webview-allowlist.port';
import {
  TECHPIE_LINK_REPOSITORY,
  TECHPIE_SYNC_JOB_REPOSITORY,
  toBindingSummary,
  type TechpieLinkModel,
  type TechpieLinkRepository,
  type TechpieListParams,
  type TechpieSyncJobModel,
  type TechpieSyncJobRepository,
} from './domain/techpie.domain';

/** `POST /techpie/links` 的输入（形状见控制器里的 Zod schema） */
export interface CreateLinkCommand {
  platform: unknown;
  credential: unknown;
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
   * `GET /techpie/links` —— 返回 `CampusBindingSummary[]`，**不含任何凭证**（规格 §8.3）。
   *
   * 游标分页（契约 §6.1）。投影统一走 domain 的 `toBindingSummary`
   * （逐字段挑选 + 运行时禁用键名断言），因此这里**结构上**不可能泄漏 `tokenCipher`。
   */
  async listLinks(userId: string, params: TechpieListParams): Promise<Page<CampusBindingSummary>> {
    const page = await this.links.listByUser(userId, params);
    return { items: page.items.map(toBindingSummary), nextCursor: page.nextCursor };
  }

  /** `GET /techpie/links/:id` —— 绑定详情。**非本人一律 404**（不泄漏"这个 id 存在"）。 */
  async getLink(userId: string, id: string): Promise<CampusBindingSummary> {
    return toBindingSummary(await this.requireOwnedLink(userId, id));
  }

  /* ---------------- 2. 发起绑定 ---------------- */

  /**
   * `POST /techpie/links` —— 发起绑定。
   *
   * Phase 0 **只接受 `ecard` + `openid`**（校园卡走独立 OPENID 通道，规格 §2.5）。
   * 其余组合由 `CampusSessionPort.bind` 拒绝，错误在这里翻译成契约错误码：
   *
   * | 端口原因 | HTTP | `code` | `details.reason` |
   * | --- | --- | --- | --- |
   * | `PHASE_BLOCKED` | 403 | `FORBIDDEN` | `PHASE_BLOCKED` |
   * | `PLAIN_PASSWORD_REFUSED` | 403 | `FORBIDDEN` | `PLAIN_PASSWORD_REFUSED` |
   * | `ALREADY_LINKED` | 409 | `CONFLICT` | `ALREADY_LINKED` |
   * | `INVALID_CREDENTIAL` | 409 | `CONFLICT` | `INVALID_CREDENTIAL` |
   */
  async createLink(userId: string, command: CreateLinkCommand): Promise<CampusBindingSummary> {
    const platform = this.parsePlatform(command.platform);
    const credential = this.parseCredential(command.credential);

    try {
      return await this.campusSession.bind(userId, platform, credential);
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
  async renewLink(userId: string, id: string): Promise<CampusBindingSummary> {
    const link = await this.requireOwnedLink(userId, id);
    try {
      return await this.campusSession.renew(userId, link.provider);
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
    const items = buildCapabilities(
      TECHPIE_CAPABILITIES,
      bindings.map((binding) => ({ platform: binding.platform, status: binding.status })),
    );

    return {
      items,
      // 与 `items` 同值的别名（冻结 OpenAPI 形状）—— 见 capabilities.ts 的说明
      capabilities: items,
      allowlistPlaceholder: this.allowlist.allowlistPlaceholder,
      unboundCount: items.filter((item) => item.status === 'CAMPUS_BINDING_REQUIRED').length,
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

  private parsePlatform(raw: unknown): CampusPlatform {
    // 兼容 `platform`（规格 §8.4 / 三端）与 `provider`（冻结 OpenAPI）两种写法
    const value = typeof raw === 'string' ? raw : undefined;
    if (!isCampusPlatform(value)) {
      throw new ValidationError('platform 不是受支持的校园平台', {
        reason: 'UNKNOWN_PLATFORM',
        supported: ['cas', 'egate', 'cpdaily', 'ecard', 'techpie'],
      });
    }
    return value;
  }

  /**
   * 解析绑定凭证。
   *
   * ⚠️ **明文密码在这里就被丢弃**：只把 `kind` 传下去，`studentId` / `password`
   * **一个字段都不读**、不进 details、不进日志（规格 §10.3）。
   * 真正的拒绝在 `CampusSessionPort.bind` 里（保持"拒绝逻辑只有一处"）。
   */
  private parseCredential(raw: unknown): BindCredential {
    if (raw === null || typeof raw !== 'object') {
      throw new ValidationError('credential 必须是对象', { reason: 'INVALID_CREDENTIAL' });
    }
    const record = raw as Record<string, unknown>;

    if (record.kind === 'password') {
      // 只传 kind：**不**从请求里读取 studentId / password，因此明文密码不会流进任何下游。
      return { kind: 'password', studentId: '', password: '' };
    }
    if (record.kind === 'openid') {
      const openId = typeof record.openId === 'string' ? record.openId : '';
      // `channel` 省略时默认 `wechat`（Phase 0 唯一支持的通道）；
      // 显式给了别的值才拒绝 —— 不把"没写"当成"写错了"。
      const channel = record.channel === undefined || record.channel === null ? 'wechat' : record.channel;
      if (channel !== 'wechat') {
        throw new ValidationError('OPENID 凭证的 channel 必须是 wechat（Phase 0 唯一支持的通道）', {
          reason: 'INVALID_CREDENTIAL',
          channel,
        });
      }
      return { kind: 'openid', channel: 'wechat', openId };
    }
    throw new ValidationError('credential.kind 必须是 openid（Phase 0 唯一支持的通道）', {
      reason: 'INVALID_CREDENTIAL',
    });
  }
}

/** 未绑定时的错误（供其他模块复用 —— 契约 §5 硬规则 3 / 不变式 I4） */
export function bindingRequired(platform: CampusPlatform): CampusBindingRequiredError {
  return new CampusBindingRequiredError(`请先绑定校园系统（${platform}）后再使用该功能`, { platform });
}
