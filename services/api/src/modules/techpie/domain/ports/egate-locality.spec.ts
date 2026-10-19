import { describe, expect, it } from 'vitest';

import {
  CAMPUS_PLATFORMS,
  isPhase0Bindable,
  PHASE0_BINDABLE_PLATFORMS,
} from './campus-session.port';

/**
 * 🔒 **eGate 凭据必须留在用户本地** —— 这条是产品硬要求，由测试钉死。
 *
 * ## 为什么需要这条测试
 *
 * `campus-session.service.ts` 的文件头描述了"代持 CASTGC 的平台
 * （`egate` / `cpdaily` / `jwc` / `cas` / `techpie`）在信息办确认后可以服务端代持" ——
 * 那是一条**未来可能**的路径，但它会把用户的统一身份认证凭据存到我们服务器上。
 *
 * 用户的明确要求是：**通过 eGate 登录时，eGate 的信息必须保留在用户本地，
 * 防止隐私泄漏。**
 *
 * 目前这条要求是靠 `PHASE0_BINDABLE_PLATFORMS = ['ecard']` 保证的：
 * `egate` **不允许绑定**，所以服务端根本没有存它的入口；
 * `webview-session` 走 W4（用户在校园页面自己登录，我们不接触 cookie，
 * `cookieInjected` 恒为 false）。
 *
 * ⚠️ 但这个保证**很脆弱** —— 只要有人往 `PHASE0_BINDABLE_PLATFORMS` 里
 * 加一个 `'egate'`，服务端就会开始代持用户的统一身份认证会话，
 * 而**没有任何测试会拦他**。这条测试就是那个拦路的。
 */

describe('🔒 eGate 凭据本地化（隐私硬要求）', () => {
  it('⚠️ `egate` **不得**出现在 Phase 0 可绑定平台里', () => {
    expect(PHASE0_BINDABLE_PLATFORMS).not.toContain('egate');
    expect(isPhase0Bindable('egate')).toBe(false);
  });

  it('`cas` 同样不得可绑定（统一身份认证的另一条入口）', () => {
    expect(PHASE0_BINDABLE_PLATFORMS).not.toContain('cas');
    expect(isPhase0Bindable('cas')).toBe(false);
  });

  it('Phase 0 目前**只**允许 ecard（OPENID 通道，与 CASTGC 完全解耦）', () => {
    // 这条断言看着很死，但它记录的是**有意的设计**：
    // ecard 走独立 OPENID 通道，不涉及统一身份认证凭据。
    expect([...PHASE0_BINDABLE_PLATFORMS]).toEqual(['ecard']);
  });

  it('平台枚举本身仍保留全部 6 个（这些平台将来可能出现，只是 Phase 0 不开放）', () => {
    expect([...CAMPUS_PLATFORMS].sort()).toEqual(
      ['cas', 'cpdaily', 'ecard', 'egate', 'jwc', 'techpie'].sort(),
    );
  });
});
