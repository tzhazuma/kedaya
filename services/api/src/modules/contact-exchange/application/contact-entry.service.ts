/**
 * 联系方式交换 · 我的联系方式（用例层）
 *
 * 职责只有"维护可交换条目"：
 *   · 新建默认 `shared = false`（最小暴露）；
 *   · 值先规范化再校验，然后加密 + 带密钥指纹落库；
 *   · 只有本人能读写自己的条目（非本人一律 404，避免泄漏条目存在性）；
 *   · 返回 DTO 用允许清单投影，绝不把密文 / 指纹 / userId 带出去。
 */

import { Inject, Injectable } from '@nestjs/common';
import type { ContactEntryWire, Page } from '@kedaya/contracts';
import { ConflictError, NotFoundError, ValidationError } from '../../../common/errors/app-error';
import { parseTimeCursor } from './parse-cursor';
import {
  CONTACT_EXCHANGE_CIPHER,
  CONTACT_EXCHANGE_REPOSITORY,
  ContactExchangeRepositoryError,
  normalizeLabel,
  toContactEntryWire,
  validateContactValue,
  type ContactCryptoPort,
  type ContactEntryRecord,
  type ContactExchangeRepository,
} from '../domain/contact-exchange.domain';

export interface CreateContactEntryDto {
  kind: ContactEntryRecord['kind'];
  value: string;
  label?: string | null;
  shared?: boolean;
}

export interface UpdateContactEntryDto {
  value?: string;
  label?: string | null;
  shared?: boolean;
}

export interface ListContactEntriesQuery {
  cursor?: string;
  limit: number;
}

@Injectable()
export class ContactEntryService {
  constructor(
    @Inject(CONTACT_EXCHANGE_REPOSITORY) private readonly repo: ContactExchangeRepository,
    @Inject(CONTACT_EXCHANGE_CIPHER) private readonly cipher: ContactCryptoPort,
  ) {}

  async list(userId: string, query: ListContactEntriesQuery): Promise<Page<ContactEntryWire>> {
    const page = await this.repo.listEntries(userId, {
      cursor: parseTimeCursor(query.cursor),
      limit: query.limit,
    });

    return {
      items: page.items.map((row) => toContactEntryWire(row, this.cipher.decrypt(row.valueCipher))),
      nextCursor: page.nextCursor,
    };
  }

  async create(userId: string, input: CreateContactEntryDto): Promise<ContactEntryWire> {
    const validation = validateContactValue(input.kind, input.value);
    if (!validation.ok) throw new ValidationError(validation.message, { field: 'value' });

    const label = normalizeLabel(input.label);
    if (label !== null && label.length > 40) {
      throw new ValidationError('标签不能超过 40 个字符', { field: 'label' });
    }

    const fingerprint = this.cipher.fingerprint(input.kind, validation.value);
    const duplicate = await this.repo.findDuplicateEntry(userId, input.kind, fingerprint);
    if (duplicate) throw new ConflictError('该联系方式已存在，请直接修改已有条目');

    try {
      const row = await this.repo.createEntry({
        userId,
        kind: input.kind,
        label,
        valueCipher: this.cipher.encrypt(validation.value),
        valueFingerprint: fingerprint,
        // 默认不授权 —— 用户必须显式打开，才会出现在交换结果里。
        shared: input.shared ?? false,
      });
      return toContactEntryWire(row, validation.value);
    } catch (error) {
      if (error instanceof ContactExchangeRepositoryError && error.reason === 'DUPLICATE_CONTACT') {
        throw new ConflictError('该联系方式已存在，请直接修改已有条目');
      }
      throw error;
    }
  }

  async update(userId: string, id: string, input: UpdateContactEntryDto): Promise<ContactEntryWire> {
    const existing = await this.repo.findEntryById(id);
    // 非本人 → 404（不是 403）：不泄漏"这个 id 存在但属于别人"。
    if (!existing || existing.userId !== userId) throw new NotFoundError('联系方式条目不存在');

    const patch: {
      label?: string | null;
      shared?: boolean;
      valueCipher?: string;
      valueFingerprint?: string;
    } = {};
    let nextValue: string | null = null;

    if (input.value !== undefined) {
      const validation = validateContactValue(existing.kind, input.value);
      if (!validation.ok) throw new ValidationError(validation.message, { field: 'value' });

      const fingerprint = this.cipher.fingerprint(existing.kind, validation.value);
      if (fingerprint !== existing.valueFingerprint) {
        const duplicate = await this.repo.findDuplicateEntry(userId, existing.kind, fingerprint);
        if (duplicate && duplicate.id !== id) {
          throw new ConflictError('该联系方式已存在，请直接修改已有条目');
        }
      }
      patch.valueCipher = this.cipher.encrypt(validation.value);
      patch.valueFingerprint = fingerprint;
      nextValue = validation.value;
    }

    if (input.label !== undefined) {
      const label = normalizeLabel(input.label);
      if (label !== null && label.length > 40) {
        throw new ValidationError('标签不能超过 40 个字符', { field: 'label' });
      }
      patch.label = label;
    }

    if (input.shared !== undefined) patch.shared = input.shared;

    if (Object.keys(patch).length === 0) {
      throw new ValidationError('至少需要提供一个要修改的字段', {
        fields: ['value', 'label', 'shared'],
      });
    }

    try {
      const row = await this.repo.updateEntry(id, patch);
      return toContactEntryWire(row, nextValue ?? this.cipher.decrypt(row.valueCipher));
    } catch (error) {
      if (error instanceof ContactExchangeRepositoryError && error.reason === 'DUPLICATE_CONTACT') {
        throw new ConflictError('该联系方式已存在，请直接修改已有条目');
      }
      throw error;
    }
  }

  async remove(userId: string, id: string): Promise<{ id: string; deleted: true }> {
    const existing = await this.repo.findEntryById(id);
    if (!existing || existing.userId !== userId) throw new NotFoundError('联系方式条目不存在');

    // 硬删：删掉就不存在任何可读取的副本。已建立的交换协议仍在，
    // 但对方读取时只会看到剩余 `shared = true` 的条目（见 viewContacts）。
    await this.repo.deleteEntry(id);
    return { id, deleted: true };
  }
}
