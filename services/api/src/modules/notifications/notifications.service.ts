/**
 * 通知 · notifications（契约 §4）
 *
 * 本文件由 scripts/scaffold.mjs 生成；要改形状请改脚本里的 SPEC 表，
 * 改完重跑 `npm run scaffold`，避免 15 个模块各写一套。
 */
import { Inject, Injectable } from '@nestjs/common';
import { CrudService } from '../../common/crud/crud.service';
import { ValidationError } from '../../common/errors/app-error';
import {
  NOTIFICATION_REPOSITORY,
  type CreateNotificationInput,
  type NotificationModel,
  type NotificationRepository,
  type UpdateNotificationInput,
} from './domain/notifications.domain';

/**
 * 用例层（契约 §7）：只编排，不含 IO。
 * 依赖通过**显式 token** 注入（而非 design:paramtypes），
 * 这样在 vitest 等不做 emitDecoratorMetadata 的转译器下 DI 依然成立。
 */
@Injectable()
export class NotificationService extends CrudService<NotificationModel, CreateNotificationInput, UpdateNotificationInput> {
  constructor(
    @Inject(NOTIFICATION_REPOSITORY) private readonly repo: NotificationRepository,
  ) {
    super(repo, 'notifications', '通知');
  }

  /**
   * 创建。userId 允许由请求主体补全（未登录时必须在 body 里显式给出）。
   */
  override async create(input: CreateNotificationInput, actorId?: string): Promise<NotificationModel> {
    const owner = input.userId ?? actorId;
    if (!owner) {
      throw new ValidationError('未登录时必须显式提供 userId', { field: 'userId' });
    }
    return super.create({ ...input, userId: owner });
  }
  /** 领域动作：标记已读（契约 §6.1 的 POST /items/:id/read） */
  async read(id: string): Promise<NotificationModel> {
    await this.detail(id);
    return this.repo.update(id, { readAt: new Date() } as UpdateNotificationInput);
  }
}
