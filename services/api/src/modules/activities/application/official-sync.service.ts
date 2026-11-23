import { Inject, Injectable, Logger } from "@nestjs/common";

import { ValidationError } from "../../../common/errors/app-error";
import { PrismaService } from "../../../prisma/prisma.service";
import { WechatOfficialAccountService } from "../../wechat/application/wechat-official-account.service";
import { ActivitiesService } from "./activities.service";

@Injectable()
export class OfficialSyncService {
  private readonly logger = new Logger(OfficialSyncService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ActivitiesService) private readonly activities: ActivitiesService,
    @Inject(WechatOfficialAccountService)
    private readonly official: WechatOfficialAccountService,
  ) {}

  async subscribe(
    userId: string,
    accountKey: string,
  ): Promise<{ accountKey: string }> {
    if (
      !this.official.accounts().some((account) => account.key === accountKey)
    ) {
      throw new ValidationError(`未配置公众号：${accountKey}`);
    }
    await this.prisma.officialAccountSubscription.upsert({
      where: { userId_accountKey: { userId, accountKey } },
      create: { userId, accountKey },
      update: {},
    });
    return { accountKey };
  }

  async unsubscribe(
    userId: string,
    accountKey: string,
  ): Promise<{ removed: boolean }> {
    const result = await this.prisma.officialAccountSubscription.deleteMany({
      where: { userId, accountKey },
    });
    return { removed: result.count > 0 };
  }

  async subscriptions(
    userId: string,
  ): Promise<Array<{ key: string; name: string; subscribed: boolean }>> {
    const rows = await this.prisma.officialAccountSubscription.findMany({
      where: { userId },
    });
    const subscribed = new Set(rows.map((row) => row.accountKey));
    return this.official.accounts().map((account) => ({
      ...account,
      subscribed: subscribed.has(account.key),
    }));
  }

  syncUser(userId: string, accountKey: string) {
    return this.activities.syncOfficial(userId, accountKey);
  }

  async syncAll(): Promise<{
    created: number;
    skipped: number;
    failed: number;
  }> {
    const rows = await this.prisma.officialAccountSubscription.findMany({
      select: { userId: true, accountKey: true },
    });
    let created = 0;
    let skipped = 0;
    let failed = 0;
    for (const row of rows) {
      try {
        const result = await this.activities.syncOfficial(
          row.userId,
          row.accountKey,
        );
        created += result.created;
        skipped += result.skipped;
      } catch (error) {
        failed += 1;
        this.logger.warn(
          `公众号订阅同步失败 account=${row.accountKey}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    return { created, skipped, failed };
  }
}
