import { Inject, Injectable } from '@nestjs/common';
import { getModule } from '@kedaya/contracts';
import { PrismaService } from '../../../prisma/prisma.service';
import type {
  ProfileExportAccount,
  ProfileExportContentCount,
  ProfileExportPort,
} from '../domain/profile-export.domain';

/**
 * 数据导出的 Prisma 实现（data 层：唯一碰 IO 的地方）。
 *
 * 用 `count()` 而不是把行都取出来：导出接口不该因为某个用户发了 5000 条帖子
 * 就把几百 KB JSON 灌进响应体；用户真正的诉求是"我知道我有哪些数据、能找得到"。
 */
@Injectable()
export class ProfileExportPrismaRepository implements ProfileExportPort {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async account(userId: string): Promise<ProfileExportAccount | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { identities: true, campusBindings: true, credential: true },
    });
    if (!user) return null;

    return {
      id: user.id,
      displayName: user.displayName,
      hasAvatar: user.avatarUrl !== null,
      anonEnabled: user.anonEnabled,
      department: user.department,
      createdAt: user.createdAt.toISOString(),
      hasPassword: user.credential !== null,
      identities: user.identities.map((identity) => ({
        provider: identity.provider,
        email: identity.email,
        realName: identity.realName,
        linkedAt: identity.createdAt.toISOString(),
      })),
      campusBindings: user.campusBindings.map((binding) => ({
        platform: binding.platform,
        status: binding.status,
        scopes: binding.scopes,
        createdAt: binding.createdAt.toISOString(),
        expiresAt: binding.expiresAt.toISOString(),
      })),
    };
  }

  async contentCounts(userId: string): Promise<ProfileExportContentCount[]> {
    const [flea, errand, buddy, lostFound, forumPosts, forumReplies, courses, cardTxns] =
      await Promise.all([
        this.prisma.fleaItem.count({ where: { sellerId: userId } }),
        this.prisma.errandTask.count({ where: { requesterId: userId } }),
        this.prisma.buddyPost.count({ where: { creatorId: userId } }),
        this.prisma.lostFoundItem.count({ where: { reporterId: userId } }),
        this.prisma.forumPost.count({ where: { authorId: userId } }),
        this.prisma.forumReply.count({ where: { authorId: userId } }),
        this.prisma.scheduleCourse.count({ where: { userId } }),
        this.prisma.campusCardTransaction.count({ where: { userId } }),
      ]);

    return [
      { module: 'flea-market', count: flea },
      { module: 'errand', count: errand },
      { module: 'buddy', count: buddy },
      { module: 'lost-found', count: lostFound },
      { module: 'forum', count: forumPosts + forumReplies },
      { module: 'schedule', count: courses, note: '课表为缓存数据，可在课表页重新同步覆盖' },
      { module: 'campus-card', count: cardTxns, note: '校园卡流水为缓存，删除不影响校园卡系统' },
    ].map((item) => {
      const meta = getModule(item.module);
      return {
        module: item.module,
        nameZh: meta?.nameZh ?? item.module,
        count: item.count,
        ...(item.note === undefined ? {} : { note: item.note }),
      };
    });
  }
}
