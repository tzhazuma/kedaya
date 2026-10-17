import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import type { NormalizedClientEvent } from '../domain/telemetry.domain';

/**
 * 遥测的落库端口。
 *
 * 抽成接口（而不是 service 直接调 Prisma）的理由和别的模块一样：
 * 服务层要能在单元测试里被完整测试，而"写库"这件事在测试里既慢又需要真库。
 */
export interface TelemetryRepository {
  save(
    event: NormalizedClientEvent,
    meta: { userId: string | null; ip: string | null; userAgent: string | null },
  ): Promise<void>;
}

export const TELEMETRY_REPOSITORY = Symbol('TELEMETRY_REPOSITORY');

@Injectable()
export class TelemetryPrismaRepository implements TelemetryRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async save(
    event: NormalizedClientEvent,
    meta: { userId: string | null; ip: string | null; userAgent: string | null },
  ): Promise<void> {
    await this.prisma.clientEvent.create({
      data: {
        kind: event.kind,
        message: event.message,
        stack: event.stack,
        route: event.route,
        traceId: event.traceId,
        platform: event.platform,
        appVersion: event.appVersion,
        // undefined 会让 Prisma 的 Json 字段写成 DBNull；显式给 undefined 才是"不写"
        context: event.context ?? undefined,
        userId: meta.userId,
        ip: meta.ip,
        userAgent: meta.userAgent,
      },
    });
  }
}
