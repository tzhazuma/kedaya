import { Module } from '@nestjs/common';
import { TelemetryController } from './telemetry.controller';
import { TelemetryService } from './telemetry.service';
import { TELEMETRY_REPOSITORY, TelemetryPrismaRepository } from './data/telemetry.repository';

/**
 * 客户端遥测模块（基础设施，不属于用户可见模块）。
 *
 * 只对外暴露一个**写**入口：`POST /telemetry/client-events`。
 *
 * 刻意**没有**读接口：本仓库目前没有后台管理员鉴权（`User` 上没有角色位），
 * 一个"任何登录用户都能读全站崩溃日志"的接口是明确的信息泄露
 * （日志里会有页面路径、IP、UA、时间分布）。
 * 排查请用云托管日志检索，或按 `docs/deploy.md`「遥测保留」给的 SQL 查库。
 * 等真正的后台鉴权就位后再补 `GET`，而不是现在先放一个裸的。
 */
@Module({
  controllers: [TelemetryController],
  providers: [
    TelemetryService,
    { provide: TELEMETRY_REPOSITORY, useClass: TelemetryPrismaRepository },
  ],
})
export class TelemetryModule {}
