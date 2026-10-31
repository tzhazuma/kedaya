import { describe, expect, it } from 'vitest';

import {
  TTS_ERROR_CODES,
  TTS_ERROR_MESSAGES,
  TTS_SAMPLE_RATE,
  TTS_SPEED_MAX,
  TTS_SPEED_MIN,
  TTS_TEXT_MAX,
  splitForTts,
  ttsAudioUrl,
  validateTtsRequest,
} from './tts';

/**
 * 朗读契约的纯函数。
 *
 * ## 重心
 *
 * 1. `splitForTts` **只在自然边界断开** —— 把词切成两半会让朗读听起来像结巴
 * 2. `validateTtsRequest` 的每个错误码都能被触发
 * 3. 每个错误码都有**可执行**的中文提示（尤其是「模型未安装」要告诉运维跑什么命令）
 */
describe('splitForTts —— 长文切段', () => {
  it('短文本原样返回', () => {
    expect(splitForTts('你好')).toEqual(['你好']);
  });

  it('空文本返回空数组', () => {
    expect(splitForTts('')).toEqual([]);
    expect(splitForTts('   ')).toEqual([]);
  });

  it('⚠️ 优先在句末标点断开，不在词中间切', () => {
    const sentence = '这是一句完整的话。';
    const text = sentence.repeat(10); // 90 字
    const chunks = splitForTts(text, 30);
    expect(chunks.length).toBeGreaterThan(1);
    // 每一段（除最后一段）都应以句号结尾 —— 说明在句子边界断开
    for (const chunk of chunks.slice(0, -1)) {
      expect(chunk.endsWith('。'), `chunk=${chunk}`).toBe(true);
    }
    // 拼回去等于原文
    expect(chunks.join('')).toBe(text);
  });

  it('没有句末标点时退到逗号', () => {
    const text = '第一段内容，第二段内容，第三段内容，第四段内容';
    const chunks = splitForTts(text, 12);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks.slice(0, -1)) {
      expect(chunk.endsWith('，'), `chunk=${chunk}`).toBe(true);
    }
  });

  it('完全没有标点时硬切，但不丢字', () => {
    const text = '啊'.repeat(100);
    const chunks = splitForTts(text, 30);
    expect(chunks.join('')).toBe(text);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(30);
  });

  it('每段都不超过上限', () => {
    const text = '句子。'.repeat(200);
    for (const max of [10, 50, 200]) {
      const chunks = splitForTts(text, max);
      for (const chunk of chunks) {
        expect(chunk.length, `max=${max}`).toBeLessThanOrEqual(max);
      }
    }
  });

  it('默认上限就是契约里的 TTS_TEXT_MAX', () => {
    const text = '好'.repeat(TTS_TEXT_MAX + 50);
    const chunks = splitForTts(text);
    expect(chunks.length).toBe(2);
    expect(chunks[0]?.length).toBeLessThanOrEqual(TTS_TEXT_MAX);
  });

  it('⚠️ 不在英文单词中间切（否则会读成两个字母）', () => {
    // "RTF" 被切成 "RT" + "F" 会读成「啊提艾弗」
    const text = `${'内容'.repeat(20)} RTF ${'内容'.repeat(20)}`;
    const chunks = splitForTts(text, 45);
    // 至少有一个 chunk 包含完整的 RTF，或者空格是断点
    const joined = chunks.join('');
    expect(joined).toContain('RTF');
    // 不应出现某个 chunk 以 'RT' 结尾且下一个以 'F' 开头
    for (let i = 0; i < chunks.length - 1; i += 1) {
      const a = chunks[i] ?? '';
      const b = chunks[i + 1] ?? '';
      expect(a.endsWith('RT') && b.startsWith('F')).toBe(false);
    }
  });
});

describe('validateTtsRequest', () => {
  it('合法请求返回 null', () => {
    expect(validateTtsRequest('测试文本', undefined)).toBeNull();
    expect(validateTtsRequest('测试文本', 1.5)).toBeNull();
    expect(validateTtsRequest('测试文本', TTS_SPEED_MIN)).toBeNull();
    expect(validateTtsRequest('测试文本', TTS_SPEED_MAX)).toBeNull();
  });

  it('空文本 → text-empty', () => {
    expect(validateTtsRequest('', undefined)).toBe('text-empty');
    expect(validateTtsRequest('   ', undefined)).toBe('text-empty');
  });

  it('超长 → text-too-long', () => {
    expect(validateTtsRequest('好'.repeat(TTS_TEXT_MAX + 1), undefined)).toBe('text-too-long');
    // 边界：正好等于上限是合法的
    expect(validateTtsRequest('好'.repeat(TTS_TEXT_MAX), undefined)).toBeNull();
  });

  it('语速越界 → speed-out-of-range', () => {
    expect(validateTtsRequest('测试', TTS_SPEED_MIN - 0.01)).toBe('speed-out-of-range');
    expect(validateTtsRequest('测试', TTS_SPEED_MAX + 0.01)).toBe('speed-out-of-range');
    expect(validateTtsRequest('测试', Number.NaN)).toBe('speed-out-of-range');
    expect(validateTtsRequest('测试', Number.POSITIVE_INFINITY)).toBe('speed-out-of-range');
  });
});

describe('错误码与文案', () => {
  it('每个错误码都有非空中文提示', () => {
    for (const code of TTS_ERROR_CODES) {
      expect(TTS_ERROR_MESSAGES[code].length).toBeGreaterThan(5);
    }
    const texts = TTS_ERROR_CODES.map((c) => TTS_ERROR_MESSAGES[c]);
    expect(new Set(texts).size).toBe(TTS_ERROR_CODES.length);
  });

  it('⚠️「模型未安装」的提示要能直接指导运维行动', () => {
    const msg = TTS_ERROR_MESSAGES['model-unavailable'];
    // 必须说清这是部署问题，且给出具体命令
    expect(msg).toContain('部署问题');
    expect(msg).toContain('fetch-tts-model');
  });

  it('⚠️「模型未安装」不能说成网络问题', () => {
    const msg = TTS_ERROR_MESSAGES['model-unavailable'];
    // 让用户去检查自己的网是误导
    expect(msg).not.toContain('网络');
  });
});

describe('其它', () => {
  it('ttsAudioUrl 拼出正确路径', () => {
    expect(ttsAudioUrl('abc123')).toBe('/api/v1/tts/audio/abc123');
  });

  it('采样率是模型固定值', () => {
    expect(TTS_SAMPLE_RATE).toBe(22050);
  });
});
