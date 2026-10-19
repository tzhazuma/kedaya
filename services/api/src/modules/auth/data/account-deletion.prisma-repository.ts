import { Inject, Injectable } from '@nestjs/common';

import { AppError, InternalError } from '../../../common/errors/app-error';
import { PrismaService } from '../../../prisma/prisma.service';
import type {
  AccountDeletionOutcome,
  AccountDeletionRepository,
} from '../domain/account-deletion.domain';

/**
 * 账号注销的 Prisma 实现。
 *
 * ## 为什么匿名化而不是删除
 *
 * `User` 被 60+ 个模型引用。这里**只撤销身份相关的东西**，
 * 业务内容（帖子、拼单、跳蚤市场）保留但因为作者已匿名化而不再指向任何真人。
 *
 * ## 事务边界
 *
 * 全部在一个 `$transaction` 里。任何一步抛错 → 整体回滚 → 用户数据原样还在。
 * 这比"删了一半"诚实得多：后者会让用户以为注销成功，实际还残留凭据。
 *
 * 失败统一翻成 `InternalError`（500），并且**文案必须说清"没有修改任何数据"**：
 * 用户需要知道重试是安全的，而不是以为账号处于半注销状态。
 */
@Injectable()
export class AccountDeletionPrismaRepository implements AccountDeletionRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async isDeleted(userId: string): Promise<boolean> {
    const row = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { deletedAt: true },
    });
    // 行不存在也算"已注销"—— 对调用方来说结果一样：不能再登进来。
    return row === null || row.deletedAt !== null;
  }

  async deleteAccount(userId: string): Promise<AccountDeletionOutcome> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        // ① 抢锁：只有把 deletedAt 从 null 改成时间戳的那个请求才算赢。
        //    这一步必须是事务里的**第一个**写操作，否则后面的删除会白做。
        const claimed = await tx.user.updateMany({
          where: { id: userId, deletedAt: null },
          data: {
            deletedAt: new Date(),
            // 匿名化：不删行，但让它不再指向任何真人
            displayName: '已注销用户',
            avatarUrl: null,
            department: null,
            anonEnabled: false,
          },
        });

        if (claimed.count === 0) {
          // 已经注销过（或并发中输给了别人）。
          // 注意：这里**不抛错**，让调用方拿到 'already-deleted' 去回 409，
          // 事务本身正常提交（没有副作用需要回滚）。
          return 'already-deleted' as const;
        }

        // ② 撤销一切能让他再登进来的东西
        await tx.refreshSession.deleteMany({ where: { userId } });
        await tx.userCredential.deleteMany({ where: { userId } });
        await tx.authIdentity.deleteMany({ where: { userId } });
        await tx.campusBinding.deleteMany({ where: { userId } });
        await tx.campusSession.deleteMany({ where: { userId } });
        await tx.techpieLink.deleteMany({ where: { userId } });

        // ③ 删除隐私敏感数据
        await tx.consent.deleteMany({ where: { userId } });
        await tx.profileSetting.deleteMany({ where: { userId } });
        await tx.mailEvent.deleteMany({ where: { userId } });
        await tx.mailAccount.deleteMany({ where: { userId } });
        await tx.aiPortraitProfile.deleteMany({ where: { userId } });
        await tx.wellbeingAppointment.deleteMany({ where: { userId } });

        // ④ 审计：**保留**一条注销记录（不留邮箱等 PII）。
        //    这不是隐私数据 —— 它是"这个 id 在某时刻注销了"的事实。
        // ⚠️ `AuditLog` 的操作者字段是 `actorId`（关系名 `user`），不是 `userId`；
        //    资源字段是 `resource` / `resourceId`，没有 `target` / `detail`。
        //    `onDelete: SetNull` 意味着这条审计在用户行被删时会失去 actor ——
        //    所以这里必须用 `actorId` 保留下来，注销后仍能追到是谁注销的。
        await tx.auditLog.create({
          data: {
            actorId: userId,
            actorType: 'user',
            action: 'account.delete',
            resource: 'User',
            resourceId: userId,
            module: 'auth',
            metadata: {
              note: '用户自助注销：已撤销会话/凭据/第三方身份/校园绑定，业务内容保留并匿名化',
            },
          },
        });

        const row = await tx.user.findUnique({
          where: { id: userId },
          select: { deletedAt: true },
        });

        // 理论上不可能为 null（上面刚写过），但不做非空断言 —— 宁可抛错回滚。
        if (row?.deletedAt == null) {
          throw new Error('注销后未能读到 deletedAt：事务回滚，用户数据未被修改');
        }

        return { deletedAt: row.deletedAt.toISOString() } as const;
      });
    } catch (error) {
      // 已经是业务错误（如未来在事务里抛 409）就原样上抛，不要吞成 500。
      if (error instanceof AppError) throw error;

      // ⚠️ 不"尽力而为"：到这里的唯一含义是事务已回滚，用户数据原样还在。
      throw new InternalError(
        '注销失败：本次操作已全部回滚，你的账号与数据没有被修改，请稍后重试',
      );
    }
  }
}
