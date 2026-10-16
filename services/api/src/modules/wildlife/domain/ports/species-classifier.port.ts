/**
 * wildlife · 自动分类端口（规格 §5.3，**可插拔**）
 *
 * ## 核心设计原则（规格 §5.2，一句话）
 *
 * > **分类是增强，不是前置条件。没有分类，上报依然完整有效。**
 *
 * ## 为什么默认不启用第三方视觉 API（规格 §5.1）
 *
 * 候选 B 意味着把**用户拍摄的校园照片**发给第三方。这些照片可能包含
 * 人脸、宿舍内景、门牌号、其它同学的私人物品 —— 这构成向第三方共享个人信息，
 * 需要单独告知并取得同意（PIPL）。而 `wildlife` 是**低敏感、无同意门**的模块，
 * 加一个同意门是**错误的产品设计**。
 *
 * ## 降级契约（T42 / T43）
 *
 *   · `WILDLIFE_CLASSIFIER=manual`（默认）→ 只提供手动选择，`classifiedBy = 'manual'`；
 *   · `server` 但 provider 不可用（模型文件缺失 / key 为空）→ **降级到 manual 并 WARN**，
 *     **不崩溃**（同 buddy 的降级原则）；
 *   · 任何实现都**不得抛异常**：无能力时返回**空数组**。
 */

/** 一条分类建议 */
export interface SpeciesPrediction {
  /** 映射到 `SpeciesTaxonomy.id` */
  speciesId: string;
  /** 0..1 */
  confidence: number;
  /** 分类来源，便于 UI 标注与纠错闭环 */
  provider?: string;
}

export type ClassifierProvider = 'local-onnx' | 'third-party' | 'none';

export interface SpeciesClassifierPort {
  readonly provider: ClassifierProvider;
  /**
   * 返回 top-K 预测，按 confidence 降序。
   * **无能力时返回空数组，不抛异常。**
   */
  classify(image: Buffer, topK: number): Promise<SpeciesPrediction[]>;
}

/** DI token（本项目一律用显式 token，见 test/setup.ts 的说明） */
export const SPECIES_CLASSIFIER = Symbol('KEDAYA_WILDLIFE_SPECIES_CLASSIFIER');

/* ------------------------------------------------------------------ *
 * 置信度阈值（规格 §5.5）
 * ------------------------------------------------------------------ */

/** 低于此值**不预选**，必须用户自己选 */
export const CLASSIFIER_MIN_CONFIDENCE = 0.6;

/** 高于此值展示"很确定" */
export const CLASSIFIER_HIGH_CONFIDENCE = 0.85;

/** 默认 top-K */
export const CLASSIFIER_DEFAULT_TOP_K = 3;

/**
 * `NullClassifier` —— **默认实现**，恒返回 `[]`。
 *
 * 它保证系统在**零配置**下完整可用：上报流程只走手动选物种，
 * `POST /classify` 返回 `{ suggestions: [], degraded: true }` 而不是 5xx（T43）。
 */
export class NullClassifier implements SpeciesClassifierPort {
  readonly provider: ClassifierProvider = 'none';

  async classify(_image: Buffer, _topK: number): Promise<SpeciesPrediction[]> {
    return [];
  }
}

/**
 * `MockClassifier` —— 测试与演示用。
 *
 * 刻意做成"标签体系映射后"的形态：它返回的是**已经映射到我们 speciesId**
 * 的结果，因为第三方标签映射发生在具体实现内部（映射不上的标签直接丢弃，
 * 规格 §5.3：**猜错物种比不分类更糟**）。
 */
export class MockClassifier implements SpeciesClassifierPort {
  readonly provider: ClassifierProvider;

  constructor(
    private readonly predictions: readonly SpeciesPrediction[] = [],
    provider: ClassifierProvider = 'third-party',
  ) {
    this.provider = provider;
  }

  async classify(_image: Buffer, topK: number): Promise<SpeciesPrediction[]> {
    return [...this.predictions]
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, Math.max(0, topK))
      .map((p) => ({ ...p, provider: p.provider ?? this.provider }));
  }
}

/**
 * 第三方分类器（**默认不启用**）。
 *
 * 只有配置了 `WILDLIFE_VISION_API_KEY` 才会被实例化。真实实现要调外部 API +
 * 经 `SpeciesTaxonomy.externalIds` 映射标签；本仓库不接任何外部服务，
 * 因此这里只保留形状与"无 key 即不可用"的判定。
 */
export class ThirdPartyClassifier implements SpeciesClassifierPort {
  readonly provider: ClassifierProvider = 'third-party';

  constructor(private readonly apiKey: string) {}

  /** key 为空 → 不可用（启动自检据此降级到 manual） */
  get available(): boolean {
    return this.apiKey.trim().length > 0;
  }

  async classify(_image: Buffer, _topK: number): Promise<SpeciesPrediction[]> {
    if (!this.available) return [];
    // 本仓库不接外部服务：明确返回空，而不是编造结果
    return [];
  }
}
