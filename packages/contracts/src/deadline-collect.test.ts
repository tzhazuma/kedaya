import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  INITIAL_COLLECT_PROGRESS,
  isLossyCrawl,
  mergeGuardMessage,
  nextProgress,
  shouldAcceptEmpty,
  type CollectEvent,
  type CollectPhase,
  type CollectProgress,
} from './deadline-collect';

/**
 * 这些测试锁的是三条护栏的**判定结论**，不是采集实现：
 *
 * · 空结果 → 只有课程范围已知才接受，否则失败并保留旧数据；
 * · 丢页 → 失败页超过已观测页数的一半才判丢；恰好一半不算；
 * · 逐页累积 → parsed 单调递增，guard 一旦决定保留旧结果就不会被后续失败抹掉。
 *
 * 另外把 `planned` 未知时的退化行为钉死：分母用观测页数、done 不做缺页补偿。
 */

const PAGE_OK: CollectEvent = { kind: 'page-ok' };
const PAGE_FAIL: CollectEvent = { kind: 'page-fail' };
const DONE: CollectEvent = { kind: 'done' };

function plan(pages: number | null): CollectEvent {
  return { kind: 'planned', pages };
}

function run(events: readonly CollectEvent[], from: CollectProgress = INITIAL_COLLECT_PROGRESS): CollectProgress {
  return events.reduce(nextProgress, from);
}

function crawl(params: { pages: number | null; ok: number; fail: number }): CollectProgress {
  const events: CollectEvent[] = [plan(params.pages)];
  for (let index = 0; index < params.ok; index += 1) events.push(PAGE_OK);
  for (let index = 0; index < params.fail; index += 1) events.push(PAGE_FAIL);
  return run(events);
}

describe('CollectProgress 初始态与 planned', () => {
  it('初始为 idle、计数归零、未保留旧结果', () => {
    expect(INITIAL_COLLECT_PROGRESS).toEqual({
      phase: 'idle',
      planned: null,
      parsed: 0,
      lost: 0,
      keptPrevious: false,
      message: '还没有开始读取',
    });
    expect(mergeGuardMessage(INITIAL_COLLECT_PROGRESS)).toBe('还没有开始读取');
  });

  it('planned 事件只记录页数并进入 collecting', () => {
    const progress = nextProgress(INITIAL_COLLECT_PROGRESS, plan(8));
    expect(progress.phase).toBe('collecting');
    expect(progress.planned).toBe(8);
    expect(progress.parsed).toBe(0);
    expect(progress.lost).toBe(0);
    expect(progress.message).toBe('正在读取…（已读到 0/8 页）');
  });

  it('非法 planned（负数 / 小数 / 非有限数）按未知处理', () => {
    for (const pages of [-1, 2.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(nextProgress(INITIAL_COLLECT_PROGRESS, plan(pages)).planned).toBeNull();
    }
  });

  it('planned 可以晚到并修正为 null（未知）', () => {
    const late = run([PAGE_OK, PAGE_OK, plan(5)]);
    expect(late.planned).toBe(5);
    expect(late.parsed).toBe(2);

    const unknownAgain = nextProgress(late, plan(null));
    expect(unknownAgain.planned).toBeNull();
    expect(unknownAgain.parsed).toBe(2);
  });
});

describe('逐页累积（每页成功后立即可写回）', () => {
  it('每成功一页 parsed 单调递增，不回退、不跳号', () => {
    let progress = nextProgress(INITIAL_COLLECT_PROGRESS, plan(5));
    for (let page = 1; page <= 5; page += 1) {
      const next = nextProgress(progress, PAGE_OK);
      expect(next.parsed).toBe(page);
      expect(next.lost).toBe(0);
      expect(next.phase).toBe('collecting');
      expect(next.planned).toBe(5);
      progress = next;
    }
    expect(progress.message).toBe('正在读取…（已读到 5/5 页）');
  });

  it('page-fail 累加 lost，不清空已解析的页', () => {
    const progress = run([PAGE_OK, PAGE_OK, PAGE_FAIL]);
    expect(progress.parsed).toBe(2);
    expect(progress.lost).toBe(1);
    expect(progress.phase).toBe('collecting');
    expect(progress.message).toBe('正在读取…（已读到 2/3 页，1 页没读上）');
  });

  it('保留旧结果的判定一旦为 true，后续失败事件不会把它重置', () => {
    const guarded: CollectProgress = {
      ...INITIAL_COLLECT_PROGRESS,
      phase: 'collecting',
      planned: 4,
      parsed: 2,
      lost: 1,
      keptPrevious: true,
      message: '',
    };

    const afterFailure = nextProgress(guarded, PAGE_FAIL);
    expect(afterFailure.keptPrevious).toBe(true);
    expect(afterFailure.lost).toBe(2);
    expect(afterFailure.parsed).toBe(2);
  });

  it('成功页事件不会改写 keptPrevious', () => {
    const guarded: CollectProgress = { ...INITIAL_COLLECT_PROGRESS, phase: 'collecting', keptPrevious: true };
    expect(nextProgress(guarded, PAGE_OK).keptPrevious).toBe(true);
  });
});

describe('isLossyCrawl（丢页保护）', () => {
  it('parsed=3, lost=5 → 丢页', () => {
    expect(isLossyCrawl(3, 5)).toBe(true);
  });

  it('parsed=7, lost=1 → 不丢页', () => {
    expect(isLossyCrawl(7, 1)).toBe(false);
  });

  it('恰好一半不算丢页（边界语义：一半可用仍走 partial）', () => {
    expect(isLossyCrawl(4, 4)).toBe(false);
  });

  it('失败页多于可用页才算丢页（3 成功 / 4 失败）', () => {
    expect(isLossyCrawl(3, 4)).toBe(true);
  });

  it('没有失败页、或全失败', () => {
    expect(isLossyCrawl(0, 0)).toBe(false);
    expect(isLossyCrawl(9, 0)).toBe(false);
    expect(isLossyCrawl(0, 1)).toBe(true);
  });

  it('非法计数不判定为丢页（不猜调用方的意思）', () => {
    expect(isLossyCrawl(Number.NaN, 3)).toBe(false);
    expect(isLossyCrawl(3, Number.NaN)).toBe(false);
    expect(isLossyCrawl(-1, 5)).toBe(false);
    expect(isLossyCrawl(5, Number.POSITIVE_INFINITY)).toBe(false);
  });
});

describe('shouldAcceptEmpty / empty-result（空结果保护）', () => {
  it('课程范围未知 → 不接受空结果，按失败处理并保留旧数据', () => {
    const progress = nextProgress(INITIAL_COLLECT_PROGRESS, {
      kind: 'empty-result',
      courseScopeKnown: false,
    });

    expect(shouldAcceptEmpty(progress, false)).toBe(false);
    expect(progress.phase).toBe('failed');
    expect(progress.parsed).toBe(0);
    expect(progress.keptPrevious).toBe(true);
    expect(progress.message).toBe('没能确认本期课程范围，不能当作本期没有作业，已保留上次结果');
  });

  it('课程范围已知 → 接受 0 条', () => {
    const progress = nextProgress(INITIAL_COLLECT_PROGRESS, {
      kind: 'empty-result',
      courseScopeKnown: true,
    });

    expect(shouldAcceptEmpty(progress, true)).toBe(true);
    expect(progress.phase).toBe('ready');
    expect(progress.parsed).toBe(0);
    expect(progress.lost).toBe(0);
    expect(progress.keptPrevious).toBe(false);
    expect(progress.message).toBe('已确认课程范围，本期没有作业');
  });

  it('课程范围已知、但有失败页 → 仍不接受（读取异常不是「本期无课」）', () => {
    const progress = run([
      plan(3),
      PAGE_FAIL,
      { kind: 'empty-result', courseScopeKnown: true },
    ]);

    expect(shouldAcceptEmpty(progress, true)).toBe(false);
    expect(progress.phase).toBe('failed');
    expect(progress.keptPrevious).toBe(true);
    expect(progress.message).toBe('这一轮有 1 页没读上，一页也没有读到，已保留上次结果');
  });

  it('已解析出条目时的空结果事件自相矛盾，直接忽略', () => {
    const before = run([PAGE_OK, PAGE_OK]);
    const after = nextProgress(before, { kind: 'empty-result', courseScopeKnown: false });
    expect(after).toBe(before);
    expect(after.parsed).toBe(2);
  });

  it('已有解析页时 shouldAcceptEmpty 恒为 false', () => {
    expect(shouldAcceptEmpty(run([PAGE_OK]), true)).toBe(false);
  });
});

describe('nextProgress done（planned 未知的退化行为）', () => {
  it('planned=null：分母只用已观测页数，7 成功 1 失败 → partial', () => {
    const progress = nextProgress(crawl({ pages: null, ok: 7, fail: 1 }), DONE);

    expect(progress.phase).toBe('partial');
    expect(progress.parsed).toBe(7);
    expect(progress.lost).toBe(1);
    expect(progress.keptPrevious).toBe(false);
    expect(progress.message).toBe('已读回 7/8 页，1 页没读上，先用已读到的结果');
  });

  it('planned=null：3 成功 5 失败 → failed 且保留旧结果', () => {
    const progress = nextProgress(crawl({ pages: null, ok: 3, fail: 5 }), DONE);

    expect(progress.phase).toBe('failed');
    expect(progress.keptPrevious).toBe(true);
    expect(progress.message).toBe('这一轮只读回 3/8 页，已保留上次结果');
  });

  it('planned=null：没有失败就判 ready（无法推断缺页，这是明确的退化）', () => {
    const progress = nextProgress(crawl({ pages: null, ok: 7, fail: 0 }), DONE);

    expect(progress.phase).toBe('ready');
    expect(progress.lost).toBe(0);
    expect(progress.message).toBe('读取完成，已读回 7 页');
  });

  it('planned=null 时 done 不补缺页：未上报的页不按 lost 计', () => {
    const progress = nextProgress(run([plan(null), PAGE_OK, PAGE_OK]), DONE);

    expect(progress.phase).toBe('ready');
    expect(progress.lost).toBe(0);
    // 调用方漏报 page-fail 时本层无从得知——退化定义写死在这里，防止被误解为 bug。
    expect(progress.message).toBe('读取完成，已读回 2 页');
  });
});

describe('nextProgress done（planned 已知：缺页补偿与丢页判定）', () => {
  it('已宣布 8 页、只上报 3 成功 1 失败 → 缺页 4 计入 lost，判丢页', () => {
    const progress = nextProgress(crawl({ pages: 8, ok: 3, fail: 1 }), DONE);

    expect(progress.lost).toBe(5);
    expect(progress.phase).toBe('failed');
    expect(progress.keptPrevious).toBe(true);
    expect(progress.message).toBe('这一轮只读回 3/8 页，已保留上次结果');
  });

  it('已宣布 8 页、7 成功 1 失败 → 不丢页，partial 接受残缺结果', () => {
    const progress = nextProgress(crawl({ pages: 8, ok: 7, fail: 1 }), DONE);

    expect(progress.phase).toBe('partial');
    expect(progress.lost).toBe(1);
    expect(progress.keptPrevious).toBe(false);
    expect(progress.message).toBe('已读回 7/8 页，1 页没读上，先用已读到的结果');
  });

  it('已宣布 8 页、只上报 4 成功 4 失败（恰好一半）→ partial，不整轮丢弃', () => {
    const progress = nextProgress(crawl({ pages: 8, ok: 4, fail: 4 }), DONE);

    expect(progress.phase).toBe('partial');
    expect(progress.keptPrevious).toBe(false);
  });

  it('真实页数超过预估时以观测值为准，不出现 9/8 这种分母', () => {
    const progress = nextProgress(crawl({ pages: 2, ok: 3, fail: 0 }), DONE);

    expect(progress.phase).toBe('ready');
    expect(progress.message).toBe('读取完成，已读回 3 页');
  });

  it('done 时一页也没读到 → failed，保留旧结果', () => {
    const progress = nextProgress(INITIAL_COLLECT_PROGRESS, DONE);

    expect(progress.phase).toBe('failed');
    expect(progress.keptPrevious).toBe(true);
    expect(progress.parsed).toBe(0);
    expect(progress.message).toBe('没能确认本期课程范围，不能当作本期没有作业，已保留上次结果');
  });

  it('planned=0 且无任何页面事件 → done 仍判 failed，不凭空宣布 ready', () => {
    const progress = nextProgress(run([plan(0)]), DONE);

    expect(progress.phase).toBe('failed');
    expect(progress.keptPrevious).toBe(true);
  });

  it('全部成功 → ready，且不标记保留旧结果', () => {
    const progress = nextProgress(crawl({ pages: 8, ok: 8, fail: 0 }), DONE);

    expect(progress.phase).toBe('ready');
    expect(progress.parsed).toBe(8);
    expect(progress.lost).toBe(0);
    expect(progress.keptPrevious).toBe(false);
    expect(progress.message).toBe('读取完成，已读回 8 页');
  });
});

describe('终态稳定性', () => {
  it('ready 之后的事件不再改变结论', () => {
    const done = nextProgress(crawl({ pages: 2, ok: 2, fail: 0 }), DONE);

    expect(done.phase).toBe('ready');
    expect(nextProgress(done, PAGE_FAIL)).toBe(done);
    expect(nextProgress(done, PAGE_OK)).toBe(done);
    expect(nextProgress(done, plan(99))).toBe(done);
    expect(nextProgress(done, { kind: 'empty-result', courseScopeKnown: false })).toBe(done);
    expect(nextProgress(done, DONE)).toBe(done);
  });

  it('partial 也是本轮结论：迟到的页事件不会把它改回 collecting', () => {
    const partial = nextProgress(crawl({ pages: 8, ok: 7, fail: 1 }), DONE);

    expect(partial.phase).toBe('partial');
    expect(nextProgress(partial, PAGE_OK)).toBe(partial);
    expect(nextProgress(partial, PAGE_FAIL)).toBe(partial);
    expect(nextProgress(partial, DONE)).toBe(partial);
  });

  it('failed 之后的事件不再改变结论（保留旧结果的判定也保持）', () => {
    const failed = nextProgress(crawl({ pages: null, ok: 3, fail: 5 }), DONE);

    expect(failed.phase).toBe('failed');
    const after = nextProgress(failed, PAGE_OK);
    expect(after).toBe(failed);
    expect(after.keptPrevious).toBe(true);
  });
});

describe('mergeGuardMessage（面向用户的中文文案）', () => {
  it('collecting 且 planned 未知时只报已读页数', () => {
    const progress = run([PAGE_OK, PAGE_OK, PAGE_FAIL]);
    expect(mergeGuardMessage(progress)).toBe('正在读取…（已读到 2/3 页，1 页没读上）');
  });

  it('failed 且没有可保留的旧结果时明说本次不可用', () => {
    const crafted: CollectProgress = {
      ...INITIAL_COLLECT_PROGRESS,
      phase: 'failed',
      planned: 8,
      parsed: 3,
      lost: 5,
      keptPrevious: false,
      message: '',
    };
    expect(mergeGuardMessage(crafted)).toBe('这一轮只读回 3/8 页，本次结果不可用');
  });

  it('文案与快照里的 message 恒一致（可由最新快照重新推导）', () => {
    const snapshots: CollectProgress[] = [
      INITIAL_COLLECT_PROGRESS,
      run([plan(8), PAGE_OK]),
      nextProgress(crawl({ pages: 8, ok: 7, fail: 1 }), DONE),
      nextProgress(crawl({ pages: 8, ok: 3, fail: 1 }), DONE),
      nextProgress(INITIAL_COLLECT_PROGRESS, { kind: 'empty-result', courseScopeKnown: false }),
      nextProgress(INITIAL_COLLECT_PROGRESS, { kind: 'empty-result', courseScopeKnown: true }),
    ];

    for (const snapshot of snapshots) {
      expect(mergeGuardMessage(snapshot)).toBe(snapshot.message);
    }
  });
});

describe('契约类型', () => {
  it('CollectPhase 是封闭联合', () => {
    expectTypeOf<'collecting'>().toMatchTypeOf<CollectPhase>();
    expectTypeOf<'partial'>().toMatchTypeOf<CollectPhase>();
    // @ts-expect-error — 不是合法的阶段
    expectTypeOf<'done'>().toMatchTypeOf<CollectPhase>();
  });

  it('CollectProgress 字段全部只读', () => {
    expectTypeOf<CollectProgress>().toMatchTypeOf<{
      readonly phase: CollectPhase;
      readonly planned: number | null;
      readonly parsed: number;
      readonly lost: number;
      readonly keptPrevious: boolean;
      readonly message: string;
    }>();
  });

  it('事件联合封闭', () => {
    expectTypeOf<{ kind: 'page-ok' }>().toMatchTypeOf<CollectEvent>();
    // @ts-expect-error — 没有这个事件
    expectTypeOf<{ kind: 'page-timeout' }>().toMatchTypeOf<CollectEvent>();
  });
});
