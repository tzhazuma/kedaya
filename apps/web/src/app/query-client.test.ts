import { describe, expect, it } from 'vitest';
import { createQueryClient } from './query-client';

/**
 * 这一组测试钉住一个**真实缺陷的修复**（两个团队各自独立复现过）。
 *
 * 缺陷：TanStack Query 默认 `networkMode: 'online'`，查询在"浏览器认为离线"
 * 或**标签页不可见**时进入 **paused**；重试器用
 * `focusManager.isFocused() && onlineManager.isOnline()` 决定是否继续。
 * 于是**后台标签页里请求失败 → 重试永久暂停 → UI 永远停在骨架屏**，
 * 既不出错误态、也不出重试按钮 —— 用户看到"一直在加载"，
 * 而契约 §8 要求的是"失败静默降级为错误态 UI"。
 *
 * 实测既有 `/groupbuy` 与新增 `/wildlife`、`/buddy` 表现一致 ⇒ 全局既有缺陷。
 */
describe('QueryClient 配置（契约 §8：失败必须降级为错误态，而不是永远 loading）', () => {
  it('⚠️ queries 必须用 networkMode: "always" —— 否则后台标签页会永久暂停', () => {
    const client = createQueryClient();
    const opts = client.getDefaultOptions();
    expect(
      opts.queries?.networkMode,
      'networkMode 不是 "always" 时，标签页隐藏会让重试永久 paused，UI 卡在骨架屏',
    ).toBe('always');
  });

  it('⚠️ mutations 也必须用 networkMode: "always" —— 写操作挂起会让用户以为没提交成功', () => {
    const client = createQueryClient();
    const opts = client.getDefaultOptions();
    expect(opts.mutations?.networkMode).toBe('always');
  });

  it('失败只重试 1 次（避免慢网下长时间骨架屏）', () => {
    const client = createQueryClient();
    expect(client.getDefaultOptions().queries?.retry).toBe(1);
  });

  it('写操作不自动重试（避免重复提交；幂等由 Idempotency-Key 保证，见契约 §11.3）', () => {
    const client = createQueryClient();
    expect(client.getDefaultOptions().mutations?.retry).toBe(0);
  });

  it('refetchOnWindowFocus 关闭（切回标签页不该突然刷新列表）', () => {
    const client = createQueryClient();
    expect(client.getDefaultOptions().queries?.refetchOnWindowFocus).toBe(false);
  });

  it('每次调用返回独立实例（避免测试间互相污染缓存）', () => {
    expect(createQueryClient()).not.toBe(createQueryClient());
  });
});
