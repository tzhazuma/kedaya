/**
 * 跑腿 · errand（契约 §4）
 *
 * 本文件由 scripts/scaffold.mjs 生成；要改形状请改脚本里的 SPEC 表，
 * 改完重跑 `npm run scaffold`，避免 15 个模块各写一套。
 */
import { Module } from '@nestjs/common';
import { ErrandController } from './errand.controller';
import { ErrandTaskService } from './errand.service';
import { ErrandTaskPrismaRepository } from './data/errand.repository';
import { ERRAND_TASK_REPOSITORY } from './domain/errand.domain';

@Module({
  controllers: [ErrandController],
  providers: [ErrandTaskService, { provide: ERRAND_TASK_REPOSITORY, useClass: ErrandTaskPrismaRepository }],
  exports: [ErrandTaskService],
})
export class ErrandModule {}
