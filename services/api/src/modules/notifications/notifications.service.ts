import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Page } from '@kedaya/contracts';
import { NotFoundError } from '../../common/errors/app-error';
import type { NotificationPort, NotifyInput } from '../../common/notifications/notification.port';
import {
  NOTIFICATION_BODY_MAX,
  NOTIFICATION_REPOSITORY,
  NOTIFICATION_SOURCES,
  NOTIFICATION_TITLE_MAX,
  type CreateNotificationInput,
  type NotificationModel,
  type NotificationRepository,
} from './domain/notifications.domain';

/**
 * 通知用例层（契约 §7：只编排，不含 IO）。
 *
 * 依赖通过**显式 token** 注入（而非 design:paramtypes），
 * 这样在 vitest 等不做 emitDecoratorMetadata 的转译器下 DI 依然成立。
 */
@Injectable()
export class NotificationService implements NotificationPort {
  private readonly logger = new Logger(NotificationService.name);

  constructor(@Inject(NOTIFICATION_REPOSITORY) private readonly repo: NotificationRepository) {}

  /**
   * 写通知（`NotificationPort` 的实现）。
   *
   * **best-effort**：任何异常都在这里被吞掉并记日志。
   * 这是刻意的设计取舍 —— 主流程（参团、接单、发帖）已经成功，
   * 不能因为通知写失败而让用户看到 500（用户会重试，产生重复业务数据）。
   *
   * 同时做**输入防御**：userId 为空、标题为空、source 拼错都直接丢弃并告警。
   * 原因：这些错误不会让请求失败，只会让用户永远收不到通知 ——
   * 不告警的话线上根本发现不了。
   */
  async notify(input: NotifyInput | readonly NotifyInput[]): Promise<void> {
    const list = Array.isArray(input) ? input : [input];
    const drafts = list
      .map((item) => this.toDraft(item))
      .filter((item): item is CreateNotificationInput => item !== null);
    if (drafts.length === 0) return;

    try {
      if (drafts.length === 1) {
        await this.repo.create(drafts[0] as CreateNotificationInput);
      } else {
        await this.repo.createMany(drafts);
      }
    } catch (error) {
      this.logger.warn(
        `写站内信失败（已忽略，不影响主流程）：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /** 我的通知（恒按当前登录用户收窄，不存在"看别人通知"的入口） */
  async list(
    userId: string,
    params: { cursor?: string; limit: number; unreadOnly: boolean },
  ): Promise<Page<NotificationModel>> {
    const page = await this.repo.list({
      userId,
      limit: params.limit,
      unreadOnly: params.unreadOnly,
      ...(params.cursor === undefined ? {} : { cursor: params.cursor }),
    });
    return { items: page.items, nextCursor: page.nextCursor };
  }

  unreadCount(userId: string): Promise<number> {
    return this.repo.unreadCount(userId);
  }

  /** 标记单条已读。不属于当前用户时按 404 处理（不透露"这条存在但不是你的"）。 */
  async markRead(userId: string, id: string): Promise<NotificationModel> {
    const updated = await this.repo.markRead(id, userId);
    if (!updated) throw new NotFoundError('通知不存在');
    return updated;
  }

  /** 全部已读，返回本次实际标记的条数（0 也是合法结果，前端无需特殊处理） */
  async markAllRead(userId: string): Promise<number> {
    return this.repo.markAllRead(userId);
  }

  /**
   * 规范化一条通知：非法输入返回 null（调用方丢弃），合法输入做长度截断。
   *
   * 截断而不是报错：文案由业务方拼装，长度超限属于"展示问题"，
   * 让整条通知消失是更糟的结果。
   */
  private toDraft(input: NotifyInput): CreateNotificationInput | null {
    const userId = input.userId?.trim();
    const title = input.title?.trim();
    const body = input.body?.trim();

    if (!userId || !title || !body) {
      this.logger.warn(`丢弃了一条字段不全的站内信（source=${input.source}）`);
      return null;
    }

    if (!(NOTIFICATION_SOURCES as readonly string[]).includes(input.source)) {
      this.logger.warn(`丢弃了一条 source 未登记的站内信：${input.source}`);
      return null;
    }

    return {
      userId,
      title: truncate(title, NOTIFICATION_TITLE_MAX),
      body: truncate(body, NOTIFICATION_BODY_MAX),
      source: input.source,
      link: input.link ?? null,
    };
  }
}

/** 按**码点**截断（避免把 emoji/中文代理对截成半个） */
function truncate(value: string, max: number): string {
  const points = [...value];
  return points.length <= max ? value : `${points.slice(0, max - 1).join('')}…`;
}
