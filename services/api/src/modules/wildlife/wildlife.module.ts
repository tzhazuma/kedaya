/**
 * wildlife · NestJS 装配（规格 §5.4 / §9.7）
 *
 * ## 两个工厂 provider 是刻意的
 *
 * 1. `WILDLIFE_FUZZ_SECRET` —— **缺配置即启动失败**（规格 §9.7 / T14）。
 *    加噪是隐私防线，静默降级等于静默泄漏。这是本模块唯一"缺配置就崩溃"的地方。
 * 2. `SPECIES_CLASSIFIER` —— **缺配置即降级**（规格 §5.4 / T42）。
 *    分类是增强，不是前置条件；`server` 但 provider 不可用时降级到 `manual` 并 WARN。
 *
 * 方向相反的两条配置哲学放在同一个文件里，是为了让读者一眼看到区别。
 */
import { Logger, Module, type Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RoleModule } from '../../common/auth/role.port';
import { IdempotencyModule } from '../../common/idempotency/idempotency.module';
import { requireFuzzSecret, readWildlifeConfig } from '../../config/wildlife.config';
import { WildlifeCatalogPrismaRepository, WildlifeDerivedPrismaRepository, WildlifeIndividualPrismaRepository, WildlifeMediaPrismaRepository, WildlifeSightingPrismaRepository } from './data/wildlife.repository';
import { LocalMediaStorage, SharpThumbnailer } from './data/media-processor';
import { PrismaHealthAlertNotifier } from './data/health-alert';
import {
  MockClassifier,
  NullClassifier,
  SPECIES_CLASSIFIER,
  ThirdPartyClassifier,
  type SpeciesClassifierPort,
} from './domain/ports/species-classifier.port';
import {
  HEALTH_ALERT_PORT,
  MEDIA_STORAGE,
  THUMBNAILER,
  WILDLIFE_CATALOG_REPOSITORY,
  WILDLIFE_DERIVED_REPOSITORY,
  WILDLIFE_INDIVIDUAL_REPOSITORY,
  WILDLIFE_MEDIA_REPOSITORY,
  WILDLIFE_SIGHTING_REPOSITORY,
} from './domain/wildlife.domain';
import { WildlifeController } from './wildlife.controller';
import { WildlifeDerivationService } from './wildlife.derivation.service';
import { WildlifeQueryService } from './wildlife.query.service';
import { WildlifeSightingService } from './wildlife.sighting.service';

/** 加噪密钥的 DI token（同时承担"启动自检"的副作用） */
export const WILDLIFE_FUZZ_SECRET_TOKEN = Symbol('KEDAYA_WILDLIFE_FUZZ_SECRET');

const logger = new Logger('WildlifeModule');

/**
 * 分类器工厂。
 *
 * 三档模式（规格 §5.2）：
 *   · `manual`（默认）→ 只提供手动选择；
 *   · `server` → 自动建议 + 手动可覆盖；
 *   · `off` → 完全不调用分类器（故障时快速止血）。
 *
 * ⚠️ 本仓库**不接任何外部视觉 API**（规格 §5.1：把校园照片发给第三方需要单独同意，
 * 而 wildlife 是低敏感无同意门模块）。因此 `server` 模式下若 provider 不可用，
 * 仍然降级 —— 但**降级是 WARN 不是崩溃**。
 */
function createClassifier(config: ConfigService): SpeciesClassifierPort {
  const cfg = readWildlifeConfig(config);
  if (cfg.classifierDegraded && cfg.classifierDegradeReason) {
    logger.warn(cfg.classifierDegradeReason);
  }
  if (cfg.effectiveClassifierMode !== 'server') return new NullClassifier();

  if (cfg.WILDLIFE_CLASSIFIER_PROVIDER === 'third-party') {
    return new ThirdPartyClassifier(cfg.WILDLIFE_VISION_API_KEY);
  }
  if (cfg.WILDLIFE_CLASSIFIER_PROVIDER === 'local-onnx') {
    // 本仓库没有 ONNX 运行时依赖：模型路径存在也返回空建议，
    // 由 `shapeClassification` 标记 `degraded`，客户端落回手动选择。
    logger.warn('WILDLIFE_CLASSIFIER_PROVIDER=local-onnx：本仓库未内置 ONNX 运行时，分类将返回空建议');
    return new MockClassifier([], 'local-onnx');
  }
  return new NullClassifier();
}

const providers: Provider[] = [
  // —— 仓储（端口 → Prisma 实现） ——
  WildlifeCatalogPrismaRepository,
  WildlifeSightingPrismaRepository,
  WildlifeMediaPrismaRepository,
  WildlifeDerivedPrismaRepository,
  WildlifeIndividualPrismaRepository,
  { provide: WILDLIFE_CATALOG_REPOSITORY, useExisting: WildlifeCatalogPrismaRepository },
  { provide: WILDLIFE_SIGHTING_REPOSITORY, useExisting: WildlifeSightingPrismaRepository },
  { provide: WILDLIFE_MEDIA_REPOSITORY, useExisting: WildlifeMediaPrismaRepository },
  { provide: WILDLIFE_DERIVED_REPOSITORY, useExisting: WildlifeDerivedPrismaRepository },
  { provide: WILDLIFE_INDIVIDUAL_REPOSITORY, useExisting: WildlifeIndividualPrismaRepository },

  // —— 基础设施端口 ——
  SharpThumbnailer,
  { provide: THUMBNAILER, useExisting: SharpThumbnailer },
  LocalMediaStorage,
  { provide: MEDIA_STORAGE, useExisting: LocalMediaStorage },
  PrismaHealthAlertNotifier,
  { provide: HEALTH_ALERT_PORT, useExisting: PrismaHealthAlertNotifier },
  {
    provide: SPECIES_CLASSIFIER,
    useFactory: createClassifier,
    inject: [ConfigService],
  },

  // —— 隐私关键路径的启动自检（缺密钥 → 抛错 → 应用起不来） ——
  {
    provide: WILDLIFE_FUZZ_SECRET_TOKEN,
    useFactory: (config: ConfigService) => {
      const secret = requireFuzzSecret(config);
      logger.log('位置模糊化密钥已加载（WILDLIFE_FUZZ_SECRET）');
      return secret;
    },
    inject: [ConfigService],
  },

  // —— 用例层 ——
  WildlifeQueryService,
  WildlifeSightingService,
  WildlifeDerivationService,
];

@Module({
  imports: [IdempotencyModule, RoleModule],
  controllers: [WildlifeController],
  providers,
  exports: [WildlifeQueryService, WildlifeSightingService, WildlifeDerivationService],
})
export class WildlifeModule {}
