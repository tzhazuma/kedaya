import { generateKeyPairSync, sign } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  GROUP_DRAFT_STATUS,
  canDecide,
  defaultDraftTitle,
  isTimestampFresh,
  normalizeQqGroupMessage,
  verifyQqSignature,
} from './group-bot.domain';

/**
 * 群机器人领域层。
 *
 * 这组测试的重心是**签名验证** —— 它是整个接入的安全边界。
 * 一个不验签的 webhook 就是一个任何人都能 POST 的写接口，
 * 伪造请求能往草稿箱灌垃圾甚至诱导内容。所以这里用**真实 Ed25519 密钥对**
 * 做正反验证，而不是 mock。
 */

function makeKeypair() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicKeyHex = publicKey.export({ type: 'spki', format: 'der' }).toString('hex');
  return { publicKeyHex, privateKey };
}

function signBody(privateKey: ReturnType<typeof makeKeypair>['privateKey'], timestamp: string, body: string): string {
  return sign(null, Buffer.from(timestamp + body, 'utf8'), privateKey).toString('hex');
}

describe('verifyQqSignature', () => {
  const body = JSON.stringify({ id: 'ROBOT1.0_abc', content: '出台灯' });
  const timestamp = String(Math.floor(Date.now() / 1000));

  it('合法签名通过', () => {
    const { publicKeyHex, privateKey } = makeKeypair();
    const signature = signBody(privateKey, timestamp, body);
    expect(verifyQqSignature({ rawBody: body, signature, timestamp, publicKeyHex })).toEqual({ ok: true });
  });

  it('⚠️ 篡改请求体后签名失败（这是这个函数存在的全部理由）', () => {
    const { publicKeyHex, privateKey } = makeKeypair();
    const signature = signBody(privateKey, timestamp, body);
    const tampered = body.replace('出台灯', '代考');

    const result = verifyQqSignature({
      rawBody: tampered,
      signature,
      timestamp,
      publicKeyHex,
    });
    expect(result.ok).toBe(false);
  });

  it('篡改时间戳后签名失败', () => {
    const { publicKeyHex, privateKey } = makeKeypair();
    const signature = signBody(privateKey, timestamp, body);
    const result = verifyQqSignature({
      rawBody: body,
      signature,
      timestamp: '1700000000',
      publicKeyHex,
    });
    expect(result.ok).toBe(false);
  });

  it('换了公钥后签名失败', () => {
    const a = makeKeypair();
    const b = makeKeypair();
    const signature = signBody(a.privateKey, timestamp, body);
    const result = verifyQqSignature({
      rawBody: body,
      signature,
      timestamp,
      publicKeyHex: b.publicKeyHex,
    });
    expect(result.ok).toBe(false);
  });

  it('⚠️ 未配置公钥时一律拒绝（fail closed）', () => {
    const { privateKey } = makeKeypair();
    const signature = signBody(privateKey, timestamp, body);
    const result = verifyQqSignature({ rawBody: body, signature, timestamp, publicKeyHex: '' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('公钥');
  });

  it('缺少签名头/时间戳头时拒绝', () => {
    const { publicKeyHex } = makeKeypair();
    expect(verifyQqSignature({ rawBody: body, signature: '', timestamp, publicKeyHex }).ok).toBe(false);
    expect(verifyQqSignature({ rawBody: body, signature: 'aa', timestamp: '', publicKeyHex }).ok).toBe(false);
  });

  it('签名不是 hex 时拒绝', () => {
    const { publicKeyHex } = makeKeypair();
    const result = verifyQqSignature({
      rawBody: body,
      signature: 'zzz-not-hex',
      timestamp,
      publicKeyHex,
    });
    expect(result.ok).toBe(false);
  });

  it('公钥格式无法解析时拒绝', () => {
    const result = verifyQqSignature({
      rawBody: body,
      signature: 'aabbccdd',
      timestamp,
      publicKeyHex: 'not-a-real-key',
    });
    expect(result.ok).toBe(false);
  });

  it('接受裸 32 字节公钥（补 SPKI 头）', () => {
    const { publicKeyHex, privateKey } = makeKeypair();
    // 去掉 12 字节 SPKI 头（302a300506032b6570032100）
    const rawKey = publicKeyHex.slice(24);
    const signature = signBody(privateKey, timestamp, body);
    expect(verifyQqSignature({ rawBody: body, signature, timestamp, publicKeyHex: rawKey })).toEqual({
      ok: true,
    });
  });
});

describe('isTimestampFresh', () => {
  const now = new Date('2026-10-18T12:00:00Z');

  it('当前时间通过', () => {
    expect(isTimestampFresh(String(Math.floor(now.getTime() / 1000)), now)).toBe(true);
  });

  it('5 分钟内通过', () => {
    const fourMinAgo = Math.floor((now.getTime() - 4 * 60 * 1000) / 1000);
    expect(isTimestampFresh(String(fourMinAgo), now)).toBe(true);
  });

  it('⚠️ 超过 5 分钟拒绝（挡旧签名重放）', () => {
    const oneHourAgo = Math.floor((now.getTime() - 60 * 60 * 1000) / 1000);
    expect(isTimestampFresh(String(oneHourAgo), now)).toBe(false);
  });

  it('非数字拒绝', () => {
    expect(isTimestampFresh('abc', now)).toBe(false);
  });
});

describe('normalizeQqGroupMessage', () => {
  const base = {
    id: 'ROBOT1.0_msg1',
    group_openid: 'grp-1',
    content: '出台灯 50 元 五号公寓',
    timestamp: '2026-10-18T10:00:00+08:00',
    message_type: 0,
    author: { member_openid: 'u-1', username: '张三', bot: false, member_role: 'member' },
  };

  it('正常文本消息被归一化', () => {
    const result = normalizeQqGroupMessage(base);
    expect(result).not.toBeNull();
    expect(result?.platformMessageId).toBe('ROBOT1.0_msg1');
    expect(result?.groupId).toBe('grp-1');
    expect(result?.text).toContain('台灯');
    expect(result?.platform).toBe('qq');
  });

  it('⚠️ 跳过机器人自己发的消息（否则会自激）', () => {
    const selfMessage = { ...base, author: { ...base.author, bot: true } };
    expect(normalizeQqGroupMessage(selfMessage)).toBeNull();
  });

  it('跳过空文本', () => {
    expect(normalizeQqGroupMessage({ ...base, content: '   ' })).toBeNull();
  });

  it('⚠️ 跳过非文本消息（图片不做 OCR）', () => {
    expect(normalizeQqGroupMessage({ ...base, message_type: 3 })).toBeNull();
  });

  it('缺 id / group_openid 时返回 null', () => {
    expect(normalizeQqGroupMessage({ ...base, id: '' })).toBeNull();
    expect(normalizeQqGroupMessage({ ...base, group_openid: '' })).toBeNull();
  });

  it('畸形输入不抛异常', () => {
    expect(normalizeQqGroupMessage(null)).toBeNull();
    expect(normalizeQqGroupMessage('string')).toBeNull();
    expect(normalizeQqGroupMessage(42)).toBeNull();
    expect(normalizeQqGroupMessage({})).toBeNull();
  });

  it('不保留发送者的昵称（只留 OpenID 供去重）', () => {
    const result = normalizeQqGroupMessage(base);
    expect(result?.senderRef).toBe('u-1');
    // 昵称不进对象 —— 昵称是个人信息，草稿不需要它
    expect(JSON.stringify(result)).not.toContain('张三');
  });
});

describe('canDecide', () => {
  it('只有 pending 能被处理', () => {
    expect(canDecide(GROUP_DRAFT_STATUS.pending)).toBe(true);
    expect(canDecide(GROUP_DRAFT_STATUS.approved)).toBe(false);
    expect(canDecide(GROUP_DRAFT_STATUS.rejected)).toBe(false);
  });
});

describe('defaultDraftTitle', () => {
  it('取首行并截断', () => {
    expect(defaultDraftTitle('出台灯 50 元\n五号公寓')).toBe('出台灯 50 元');
  });

  it('超长截断到上限', () => {
    const title = defaultDraftTitle('长'.repeat(100), 20);
    expect(title.length).toBeLessThanOrEqual(21);
    expect(title.endsWith('…')).toBe(true);
  });

  it('空输入返回空串而不是抛', () => {
    expect(defaultDraftTitle('')).toBe('');
  });
});
