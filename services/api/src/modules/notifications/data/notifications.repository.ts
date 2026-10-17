import { Inject, Injectable } from '@nestjs/common';
import type { Notification } from '@prisma/client';
import { decodeCursor, encodeCursor } from '../../../common/pagination/cursor';
import { PrismaService } from '../../../prisma/prisma.service';
import type {
  CreateNotificationInput,
  NotificationListQuery,
  NotificationModel,
  NotificationRepository,
} from '../domain/notifications.domain';

/**
 * data 层：唯一允许碰 IO 的地方（契约 §7 依赖方向 domain ← data）。
 *
 * 排序固定为 `createdAt desc, id desc`：
 *   · 消息是**倒序**阅读的（最新的在最上面），不能像脚手架那样按 id 升序；
 *   · `id` 作为第二排序键做 tie-breaker，否则同一毫秒写入的多条通知
 *     在翻页时会跳项或重复（与 flea-market 列表同一做法）。
 */
@Injectable()
export class NotificationPrismaRepository implements NotificationRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async list(query: NotificationListQuery): Promise<{ items: NotificationModel[]; nextCursor: string | null }> {
    const cursorId = decodeCursor(query.cursor);

    const rows = await this.prisma.notification.findMany({
      where: {
        userId: query.userId,
        ...(query.unreadOnly ? { readAt: null } : {}),
      },
      take: query.limit + 1,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
    });

    const hasMore = rows.length > query.limit;
    const visible = hasMore ? rows.slice(0, query.limit) : rows;
    const last = visible.at(-1);

    return {
      items: visible.map(toModel),
      nextCursor: hasMore && last ? encodeCursor(last.id) : null,
    };
  }

  unreadCount(userId: string): Promise<number> {
    return this.prisma.notification.count({ where: { userId, readAt: null } });
  }

  async markRead(id: string, userId: string): Promise<NotificationModel | null> {
    // updateMany 而不是 update：`where` 里可以同时带 id 与 userId，
    // 这样"别人的通知 id"只会命中 0 行，而不是抛异常或在别人的行上生效。
    const result = await this.prisma.notification.updateMany({
      where: { id, userId, readAt: null },
      data: { readAt: new Date() },
    });
    if (result.count === 0) {
      // 可能本来就已经是已读 —— 那也算成功（幂等），回读一次确认归属
      return this.findOwned(id, userId);
    }
    return this.findOwned(id, userId);
  }

  async markAllRead(userId: string): Promise<number> {
    const result = await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    return result.count;
  }

  async create(input: CreateNotificationInput): Promise<NotificationModel> {
    const row = await this.prisma.notification.create({
      data: {
        userId: input.userId,
        title: input.title,
        body: input.body,
        channel: input.channel ?? 'inapp',
        source: input.source ?? 'system',
        link: input.link ?? null,
      },
    });
    return toModel(row);
  }

  async createMany(inputs: readonly CreateNotificationInput[]): Promise<number> {
    if (inputs.length === 0) return 0;
    const result = await this.prisma.notification.createMany({
      data: inputs.map((input) => ({
        userId: input.userId,
        title: input.title,
        body: input.body,
        channel: input.channel ?? 'inapp',
        source: input.source ?? 'system',
        link: input.link ?? null,
      })),
    });
    return result.count;
  }

  private async findOwned(id: string, userId: string): Promise<NotificationModel | null> {
    const row = await this.prisma.notification.findFirst({ where: { id, userId } });
    return row ? toModel(row) : null;
  }
}

function toModel(row: Notification): NotificationModel {
  return {
    id: row.id,
    userId: row.userId,
    title: row.title,
    body: row.body,
    channel: row.channel,
    source: row.source,
    link: row.link,
    readAt: row.readAt,
    createdAt: row.createdAt,
  };
}
