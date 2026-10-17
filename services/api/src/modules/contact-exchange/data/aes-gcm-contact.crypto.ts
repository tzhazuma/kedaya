/**
 * 联系方式交换 · 加密适配器（data 层）
 *
 * ## 为什么单独一层
 *
 * domain 只声明 `ContactCryptoPort`（纯接口），本文件是唯一碰 Node crypto +
 * `CONTACT_EXCHANGE_ENC_KEY` 的地方。好处：
 *   · 加密/解密可以替换（将来接 KMS）而不动状态机与用例；
 *   · 密钥缺失的失败点在**模块实例化**，不是第一次写入时 —— 应用起不来，
 *     不会出现"线上跑了三天才发现联系方式是明文"。
 *
 * ## 密钥约定（与 techpie 的 `CampusSession` 一致）
 *
 *   · 环境变量 `CONTACT_EXCHANGE_ENC_KEY`，**没有默认值**；
 *   · 64 位 hex（32 字节）或 base64（解码后 32 字节）；
 *   · 缺失 / 长度不对 → 构造抛错 → Nest 启动失败（fail closed）。
 *
 * ## 指纹为什么是 HMAC 而不是 `fingerprintSecret`
 *
 * 手机号是**低熵**输入（11 位、前缀有限）。裸 SHA-256 可以在几分钟内被
 * 彩虹表反查，等于把明文写进数据库。这里用密钥做 HMAC-SHA256：
 * 没有密钥就无法离线反查；同一个号码在不同部署里指纹也不同。
 */

import { createHmac } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CONTACT_EXCHANGE_ENC_KEY_ENV, type ContactKind } from '@kedaya/contracts';
import { decryptSecret, encryptSecret } from '../../../common/crypto/secret-box';
import type { ContactCryptoPort } from '../domain/contact-exchange.domain';

const KEY_BYTES = 32;

/** 解析并校验密钥；返回值只在本类内部使用，不进日志。 */
function parseKeyBytes(raw: string): Buffer {
  const trimmed = raw.trim();
  const isHex = /^[0-9a-fA-F]{64}$/.test(trimmed);
  const bytes = Buffer.from(trimmed, isHex ? 'hex' : 'base64');

  if (bytes.length !== KEY_BYTES) {
    // 错误信息只说明"长度不对"，不回显密钥内容
    throw new Error(
      `${CONTACT_EXCHANGE_ENC_KEY_ENV} 必须是 ${KEY_BYTES} 字节（64 位 hex 或 base64）：联系方式加密无法启动`,
    );
  }
  return bytes;
}

@Injectable()
export class AesGcmContactCrypto implements ContactCryptoPort {
  private readonly key: string;
  private readonly keyBytes: Buffer;

  constructor(@Inject(ConfigService) config: ConfigService) {
    const raw = config.get<string>(CONTACT_EXCHANGE_ENC_KEY_ENV);
    if (!raw || raw.trim().length === 0) {
      // 注意：这里**绝不**提供默认值 / 回退到 JWT_SECRET。
      throw new Error(
        `${CONTACT_EXCHANGE_ENC_KEY_ENV} 未配置：联系方式必须加密落库，缺失密钥时应用拒绝启动`,
      );
    }
    this.keyBytes = parseKeyBytes(raw);
    this.key = raw.trim();
  }

  encrypt(plaintext: string): string {
    return encryptSecret(plaintext, this.key);
  }

  decrypt(payload: string): string {
    return decryptSecret(payload, this.key);
  }

  fingerprint(kind: ContactKind, value: string): string {
    return createHmac('sha256', this.keyBytes).update(`${kind}:${value}`).digest('hex');
  }
}
