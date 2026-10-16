/**
 * wildlife · 健康异常告警实现（规格 §8.4）
 *
 * 关键语义：**通知不等待审核**。疑似受伤的动物不能排队等审核队列 ——
 * 上报落库后立即通知社团管理员，而**公开可见仍要审核**。
 * 内部告警与对外发布是两条独立的路径。
 *
 * 站内信**不含精确坐标**：精确坐标在受限表里，管理员要看去
 * `GET /items/:id`（管理员视角）——那条路径每次读取都写审计。
 * 把坐标塞进站内信等于把受限数据复制到另一张没有访问控制的表里。
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../prisma/prisma.service';
import { parseIdList } from '../../../common/auth/role.port';
import { WILDLIFE_MODERATOR_ENV_KEY } from '../domain/wildlife.domain';
import type { HealthAlertPort } from '../domain/wildlife.domain';

@Injectable()
export class PrismaHealthAlertNotifier implements HealthAlertPort {
  private readonly logger = new Logger(PrismaHealthAlertNotifier.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {}

  async notifyHealthConcern(input: {
    sightingId: string;
    reporterId: string;
    zoneId: string | null;
    observedAt: Date;
  }): Promise<void> {
    const moderatorIds = parseIdList(this.config.get<string>(WILDLIFE_MODERATOR_ENV_KEY));
    if (moderatorIds.length === 0) {
      // 没有配置管理员时**不静默丢弃**：打 WARN，让运维看得见
      this.logger.warn(
        `有疑似受伤动物上报（${input.sightingId}），但 ${WILDLIFE_MODERATOR_ENV_KEY} 未配置，无人可通知`,
      );
      return;
    }

    try {
      await (this.prisma as any).notification.createMany({
        data: moderatorIds.map((userId) => ({
          userId,
          title: '有疑似受伤动物上报',
          body: `请尽快核实（观测 ${input.sightingId}，发现时间 ${input.observedAt.toISOString()}）。精确位置请打开管理端详情查看。`,
          channel: 'inapp',
        })),
      });
    } catch (error) {
      // 告警失败**不得阻塞上报**：上报本身比通知重要（漏一次通知可以补，丢一条上报不行）
      this.logger.error(
        `健康异常站内信发送失败（不阻塞上报）: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
