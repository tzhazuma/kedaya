import { describe, expect, it } from 'vitest';

import {
  LOW_CONFIDENCE_THRESHOLD,
  classifyKind,
  extractContact,
  extractLocation,
  extractPriceFen,
  extractTitle,
  parseGroupImport,
  splitMessages,
} from './group-import';

/**
 * 群消息导入解析器。
 *
 * 这组测试锁的不是「能跑」，而是**三条产品底线**：
 *   1. 抽不到就是 null，**绝不估**（估价会让用户以为是真的）；
 *   2. 每条都要能说出来源（evidence），用户才能核对；
 *   3. 类型判定不能把「求拼单」判成「出售」。
 */

describe('extractPriceFen', () => {
  it('识别常见价格写法', () => {
    expect(extractPriceFen('出台灯 50 元')).toBe(5000);
    expect(extractPriceFen('¥50')).toBe(5000);
    expect(extractPriceFen('50块')).toBe(5000);
    expect(extractPriceFen('50r')).toBe(5000);
    expect(extractPriceFen('0.5 元')).toBe(50);
    expect(extractPriceFen('1.5w')).toBe(1500000);
  });

  it('⚠️ 抽不到就返回 null，不估', () => {
    expect(extractPriceFen('出一台台灯，有意私聊')).toBeNull();
    expect(extractPriceFen('看上的话价格好商量')).toBeNull();
    expect(extractPriceFen('')).toBeNull();
  });

  it('拒绝负数与非法值', () => {
    expect(extractPriceFen('-50 元')).toBeNull();
  });
});

describe('extractContact', () => {
  it('优先手机号', () => {
    expect(extractContact('电话 13812345678')).toBe('13812345678');
  });

  it('识别微信与 QQ', () => {
    expect(extractContact('微信 abcdef123')).toBe('微信 abcdef123');
    expect(extractContact('QQ 123456789')).toBe('QQ 123456789');
  });

  it('⚠️ 抽不到返回 null', () => {
    expect(extractContact('私聊我')).toBeNull();
    expect(extractContact('联系我')).toBeNull();
  });

  it('不把普通数字当联系方式', () => {
    // 「公寓 5 号」不是 QQ 号
    expect(extractContact('五号公寓 5 号')).toBeNull();
  });
});

describe('extractLocation', () => {
  it('识别校园地点', () => {
    expect(extractLocation('在五号公寓楼下')).toBe('五号公寓');
    expect(extractLocation('张江校区')).toBe('张江');
    expect(extractLocation('白玉兰门口')).toBe('白玉兰');
  });

  it('抽不到返回 null', () => {
    expect(extractLocation('有意私聊')).toBeNull();
  });
});

describe('classifyKind', () => {
  it('拼单优先于买卖（「求拼单」含「求」）', () => {
    expect(classifyKind('求拼单，一起买咖啡豆').kind).toBe('groupbuy');
  });

  it('跑腿独立识别', () => {
    expect(classifyKind('有偿代取快递，五号公寓').kind).toBe('errand');
  });

  it('出售与求购', () => {
    expect(classifyKind('出售二手台灯').kind).toBe('sell');
    expect(classifyKind('求购自行车').kind).toBe('buy');
  });

  it('⚠️ 单字「出」「收」不能误判常见词', () => {
    // 「出来」「收到」不是出售/求购
    expect(classifyKind('刚收到通知，出来说一下').kind).toBe('other');
  });

  it('识别不到时返回 other 且无 evidence', () => {
    const { kind, evidence } = classifyKind('大家好');
    expect(kind).toBe('other');
    expect(evidence).toBeNull();
  });
});

describe('splitMessages', () => {
  it('按空行切分并剥掉「昵称 + 时间」头', () => {
    const text = `张三 12:30
出台灯 50 元

李四 12:35
求购自行车`;
    const parts = splitMessages(text);
    expect(parts).toHaveLength(2);
    expect(parts[0]).toBe('出台灯 50 元');
    expect(parts[1]).toBe('求购自行车');
  });

  it('保留多行内容', () => {
    const text = `王五 08:00
出台灯 50 元
五号公寓
微信 abc123456`;
    expect(splitMessages(text)[0]).toContain('五号公寓');
  });

  it('空文本返回空数组', () => {
    expect(splitMessages('')).toEqual([]);
    expect(splitMessages('   \n\n   ')).toEqual([]);
  });
});

describe('extractTitle', () => {
  it('剥掉价格与联系方式', () => {
    const title = extractTitle('出台灯 50 元 微信 abc123456');
    expect(title).not.toContain('50');
    expect(title).not.toContain('abc123456');
    expect(title).toContain('台灯');
  });

  it('超长标题截断到 40 字', () => {
    const title = extractTitle('出'.repeat(100));
    expect(title.length).toBeLessThanOrEqual(41);
    expect(title.endsWith('…')).toBe(true);
  });
});

describe('parseGroupImport（端到端）', () => {
  const SAMPLE = `张三 12:30
出二手台灯 50 元，五号公寓楼下，微信 abc123456

李四 12:35
求购自行车，预算 200 元，QQ 123456789

王五 12:40
有人拼单买咖啡豆吗，一起买能包邮

赵六 12:45
有偿代取快递，三号公寓，13812345678`;

  it('切出 4 条候选', () => {
    const candidates = parseGroupImport(SAMPLE);
    expect(candidates).toHaveLength(4);
    expect(candidates.map((c) => c.kind)).toEqual(['sell', 'buy', 'groupbuy', 'errand']);
  });

  it('每条都抽出了可用的价格/地点/联系方式', () => {
    const [sell, buy, , errand] = parseGroupImport(SAMPLE);
    expect(sell?.priceFen).toBe(5000);
    expect(sell?.location).toBe('五号公寓');
    expect(sell?.contact).toBe('微信 abc123456');

    expect(buy?.priceFen).toBe(20000);
    expect(buy?.contact).toBe('QQ 123456789');

    expect(errand?.location).toBe('三号公寓');
    expect(errand?.contact).toBe('13812345678');
  });

  it('⚠️ 每条都带 evidence，且覆盖到已填字段', () => {
    for (const candidate of parseGroupImport(SAMPLE)) {
      expect(candidate.evidence.length).toBeGreaterThan(0);
      // 有价格的必须有 price 依据
      if (candidate.priceFen !== null) {
        expect(candidate.evidence.some((e) => e.field === 'price')).toBe(true);
      }
      if (candidate.kind !== 'other') {
        expect(candidate.evidence.some((e) => e.field === 'kind')).toBe(true);
      }
    }
  });

  it('保留原文供用户核对', () => {
    for (const candidate of parseGroupImport(SAMPLE)) {
      expect(candidate.rawText.length).toBeGreaterThan(0);
      expect(SAMPLE).toContain(candidate.rawText);
    }
  });

  it('识别不出类型时置信度低于阈值', () => {
    const [candidate] = parseGroupImport('大家好呀');
    expect(candidate?.kind).toBe('other');
    expect(candidate?.confidence).toBeLessThan(LOW_CONFIDENCE_THRESHOLD);
  });

  it('信息齐全的条目置信度高', () => {
    const [candidate] = parseGroupImport(SAMPLE);
    expect(candidate?.confidence).toBeGreaterThanOrEqual(LOW_CONFIDENCE_THRESHOLD);
  });

  it('id 稳定且唯一（可做列表 key）', () => {
    const ids = parseGroupImport(SAMPLE).map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('空输入返回空数组，不抛', () => {
    expect(parseGroupImport('')).toEqual([]);
  });
});
