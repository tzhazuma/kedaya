/**
 * 联系方式交换 · 审计查询（用例层）
 *
 * 用户只能查两个方向：
 *   · `inbound`  —— 谁看过我的联系方式（subjectId = 我）；
 *   · `outbound` —— 我看过谁的联系方式（actorId = 我）。
 *
 * 返回 DTO 逐字段白名单投影，**不**包含联系方式值、密文或指纹。
 */

import { Inject, Injectable } from '@nestjs/common';
import type { ContactAuditDirection, ContactAccessAuditWire, Page } from '@kedaya/contracts';
import { parseTimeCursor } from './parse-cursor';
import {
  CONTACT_EXCHANGE_REPOSITORY,
  toContactAccessAuditWire,
  type ContactExchangeRepository,
} from '../domain/contact-exchange.domain';

export interface ListContactAuditQuery {
  direction: ContactAuditDirection;
  cursor?: string;
  limit: number;
}

@Injectable()
export class ContactAuditService {
  constructor(
    @Inject(CONTACT_EXCHANGE_REPOSITORY) private readonly repo: ContactExchangeRepository,
  ) {}

  async list(userId: string, query: ListContactAuditQuery): Promise<Page<ContactAccessAuditWire>> {
    const page = await this.repo.listAudit(userId, {
      direction: query.direction,
      cursor: parseTimeCursor(query.cursor),
      limit: query.limit,
    });

    return {
      items: page.items.map(toContactAccessAuditWire),
      nextCursor: page.nextCursor,
    };
  }
}
