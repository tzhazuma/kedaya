import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AgentController } from './agent.controller';
import { AgentService } from './agent.service';
import { AgentToolsService } from './agent-tools.service';
import { KnowledgeService } from './knowledge.service';
import { KnowledgeRepository } from './data/knowledge.repository';
import { OpenAiCompatibleLlmAdapter } from './data/openai-compatible-llm.adapter';
import { AGENT_LLM_PORT, KNOWLEDGE_PORT } from './domain/agent.domain';
import { AuthModule } from '../auth/auth.module';
import { CampusCardModule } from '../campus-card/campus-card.module';
import { ProfileModule } from '../profile/profile.module';
import { ScheduleModule } from '../schedule/schedule.module';

/**
 * 可达鸭 agent 模块。
 *
 * 依赖方向：agent **依赖**各业务模块的用例层（课表 / 校园卡 / 隐私 / 身份），
 * 反过来没有任何模块依赖 agent —— 这是刻意的：
 *   · agent 是"最后一公里的组织层"，它出问题时**不该**影响任何业务模块；
 *   · 各模块不需要知道 agent 存在（也就没法把 agent 变成隐藏依赖）。
 *
 * 两个端口：
 *   KNOWLEDGE_PORT —— 检索语料（白名单：契约模块说明 / 内置指南 / FAQ）
 *   AGENT_LLM_PORT —— 可选的大模型；**未配置时注入 null**，agent 走规则回答。
 *                     这样"没有 API key 的环境"也不会启动失败。
 */
@Module({
  imports: [AuthModule, ScheduleModule, CampusCardModule, ProfileModule],
  controllers: [AgentController],
  providers: [
    AgentService,
    AgentToolsService,
    KnowledgeService,
    { provide: KNOWLEDGE_PORT, useClass: KnowledgeRepository },
    {
      provide: AGENT_LLM_PORT,
      inject: [ConfigService],
      useFactory: (config: ConfigService): OpenAiCompatibleLlmAdapter | null => {
        const baseUrl = config.get<string>('AGENT_LLM_BASE_URL');
        const apiKey = config.get<string>('AGENT_LLM_API_KEY');
        // 只配一半也算"没配"：宁可规则回答，也不要每轮都去撞一个必然失败的请求
        return baseUrl !== undefined && baseUrl !== '' && apiKey !== undefined && apiKey !== ''
          ? new OpenAiCompatibleLlmAdapter(config)
          : null;
      },
    },
  ],
  exports: [AgentService],
})
export class AgentModule {}
