import { describe, expect, it } from 'vitest';

import { HealthController } from './health.controller';

/**
 * 健康检查的形状锁。
 *
 * 这个端点会被**公网隧道**暴露，所以它的契约必须由测试钉死：
 * 只回 `{ok, uptimeSec}`，不多说一个字。
 */
describe('HealthController', () => {
  it('返回 {ok:true, uptimeSec}，且 uptimeSec 是非负整数', () => {
    const controller = new HealthController();
    const result = controller.check();

    expect(result.ok).toBe(true);
    expect(Number.isInteger(result.uptimeSec)).toBe(true);
    expect(result.uptimeSec).toBeGreaterThanOrEqual(0);
  });

  it('⚠️ 只暴露两个字段 —— 这是公开端点，不泄露依赖/环境/版本', () => {
    const controller = new HealthController();
    expect(Object.keys(controller.check()).sort()).toEqual(['ok', 'uptimeSec']);
  });

  it('两次调用之间 uptimeSec 单调不减', async () => {
    const controller = new HealthController();
    const first = controller.check().uptimeSec;
    await new Promise((resolve) => setTimeout(resolve, 1100));
    expect(controller.check().uptimeSec).toBeGreaterThanOrEqual(first);
  });
});
