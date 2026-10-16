/**
 * wildlife · 配置（规格 §5.4 / §9.7）
 *
 * 两条**方向相反**的配置哲学，刻意放在一起对比：
 *
 * | 配置 | 缺失时的行为 | 理由 |
 * | --- | --- | --- |
 * | `WILDLIFE_CLASSIFIER*`（分类） | **降级到 manual + WARN，不崩溃** | 分类是增强，不是隐私防线 |
 * | `WILDLIFE_FUZZ_SECRET`（加噪） | **启动失败** | 加噪是隐私防线，静默降级等于静默泄漏 |
 */
import { z } from 'zod';
import type { ConfigService } from '@nestjs/config';
import { assertFuzzSecret } from '../modules/wildlife/domain/fuzzing';
import { resolveClassifierMode, type ClassifierMode } from '../modules/wildlife/domain/taxonomy';
import { DEFAULT_FUZZ_RADIUS_M } from '../modules/wildlife/domain/fuzzing';
import { CLASSIFIER_DEFAULT_TOP_K, CLASSIFIER_MIN_CONFIDENCE } from '../modules/wildlife/domain/ports/species-classifier.port';

export const wildlifeConfigSchema = z.object({
  WILDLIFE_CLASSIFIER: z.enum(['manual', 'server', 'off']).default('manual'),
  WILDLIFE_CLASSIFIER_PROVIDER: z.enum(['local-onnx', 'third-party', 'none']).default('none'),
  WILDLIFE_ONNX_MODEL_PATH: z.string().default(''),
  /** 空 = 不启用第三方（规格 §5.1：默认不把校园照片发给第三方） */
  WILDLIFE_VISION_API_KEY: z.string().default(''),
  WILDLIFE_CLASSIFIER_MIN_CONFIDENCE: z.coerce.number().min(0).max(1).default(CLASSIFIER_MIN_CONFIDENCE),
  WILDLIFE_CLASSIFIER_TOP_K: z.coerce.number().int().min(1).max(20).default(CLASSIFIER_DEFAULT_TOP_K),
  WILDLIFE_FUZZ_DEFAULT_RADIUS_M: z.coerce.number().int().min(1).max(5000).default(DEFAULT_FUZZ_RADIUS_M),
  /** 位置模糊化密钥（≥32 字节）。**缺失即启动失败** */
  WILDLIFE_FUZZ_SECRET: z.string().default(''),
  /** 对象存储本地根目录（开发用） */
  WILDLIFE_MEDIA_DIR: z.string().default('var/wildlife-media'),
  /** 备注违禁词表（逗号分隔）。代码里不硬编码词库 */
  WILDLIFE_BANNED_KEYWORDS: z.string().default(''),
  /** 审核员白名单（逗号分隔的 userId） */
  WILDLIFE_MODERATOR_USER_IDS: z.string().default(''),
});

export type WildlifeConfig = z.infer<typeof wildlifeConfigSchema> & {
  /** 实际生效的分类模式（可能因不可用而降级） */
  effectiveClassifierMode: ClassifierMode;
  classifierDegraded: boolean;
  classifierDegradeReason: string | null;
};

/**
 * 从 `ConfigService` 读取配置。
 *
 * 刻意**不在 import 期读环境变量**：那样测试无法注入，且 `process.env` 的
 * 读取时机与 Nest 的 ConfigModule 加载顺序耦合。
 */
export function readWildlifeConfig(config: ConfigService): WildlifeConfig {
  const raw = {
    WILDLIFE_CLASSIFIER: config.get<string>('WILDLIFE_CLASSIFIER') ?? 'manual',
    WILDLIFE_CLASSIFIER_PROVIDER: config.get<string>('WILDLIFE_CLASSIFIER_PROVIDER') ?? 'none',
    WILDLIFE_ONNX_MODEL_PATH: config.get<string>('WILDLIFE_ONNX_MODEL_PATH') ?? '',
    WILDLIFE_VISION_API_KEY: config.get<string>('WILDLIFE_VISION_API_KEY') ?? '',
    WILDLIFE_CLASSIFIER_MIN_CONFIDENCE: config.get<string>('WILDLIFE_CLASSIFIER_MIN_CONFIDENCE') ?? undefined,
    WILDLIFE_CLASSIFIER_TOP_K: config.get<string>('WILDLIFE_CLASSIFIER_TOP_K') ?? undefined,
    WILDLIFE_FUZZ_DEFAULT_RADIUS_M: config.get<string>('WILDLIFE_FUZZ_DEFAULT_RADIUS_M') ?? undefined,
    WILDLIFE_FUZZ_SECRET: config.get<string>('WILDLIFE_FUZZ_SECRET') ?? '',
    WILDLIFE_MEDIA_DIR: config.get<string>('WILDLIFE_MEDIA_DIR') ?? 'var/wildlife-media',
    WILDLIFE_BANNED_KEYWORDS: config.get<string>('WILDLIFE_BANNED_KEYWORDS') ?? '',
    WILDLIFE_MODERATOR_USER_IDS: config.get<string>('WILDLIFE_MODERATOR_USER_IDS') ?? '',
  };
  const parsed = wildlifeConfigSchema.parse(raw);

  // 启动自检（规格 §5.4）：server 但 provider 不可用 → 降级到 manual，**不崩溃**
  const resolution = resolveClassifierMode({
    configured: parsed.WILDLIFE_CLASSIFIER,
    provider: parsed.WILDLIFE_CLASSIFIER_PROVIDER,
    hasApiKey: parsed.WILDLIFE_VISION_API_KEY.trim().length > 0,
    hasModelPath: parsed.WILDLIFE_ONNX_MODEL_PATH.trim().length > 0,
  });

  return {
    ...parsed,
    effectiveClassifierMode: resolution.mode,
    classifierDegraded: resolution.degraded,
    classifierDegradeReason: resolution.reason,
  };
}

/**
 * 隐私关键路径的启动自检（规格 §9.7 / T14）。
 *
 * **这是本模块唯一"缺配置就崩溃"的地方，且是故意的**：
 * 加噪是隐私防线，静默降级等于静默泄漏。宁可启动失败。
 */
export function requireFuzzSecret(config: ConfigService): string {
  return assertFuzzSecret(config.get<string>('WILDLIFE_FUZZ_SECRET'));
}
