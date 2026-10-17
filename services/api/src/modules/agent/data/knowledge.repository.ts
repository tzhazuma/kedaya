import { Inject, Injectable } from '@nestjs/common';
import { MODULES } from '@kedaya/contracts';
import { PrismaService } from '../../../prisma/prisma.service';
import type { KnowledgeDoc, KnowledgePort } from '../domain/agent.domain';
import { BUILTIN_GUIDES } from './builtin-knowledge';

/**
 * 检索语料库（data 层）。
 *
 * 三路合并，**全部来自公开内容**，与 `KNOWLEDGE_ALLOW_LIST` 一一对应：
 *   1. `contracts:MODULES`  —— 冻结契约 §4 的模块定义（永久唯一真相，不会过期）；
 *   2. `builtin:guides`     —— 仓库内置使用指南（随版本发布，空库也可用）；
 *   3. `table:FaqEntry`     —— 帮助中心的 FAQ（运营可在后台维护）。
 *
 * 可用性：数据库读失败时**只丢第 3 路**，前两路照常返回 ——
 * agent 绝不能因为一个辅助表读不到就整个变哑巴。
 */
@Injectable()
export class KnowledgeRepository implements KnowledgePort {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async all(): Promise<KnowledgeDoc[]> {
    const faq = await this.loadFaq();
    return [...moduleDocs(), ...BUILTIN_GUIDES, ...faq];
  }

  private async loadFaq(): Promise<KnowledgeDoc[]> {
    try {
      const rows = await this.prisma.faqEntry.findMany({
        orderBy: { updatedAt: 'desc' },
        take: 500,
      });
      return rows.map((row) => ({
        id: `faq:${row.id}`,
        title: row.question,
        // 分类与标签拼进正文：用户常按"课表 打不开"这类词搜索，标签能提高命中率
        body:
          `${row.answer}` +
          `（分类：${row.category}${row.tags.length > 0 ? `；标签：${row.tags.join('、')}` : ''}）`,
        // FaqEntry 用的是自由文本 `category`；若它恰好等于模块 id 就建立关联以获得加权
        module: MODULE_IDS.has(row.category) ? row.category : null,
        kind: 'faq' as const,
        updatedAt: row.updatedAt.toISOString(),
      }));
    } catch {
      return [];
    }
  }
}

const MODULE_IDS = new Set(MODULES.map((module) => module.id));

/** 契约里的模块定义 → 可检索文档（用户问"XX 是干嘛的"时直接命中） */
function moduleDocs(): KnowledgeDoc[] {
  return MODULES.map((module) => ({
    id: `module:${module.id}`,
    title: `${module.nameZh} · ${module.nameEn}`,
    body:
      `${module.summary}。` +
      `敏感级：${sensitivityLabel(module.sensitivity)}` +
      (module.requiresConsent ? '，进入前需要单独同意' : '，登录即视为同意，不叠加二次同意门') +
      `。接口前缀：/api/v1/${module.route}。` +
      (module.category === 'core' ? '这是基础能力模块。' : '这是业务模块。'),
    module: module.id,
    kind: 'module' as const,
    updatedAt: null,
  }));
}

function sensitivityLabel(sensitivity: string): string {
  switch (sensitivity) {
    case 'critical':
      return '极高敏感';
    case 'high':
      return '高敏感';
    case 'medium':
      return '中敏感';
    default:
      return '低敏感';
  }
}
