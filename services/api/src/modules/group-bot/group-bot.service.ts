import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { ForbiddenError, NotFoundError, ValidationError } from '../../common/errors/app-error';
import {
  GROUP_DRAFT_STATUS,
  canDecide,
  defaultDraftTitle,
  isTimestampFresh,
  normalizeQqGroupMessage,
  verifyQqSignature,
} from './domain/group-bot.domain';
import type { NormalizedGroupMessage } from './domain/group-bot.domain';
import { GROUP_DRAFT_REPOSITORY } from './domain/group-bot.repository';
import type { GroupDraftRepository } from './domain/group-bot.repository';
import { GROUP_BOT_ENV } from '@kedaya/contracts';
import { parseGroupImport } from '@kedaya/shared';

/**
 * 群机器人接入服务。
 *
 * ## 为什么官方通道可用（更正此前的判断）
 *
 * [QQ 机器人官方 API v2](https://bot.q.qq.com/wiki/develop/api-v2/) 的
 * `GROUP_MESSAGE_CREATE`「群消息（全量模式）」明确支持：机器人开启"接收所有消息"后，
 * **群里每一条消息（不限于@机器人）**都会推送。这是官方支持、可长期运行的路径。
 *
 * ## 本服务的职责边界
 *
 * 1. **验签是第一步，不可跳过**。不验签的 webhook 就是一个任何人都能 POST 的写接口。
 * 2. **只落草稿，不自动发布**。群消息可能不准确/已过期/不是发布者本人想转载；
 *    由管理员确认后才进平台。
 * 3. **不存发送者身份**。只留 `member_openid` 做去重，昵称/QQ 号不落库。
 * 4. **只处理文本**。图片不做 OCR（宁可让人自己补），链接只留 URL。
 */
@Injectable()
export class GroupBotService {
  constructor(
    @Inject(GROUP_DRAFT_REPOSITORY) private readonly repository: GroupDraftRepository,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {}

  /**
   * 处理 QQ 回调。
   *
   * @param rawBody 原始请求体**字符串**（不能是解析后的对象 —— 重新序列化会改变字节导致验签失败）
   */
  async handleQqWebhook(input: {
    rawBody: string;
    signature: string;
    timestamp: string;
  }): Promise<{ ok: true; accepted: boolean }> {
    // 接入是**显式动作**：没开就不处理（避免误配了公钥就被动接收数据）
    if (this.config.get<string>(GROUP_BOT_ENV.enabled) !== 'true') {
      throw new ForbiddenError('群机器人接入未启用');
    }

    const publicKeyHex = this.config.get<string>(GROUP_BOT_ENV.qqPublicKey) ?? '';

    const signatureResult = verifyQqSignature({
      rawBody: input.rawBody,
      signature: input.signature,
      timestamp: input.timestamp,
      publicKeyHex,
    });
    if (!signatureResult.ok) {
      throw new ForbiddenError(`回调验签失败：${signatureResult.reason}`);
    }

    if (!isTimestampFresh(input.timestamp)) {
      throw new ForbiddenError('回调时间戳过期');
    }

    let payload: unknown;
    try {
      payload = JSON.parse(input.rawBody);
    } catch {
      throw new ValidationError('回调体不是合法 JSON');
    }

    const message = normalizeQqGroupMessage(payload);
    // 不该处理的事件（机器人自己发的 / 空文本 / 非文本）—— 返回 200 让平台别重试
    if (message === null) return { ok: true, accepted: false };

    await this.storeDraft(message);
    return { ok: true, accepted: true };
  }

  /** 归一化消息 → 草稿。幂等：同一平台消息重复投递只落一条。 */
  private async storeDraft(message: NormalizedGroupMessage): Promise<void> {
    const existing = await this.repository.findByPlatformMessage(
      message.platform,
      message.platformMessageId,
    );
    if (existing !== null) return; // 平台重试，已落库

    const parsed = parseGroupImport(message.text);

    await this.repository.create({
      platform: message.platform,
      groupId: message.groupId,
      platformMessageId: message.platformMessageId,
      senderRef: message.senderRef,
      rawText: message.text,
      candidates: parsed.map((candidate) => ({
        kind: candidate.kind,
        title: candidate.title.length > 0 ? candidate.title : defaultDraftTitle(message.text),
        priceFen: candidate.priceFen,
        contact: candidate.contact,
        location: candidate.location,
        confidence: candidate.confidence,
        evidence: candidate.evidence.map((item) => ({
          field: item.field,
          reason: item.reason,
        })),
      })),
      status: GROUP_DRAFT_STATUS.pending,
    });
  }

  /** 待确认列表（管理员用） */
  list(input: { cursor: string | null; limit: number; status?: string }) {
    return this.repository.list(input);
  }

  /**
   * 处理一条草稿。
   *
   * ⚠️ **只改状态，不自动创建平台条目** —— 真正发布要显式调用对应模块的接口。
   * 这样"确认"与"发布"是两个可审计的动作，而不是一个隐式副作用。
   */
  async decide(input: {
    id: string;
    decision: 'approved' | 'rejected';
    note?: string;
  }): Promise<void> {
    const draft = await this.repository.findById(input.id);
    if (draft === null) throw new NotFoundError('草稿不存在');
    if (!canDecide(draft.status)) {
      throw new ValidationError('这条草稿已经处理过了');
    }
    await this.repository.decide({
      id: input.id,
      status: input.decision,
      note: input.note ?? null,
      decidedAt: new Date(),
    });
  }
}
