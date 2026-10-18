import { Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { modulePath } from '@kedaya/contracts';
import { z } from 'zod';
import { OptionalAuthGuard } from '../../common/auth/auth.guard';
import { OptionalCurrentUser } from '../../common/auth/current-user';
import { ZodBody } from '../../common/pipes/zod-validation.pipe';
import { AgentService } from './agent.service';

/**
 * 可达鸭 agent（**全局可用**的唯一入口）。
 *
 * 为什么是 `OptionalAuthGuard` 而不是 `AuthGuard`：
 *   · 匿名用户也能问"课表怎么同步""拼单怎么发起"（公共知识，不需要身份）；
 *   · 一旦问题涉及"我的数据"，工具层会明确拒答并引导登录 ——
 *     权限判断发生在**工具层**，而不是靠"要不要放行这个请求"一刀切。
 *   这样既不会因为没登录就把 agent 整个关掉，也不会用别人的数据兜底。
 */
const chatSchema = z.object({
  question: z.string().min(1, '问题不能为空').max(300, '问题太长了，请精简到 300 字以内'),
  /** 当前页面路径（如 `/presentation/pages/schedule/index`），用于上下文加权 */
  page: z.string().max(200).optional(),
  /** 当前模块 id（契约 §4） */
  module: z.string().max(60).optional(),
});

@ApiTags('agent · 可达鸭（全局助手）')
@Controller(modulePath('agent'))
@UseGuards(OptionalAuthGuard)
export class AgentController {
  constructor(private readonly service: AgentService) {}

  @Post('chat')
  @ApiOperation({
    summary: '问可达鸭（事实优先：先用受权限约束的工具取数，再组织语言）',
    description:
      '匿名可用，但涉及个人数据的工具会明确要求登录（不会用他人数据兜底）。' +
      '未配置大模型时使用规则回答（`usedModel: null`）；模型失败会自动降级并置 `degraded: true`。' +
      '每条回答都带 `sources`（可追溯）与 `actions`（可直接跳转）。',
  })
  chat(@OptionalCurrentUser() userId: string | undefined, @ZodBody(chatSchema) body: z.infer<typeof chatSchema>) {
    return this.service.chat(
      {
        question: body.question,
        ...(body.page === undefined ? {} : { page: body.page }),
        ...(body.module === undefined ? {} : { module: body.module }),
      },
      userId ?? null,
    );
  }

  @Get('suggestions')
  @ApiOperation({
    summary: '建议问题（随当前页面变化）—— "打开就知道能问什么"',
  })
  suggestions(@Query('page') page?: string, @Query('module') module?: string) {
    return { items: this.service.suggestions(page, module) };
  }

  @Get('capabilities')
  @ApiOperation({
    summary: 'agent 能力清单（含"哪些内容没有进检索索引"，如实告知）',
  })
  capabilities() {
    return this.service.capabilities();
  }
}
