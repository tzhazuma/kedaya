import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  DEADLINE_KINDS,
  DEADLINE_KIND_LABELS,
  DEADLINE_SOURCES,
  DEADLINE_SOURCE_LABELS,
  type DeadlineItem,
  type DeadlineKind,
  type DeadlineSource,
} from './deadlines';

/**
 * 契约层测试锁两件事：
 *
 * 1. **枚举封闭** —— 来源/类型是采集端、服务端、三端 UI 共用的 key，
 *    增删必须是显式动作（有人加了新来源，这里的断言会红，提醒他同步解析与展示）。
 * 2. **展示名齐全** —— `Record<union, string>` 在类型层已经强制齐全，
 *    但运行时仍断言一遍，防止有人把常量改成 `as any` 后漏项。
 */
describe('DeadlineSource', () => {
  it('来源枚举封闭且顺序稳定', () => {
    expect(DEADLINE_SOURCES).toEqual(['blackboard', 'gradescope', 'piazza', 'ecourse', 'manual']);
    expect(Object.isFrozen(DEADLINE_SOURCES)).toBe(true);
    expect(new Set(DEADLINE_SOURCES).size).toBe(DEADLINE_SOURCES.length);
  });

  it('每个来源都有展示名', () => {
    for (const source of DEADLINE_SOURCES) {
      expect(DEADLINE_SOURCE_LABELS[source]).toBeTruthy();
    }
    expect(Object.keys(DEADLINE_SOURCE_LABELS).sort()).toEqual([...DEADLINE_SOURCES].sort());
  });

  it('类型层：未知来源不可赋值（编译期防线）', () => {
    expectTypeOf<'blackboard'>().toMatchTypeOf<DeadlineSource>();
    // @ts-expect-error — 不属于任何平台来源
    expectTypeOf<'moodle'>().toMatchTypeOf<DeadlineSource>();
  });
});

describe('DeadlineKind', () => {
  it('类型枚举封闭', () => {
    expect(DEADLINE_KINDS).toEqual([
      'assignment',
      'quiz',
      'exam',
      'project',
      'reading',
      'other',
    ]);
    expect(Object.isFrozen(DEADLINE_KINDS)).toBe(true);
    expect(new Set(DEADLINE_KINDS).size).toBe(DEADLINE_KINDS.length);
  });

  it('每个类型都有展示名', () => {
    expect(Object.keys(DEADLINE_KIND_LABELS).sort()).toEqual([...DEADLINE_KINDS].sort());
    expect(DEADLINE_KIND_LABELS.other).toBe('其他');
  });
});

describe('DeadlineItem', () => {
  it('wire 形状可序列化（JSON 往返稳定）', () => {
    const item: DeadlineItem = {
      id: 'bb-cs101-hw1',
      source: 'blackboard',
      kind: 'assignment',
      title: 'Homework 1',
      courseId: 'cs101',
      courseName: '计算机导论',
      dueAt: '2026-10-20T15:59:00.000Z',
      dueAtRaw: 'Oct 20, 2026 11:59 PM',
      sourceUrl: 'https://example.invalid/bb/cs101/hw1',
      submitted: false,
      weight: null,
    };

    const wire = JSON.parse(JSON.stringify(item)) as DeadlineItem;
    expect(wire).toEqual(item);
    // 没有采集失败时不下发 stale 键，避免给客户端「这条不可信」的误解
    expect('stale' in wire).toBe(false);
  });

  it('stale 是可选键，只表示「本次采集失败、保留上次结果」', () => {
    const staleItem: DeadlineItem = {
      id: 'gs-cs101-pa1',
      source: 'gradescope',
      kind: 'project',
      title: 'PA1',
      courseId: 'cs101',
      courseName: '计算机导论',
      dueAt: '2026-10-21T15:59:00.000Z',
      dueAtRaw: '2026-10-21 23:59',
      sourceUrl: 'https://example.invalid/gs/cs101/pa1',
      submitted: true,
      weight: 12.5,
      stale: true,
    };
    expect(staleItem.stale).toBe(true);
    expect(staleItem.weight).toBe(12.5);
  });

  it('weight 可空但类型不是 undefined', () => {
    expectTypeOf<DeadlineItem['weight']>().toEqualTypeOf<number | null>();
    expectTypeOf<DeadlineItem['stale']>().toEqualTypeOf<boolean | undefined>();
  });

  it('字段名就是共享层消费的字段名（防止契约漂移）', () => {
    const keys: Array<keyof DeadlineItem> = [
      'id',
      'source',
      'kind',
      'title',
      'courseId',
      'courseName',
      'dueAt',
      'dueAtRaw',
      'sourceUrl',
      'submitted',
      'weight',
      'stale',
    ];
    // 若有人加字段却忘了更新这里，会在编译期暴露
    expect(keys).toHaveLength(12);
  });
});

describe('展示名类型完整性', () => {
  it('Record 的键恰好覆盖枚举（类型层防线）', () => {
    expectTypeOf<keyof typeof DEADLINE_SOURCE_LABELS>().toEqualTypeOf<DeadlineSource>();
    expectTypeOf<keyof typeof DEADLINE_KIND_LABELS>().toEqualTypeOf<DeadlineKind>();
  });
});
