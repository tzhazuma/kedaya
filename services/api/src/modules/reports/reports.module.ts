import { Module } from '@nestjs/common';
import { ReportController } from './reports.controller';
import { ReportService } from './reports.service';
import { REPORT_REPOSITORY, ReportPrismaRepository } from './data/reports.repository';

/**
 * 内容举报（UGC 合规底线，不是用户可见模块）。
 *
 * 客户端入口：跳蚤 / 跑腿 / 搭子 / 失物 / 论坛（帖子与回复）的详情页底部「举报」。
 *
 * 刻意**没有**管理端读接口：本仓库还没有后台管理员鉴权，
 * 一个「任何登录用户都能读到全站举报队列（含举报人 ID 与被举报内容）」的接口
 * 是明确的信息泄露。复核走云托管日志（`[moderation]` 前缀）与
 * `docs/deploy.md`「举报复核」一节的 SQL。
 */
@Module({
  controllers: [ReportController],
  providers: [
    ReportService,
    { provide: REPORT_REPOSITORY, useClass: ReportPrismaRepository },
  ],
})
export class ReportsModule {}
