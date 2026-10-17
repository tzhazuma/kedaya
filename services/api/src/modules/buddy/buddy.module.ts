/**
 * 找搭子 · Nest 模块装配（契约 §4 / §7）
 *
 * ## 本模块已从 `scripts/scaffold.mjs` 的 SPEC 表**移出**
 *
 * 与 `forum` / `faq` / `wildlife` 同类：脚手架的"一套 CRUD + 一个动作"形状
 * 表达不了 buddy —— 它有三档降级、pgvector 手写迁移、行锁事务、MMR 重排、
 * 问卷同步与一张可见性矩阵。因此本目录**不再由脚本写盘**，
 * 手写实现不会被 `npm run scaffold` 覆盖（见 scaffold.mjs 的"已移除"清单）。
 *
 * ## 依赖装配
 *
 * | token | 实现 | 说明 |
 * | --- | --- | --- |
 * | `BUDDY_PROFILE_REPOSITORY` | `BuddyProfilePrismaRepository` | |
 * | `BUDDY_POST_REPOSITORY` | `BuddyPostPrismaRepository` | |
 * | `BUDDY_APPLICATION_REPOSITORY` | `BuddyApplicationPrismaRepository` | 含 `FOR UPDATE` 事务 |
 * | `BUDDY_FEEDBACK_REPOSITORY` | `BuddyFeedbackPrismaRepository` | |
 * | `BUDDY_QUESTIONNAIRE_REPOSITORY` | `BuddyQuestionnairePrismaRepository` | |
 * | `BUDDY_USER_REPOSITORY` | `BuddyUserPrismaRepository` | 只读公开资料 |
 * | `BUDDY_VECTOR_REPOSITORY` | `BuddyVectorPrismaRepository` | `$queryRaw` + 参数绑定 |
 * | `BUDDY_CAPABILITY_PROBE` | `BuddyCapabilityProbe` | 启动自检（降级不崩溃） |
 * | `BUDDY_NOTIFIER` | `BuddyNotificationAdapter` | **载荷不含联系方式**（规格 U8） |
 *
 * ## 为什么用 `useExisting` 而不是 `useClass`
 *
 * `useClass` 会为同一个 token 造出**第二个实例**。仓储是无状态的，看起来无所谓，
 * 但测试里 `overrideProvider(PrismaService)` 之后两个实例会共享同一个假客户端，
 * 而"到底有几个实例"在 DI 图里看不见 —— 出问题时极难排查。
 * `useExisting` 让类实例只有一个，token 只是它的别名。
 */

import { Module } from '@nestjs/common';
import { IdempotencyModule } from '../../common/idempotency/idempotency.module';
import { BuddyController } from './buddy.controller';
import { BuddyProfileService } from './application/buddy-profile.service';
import { BuddyPostService } from './application/buddy-post.service';
import { BuddyApplicationService } from './application/buddy-application.service';
import { BuddyRecommendService } from './application/buddy-recommend.service';
import { BuddyFeedbackService } from './application/buddy-feedback.service';
import { BuddyQuestionnaireService } from './application/buddy-questionnaire.service';
import { BuddyTagsService } from './application/buddy-tags.service';
import { BuddyMatchingService } from './application/buddy-matching.service';
import { BuddyProfilePrismaRepository, BuddyPostPrismaRepository, BuddyUserPrismaRepository } from './data/buddy.repository';
import {
  BuddyApplicationPrismaRepository,
  BuddyFeedbackPrismaRepository,
  BuddyNotificationAdapter,
  BuddyQuestionnairePrismaRepository,
} from './data/buddy-application.repository';
import { BuddyVectorPrismaRepository } from './data/buddy-vector.repository';
import { BuddyCapabilityProbe } from './data/buddy-capability.probe';
import {
  BUDDY_APPLICATION_REPOSITORY,
  BUDDY_CAPABILITY_PROBE,
  BUDDY_FEEDBACK_REPOSITORY,
  BUDDY_NOTIFIER,
  BUDDY_POST_REPOSITORY,
  BUDDY_PROFILE_REPOSITORY,
  BUDDY_QUESTIONNAIRE_REPOSITORY,
  BUDDY_USER_REPOSITORY,
  BUDDY_VECTOR_REPOSITORY,
} from './domain/buddy.domain';

@Module({
  // IdempotencyModule 是 @Global 的，但仍需被至少一个模块 import ——
  // 这里由 BuddyModule import（Nest 按类去重，拿到的是同一个 store 单例）。
  imports: [IdempotencyModule],
  controllers: [BuddyController],
  providers: [
    // —— data 层实现 ——
    BuddyProfilePrismaRepository,
    BuddyPostPrismaRepository,
    BuddyUserPrismaRepository,
    BuddyApplicationPrismaRepository,
    BuddyFeedbackPrismaRepository,
    BuddyQuestionnairePrismaRepository,
    BuddyCapabilityProbe,
    BuddyNotificationAdapter,
    // 向量仓储自己在构造函数里从 ConfigService 读 `BUDDY_VECTOR_DIM`
    // （维度写错会让 `<=>` 直接报错，而不是静默算错相似度）
    BuddyVectorPrismaRepository,
    // —— token 别名（单实例）——
    { provide: BUDDY_PROFILE_REPOSITORY, useExisting: BuddyProfilePrismaRepository },
    { provide: BUDDY_POST_REPOSITORY, useExisting: BuddyPostPrismaRepository },
    { provide: BUDDY_USER_REPOSITORY, useExisting: BuddyUserPrismaRepository },
    { provide: BUDDY_APPLICATION_REPOSITORY, useExisting: BuddyApplicationPrismaRepository },
    { provide: BUDDY_FEEDBACK_REPOSITORY, useExisting: BuddyFeedbackPrismaRepository },
    { provide: BUDDY_QUESTIONNAIRE_REPOSITORY, useExisting: BuddyQuestionnairePrismaRepository },
    { provide: BUDDY_CAPABILITY_PROBE, useExisting: BuddyCapabilityProbe },
    { provide: BUDDY_NOTIFIER, useExisting: BuddyNotificationAdapter },
    { provide: BUDDY_VECTOR_REPOSITORY, useExisting: BuddyVectorPrismaRepository },

    // —— 用例层 ——
    BuddyMatchingService,
    BuddyProfileService,
    BuddyPostService,
    BuddyApplicationService,
    BuddyRecommendService,
    BuddyFeedbackService,
    BuddyQuestionnaireService,
    // 标签表读取：纯投影，无 IO、无仓储依赖（唯一真相在 @kedaya/contracts）
    BuddyTagsService,
  ],
  exports: [BuddyMatchingService],
})
export class BuddyModule {}
