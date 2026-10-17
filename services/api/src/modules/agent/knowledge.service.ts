/**
 * 检索服务（RAG 的落地）。
 *
 * ## 为什么不是"向量库 + embedding"
 * 本项目的知识语料只有**几十到几百条**公开文档（模块说明 + 指南 + FAQ），
 * 而且查询几乎都是短句（"课表怎么同步""校园卡丢了"）。在这个量级上：
 *   · 引入 embedding 会增加一个**外部依赖**（模型服务挂了 = agent 挂了），
 *     与本项目的"高可用优先"背道而驰；
 *   · 中文短查询用**字级二元组 + 标题加权**的确定性打分，召回率已经足够，
 *     而且**可解释、可回归、零成本**。
 * 因此这里把 `embedding` 设计成**可替换的检索实现**：`KNOWLEDGE_PORT` 之上
 * 只需换掉本服务的打分函数，对外契约（`RetrievedDoc[]`）不变。
 *
 * ## 白名单（契约 §9）
 * 语料**只能**来自 `KNOWLEDGE_ALLOW_LIST` 的三类来源。构造完语料后立即做一次
 * 前缀校验 —— 这是一道"防手滑"的护栏：以后有人往 `KnowledgeRepository`
 * 里加了一张业务表，这里会直接抛错，而不是悄悄把敏感数据检索出去。
 */

import { Inject, Injectable } from '@nestjs/common';
import {
  KNOWLEDGE_ALLOW_LIST,
  KNOWLEDGE_PORT,
  type KnowledgeDoc,
  type KnowledgePort,
  type RetrievedDoc,
} from './domain/agent.domain';

/** 允许出现在文档 id 前缀里的来源标记（与 `KNOWLEDGE_ALLOW_LIST` 对齐） */
const ALLOWED_ID_PREFIXES = ['module:', 'guide:', 'faq:'] as const;

/** 语料缓存时长：FAQ 变更不频繁，60 秒足够，避免每次问答都打一次库 */
const CACHE_TTL_MS = 60_000;

/** 标题命中权重（标题是"这条文档在讲什么"的最强信号） */
const TITLE_WEIGHT = 3;
/** 正文命中权重 */
const BODY_WEIGHT = 1;
/** 与当前页面同模块的加权 */
const MODULE_BOOST = 2;
/** 命中标题时额外加权（回答"XX 是什么"时优先给模块说明） */
const KIND_WEIGHT: Record<KnowledgeDoc['kind'], number> = {
  faq: 1.2,
  guide: 1.1,
  module: 1,
};

@Injectable()
export class KnowledgeService {
  private cache: { docs: KnowledgeDoc[]; loadedAt: number } | null = null;

  constructor(@Inject(KNOWLEDGE_PORT) private readonly repository: KnowledgePort) {}

  /** 全部语料（带白名单校验 + 短缓存） */
  async all(): Promise<KnowledgeDoc[]> {
    const now = Date.now();
    if (this.cache !== null && now - this.cache.loadedAt < CACHE_TTL_MS) {
      return this.cache.docs;
    }

    const docs = await this.repository.all();
    assertAllowListed(docs);
    this.cache = { docs, loadedAt: now };
    return docs;
  }

  /** 供「模块说明」类问题直接取一条（不做打分，按 id 精确取） */
  async byId(id: string): Promise<KnowledgeDoc | null> {
    const docs = await this.all();
    return docs.find((doc) => doc.id === id) ?? null;
  }

  /**
   * 检索。
   *
   * @param query  用户原话
   * @param options.module 当前所在模块（同模块文档加权，让"这个页面怎么用"更准）
   * @param options.limit  返回条数（默认 3；给模型时不要太多，避免噪声）
   */
  async retrieve(
    query: string,
    options: { module?: string; limit?: number } = {},
  ): Promise<RetrievedDoc[]> {
    const limit = options.limit ?? 3;
    const terms = expandQuery(tokenize(query), query);
    if (terms.length === 0) return [];

    const docs = await this.all();
    const scored: RetrievedDoc[] = [];

    for (const doc of docs) {
      const title = doc.title.toLowerCase();
      const body = doc.body.toLowerCase();
      let score = 0;
      const matched: string[] = [];

      for (const term of terms) {
        let hit = 0;
        if (title.includes(term)) hit += TITLE_WEIGHT;
        if (body.includes(term)) hit += BODY_WEIGHT;
        if (hit > 0) {
          score += hit;
          matched.push(term);
        }
      }

      if (score === 0) continue;
      if (options.module !== undefined && doc.module === options.module) score += MODULE_BOOST;

      /**
       * 长度归一：二元组打分对**长文档**天然有利 —— 文档越长，越容易"撞上"
       * 某个二元组（尤其"还有""多少"这类高频词）。不做归一的话，
       * 用户问"卡里还有多少钱"会被一条很长的课表说明抢走补充位置。
       * 用 `sqrt(len/100)` 这种温和的惩罚：短文档几乎不受影响，长文档明显降权。
       */
      const lengthPenalty = Math.sqrt(Math.max(1, body.length / 100));
      score = (score * KIND_WEIGHT[doc.kind]) / lengthPenalty;

      scored.push({ doc, score: Math.round(score * 100) / 100, matched: [...new Set(matched)] });
    }

    return scored
      .sort((left, right) => right.score - left.score || left.doc.id.localeCompare(right.doc.id))
      .slice(0, limit);
  }
}

/**
 * 查询扩展：口语说法 → 规范词。
 *
 * 用户说的是「我卡里还有多少钱」，白名单文档里写的是「余额」「消费」——
 * 二元组检索**永远**匹配不上这种改写（两者没有公共二元组）。
 * 在这类"用户口语 ≠ 文档用词"的场景里，加一层极小的同义映射，
 * 比引入 embedding 便宜得多，也仍然可解释、可回归。
 *
 * 规则刻意写得**保守**：只在问题里出现明确线索时才补词，
 * 不做泛化联想（否则会把无关文档拉上来，比匹配不到更糟）。
 */
export function expandQuery(terms: string[], query: string): string[] {
  const extended = new Set(terms);
  for (const rule of QUERY_EXPANSIONS) {
    if (!rule.test.test(query)) continue;
    for (const term of rule.terms) extended.add(term);
  }
  return [...extended];
}

/** 口语 → 规范词（`test` 命中时才生效） */
const QUERY_EXPANSIONS: readonly { test: RegExp; terms: string[] }[] = [
  // 校园卡：卡里 / 饭卡 / 还剩多少 / 花了多少 → 余额、消费
  { test: /(卡里|饭卡|余额|还剩|还剩多少|多少钱|花了|消费|充值)/, terms: ['余额', '消费'] },
  // 挂失：丢了 / 找不到 / 不见了 → 挂失
  { test: /(丢了|掉了|不见了|找不到|挂失)/, terms: ['挂失', '校园卡'] },
  // 隐私：授权 / 撤回 / 画像 → 同意、隐私
  { test: /(授权|同意|撤回|隐私|画像)/, terms: ['同意', '隐私'] },
  // 课表：上什么课 / 在哪上 / 几点上 → 课表、教室
  { test: /(上什么课|有哪些课|在哪上|几点上|下节课|下一节)/, terms: ['课表', '节'] },
  // 同步 / 更新 → 同步
  { test: /(同步|更新课表|拉取)/, terms: ['同步'] },
  // 实名 / 打码 → 实名
  { test: /(实名|打码|学号|真实姓名)/, terms: ['实名'] },
  // 登录方式
  { test: /(登录|注册|密码|微信)/, terms: ['登录'] },
];

/**
 * 中文（无分词器）的轻量切分：
 *   · 连续 CJK 字符 → 相邻**二元组**（"校园卡" → 校园 / 园卡）；
 *   · 连续 ASCII 字母数字 → 整个词（"FAQ" / "campus-card"）；
 *   · 其余字符（标点、空格、emoji）直接丢弃。
 * 去掉单字与常见虚词，避免"的""么"这类把无关文档拉进来。
 */
export function tokenize(query: string): string[] {
  const tokens: string[] = [];
  const cjkRuns = query.match(/[\u4e00-\u9fff]+/g) ?? [];
  for (const run of cjkRuns) {
    if (run.length === 1) {
      if (!STOP_CHARS.has(run)) tokens.push(run);
      continue;
    }
    for (let i = 0; i < run.length - 1; i += 1) {
      const bigram = run.slice(i, i + 2);
      if (STOP_BIGRAMS.has(bigram)) continue;
      tokens.push(bigram);
    }
  }

  const latinRuns = query.toLowerCase().match(/[a-z0-9][a-z0-9-]{1,}/g) ?? [];
  tokens.push(...latinRuns);

  return [...new Set(tokens)];
}

/** 高频虚词单字（单独出现时不作为检索词） */
const STOP_CHARS = new Set(['的', '了', '吗', '呢', '啊', '我', '你', '他', '在', '是', '有', '和', '就', '都', '也']);

/** 高频虚词二元组（疑问/指代，命中它们不算"这条文档在讲这个"） */
const STOP_BIGRAMS = new Set([
  '怎么',
  '如何',
  '什么',
  '哪些',
  '可以',
  '能不能',
  '为什',
  '我一',
  '我的',
  '这个',
  '那个',
]);

/**
 * 白名单护栏：任何不属于允许来源的文档都会让 load 失败。
 * 失败是**故意的** —— 宁可 agent 报错，也不要把不该检索的数据检索出去。
 */
export function assertAllowListed(docs: readonly KnowledgeDoc[]): void {
  for (const doc of docs) {
    if (!ALLOWED_ID_PREFIXES.some((prefix) => doc.id.startsWith(prefix))) {
      throw new Error(
        `知识库来源不在白名单内：${doc.id}。` +
          `允许的来源见 KNOWLEDGE_ALLOW_LIST（${KNOWLEDGE_ALLOW_LIST.join(', ')}）。` +
          '个人数据（课表/余额/实名等）必须走受权限约束的工具实时读取，不得进入检索索引。',
      );
    }
  }
}
