import { describe, expect, it } from 'vitest';
import { CAMPUS_WEB_ENTRY_TARGETS, TECHPIE_CAPABILITIES } from '../../domain/capabilities';
import {
  CAMPUS_TARGET_ALLOWLIST,
  CAMPUS_TARGET_ALLOWLIST_IS_PLACEHOLDER,
  CAMPUS_TARGET_ALLOWLIST_NOTE,
  checkCampusTargetUrl,
  isAllowedCampusTargetUrl,
  statusForRejection,
} from './target-url';

/**
 * 契约 §11.18-B「校园域名白名单：fail-closed，且不假装它完整」
 * **+ §11.21-A「按完整 origin 精确匹配」（取代"禁止非 443 端口"）**
 *
 * 这组测试是**安全回归**，不是功能测试 —— 每一条都对应一个真实的绕过手法。
 *
 * ## §11.21-A 修正了什么
 *
 * 旧规则"禁止非 443 端口"**既漏又误**：它放行 `https://evil.com`（端口是 443 就行），
 * 却挡掉合法的 `https://ecourse.shanghaitech.edu.cn:8080`。
 * 新规则按**完整 origin**（scheme + host + port 三者全等）精确匹配：
 * 端口不再是单独的一票否决，而是 origin 的一部分。
 */
describe('webview-session · targetUrl origin 白名单（契约 §11.18-B + §11.21-A）', () => {
  it('白名单内的 https 地址通过（精确 origin 匹配）', () => {
    const result = checkCampusTargetUrl('https://ecourse.shanghaitech.edu.cn/');
    expect(result).toEqual({
      allowed: true,
      reason: null,
      host: 'ecourse.shanghaitech.edu.cn',
      origin: 'https://ecourse.shanghaitech.edu.cn',
    });
  });

  it('路径与查询串不影响判定（origin 不含 path/query）', () => {
    expect(isAllowedCampusTargetUrl('https://ecard.shanghaitech.edu.cn/card/balance?x=1')).toBe(true);
    expect(isAllowedCampusTargetUrl('https://oa.shanghaitech.edu.cn/activity')).toBe(true);
  });

  it('大小写不敏感（origin 归一化）', () => {
    expect(isAllowedCampusTargetUrl('https://ECOURSE.SHANGHAITECH.EDU.CN/')).toBe(true);
  });

  /* ---------------- 1. fail-closed：不在名单里一律拒绝 ---------------- */

  it.each([
    ['完全无关的域名（**即使端口是 443** —— 旧规则会放行它）', 'https://evil.com/'],
    ['后缀通配的绕过', 'https://ecourse.shanghaitech.edu.cn.evil.com/'],
    ['只写学校根域（**不允许**通配整个 shanghaitech.edu.cn）', 'https://shanghaitech.edu.cn/'],
    ['未登记的学校子域（包括可能被攻陷的子域）', 'https://newthing.shanghaitech.edu.cn/'],
    ['同名但不同 TLD', 'https://ecourse.shanghaitech.edu.cn.evil/'],
    ['带尾点的 FQDN', 'https://ecourse.shanghaitech.edu.cn./'],
  ])('拒绝：%s', (_label, url) => {
    const result = checkCampusTargetUrl(url);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('NOT_ALLOWLISTED');
    expect(statusForRejection(result.reason!)).toBe(403);
  });

  it('白名单常量本身**不含**通配符，且每条都是完整 origin', () => {
    for (const entry of CAMPUS_TARGET_ALLOWLIST) {
      expect(entry).not.toContain('*');
      // 每条必须是 `scheme://host[:port]` 形态的**完整 origin**（§11.21-A 第 1 条）
      expect(entry.startsWith('https://')).toBe(true);
      // 除 scheme 的两个斜杠外**没有路径**（origin 不含 path/query）
      const rest = entry.slice('https://'.length);
      expect(rest).not.toContain('/');
      expect(rest).not.toMatch(/^\./);
      expect(rest).toMatch(/^[a-z0-9.-]+(:\d+)?$/);
    }
  });

  /* ---------------- 2. 只允许 https ---------------- */

  it.each([
    ['http 明文', 'http://ecourse.shanghaitech.edu.cn/'],
    ['ftp', 'ftp://ecourse.shanghaitech.edu.cn/'],
    ['javascript 伪协议', 'javascript:alert(1)'],
    ['data URL', 'data:text/html,<script>1</script>'],
  ])('拒绝非 https：%s', (_label, url) => {
    const result = checkCampusTargetUrl(url);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('NOT_HTTPS');
    // 格式问题 → 422（规格 §8.4 的校验表）
    expect(statusForRejection(result.reason!)).toBe(422);
  });

  /* ---------------- 3. `@` userinfo 绕过 ---------------- */

  it.each([
    ['经典绕过：白名单域名做 userinfo，真实 host 是 evil.com', 'https://shanghaitech.edu.cn@evil.com/'],
    ['白名单域名做 userinfo + 密码段', 'https://ecourse.shanghaitech.edu.cn:x@evil.com/'],
    ['host 是白名单但带了 userinfo（同样拒绝：fail-closed）', 'https://evil.com@ecourse.shanghaitech.edu.cn/'],
    ['带用户名密码', 'https://user:pass@ecourse.shanghaitech.edu.cn/'],
  ])('拒绝 userinfo：%s', (_label, url) => {
    const result = checkCampusTargetUrl(url);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('HAS_USERINFO');
    expect(statusForRejection(result.reason!)).toBe(403);
  });

  /* ---------------- 4. 端口：参与 origin 匹配，不再单独禁止（§11.21-A） ---------------- */

  it('§11.21-A 的示例地址 `:8080` **通过** —— 它在白名单里（旧规则会误杀它）', () => {
    const result = checkCampusTargetUrl('https://ecourse.shanghaitech.edu.cn:8080/');
    expect(result.allowed).toBe(true);
    expect(result.origin).toBe('https://ecourse.shanghaitech.edu.cn:8080');
  });

  it.each([
    ['同一 host 的**另一个**端口（origin 不同 → 拒绝）', 'https://ecourse.shanghaitech.edu.cn:8443/'],
    ['显式 :80', 'https://ecard.shanghaitech.edu.cn:80/'],
    ['同一 host 的另一个端口（白名单里有 :8080，但没有 :9090）', 'https://ecourse.shanghaitech.edu.cn:9090/'],
  ])('按 origin 精确匹配 → 拒绝：%s', (_label, url) => {
    const result = checkCampusTargetUrl(url);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('NOT_ALLOWLISTED');
    expect(statusForRejection(result.reason!)).toBe(403);
  });

  it('显式写 443 仍然通过（URL 会把它归一化成默认端口 → origin 相同）', () => {
    expect(isAllowedCampusTargetUrl('https://ecourse.shanghaitech.edu.cn:443/')).toBe(true);
  });

  it('旧实现里的 `NON_DEFAULT_PORT` 这一条**已经不存在**（§11.21-A 取代了它）', () => {
    // 类型层面就取不到这个值：任何端口问题都归到 NOT_ALLOWLISTED。
    const result = checkCampusTargetUrl('https://ecourse.shanghaitech.edu.cn:8443/');
    expect(result.reason).not.toBe('NON_DEFAULT_PORT');
  });

  /* ---------------- 5. IP 字面量 ---------------- */

  it.each([
    ['IPv4 回环', 'https://127.0.0.1/'],
    ['IPv4 内网', 'https://10.0.0.1/'],
    ['IPv4 公网', 'https://8.8.8.8/'],
    ['IPv6', 'https://[::1]/'],
  ])('拒绝 IP 字面量：%s', (_label, url) => {
    const result = checkCampusTargetUrl(url);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('IP_LITERAL');
    expect(statusForRejection(result.reason!)).toBe(403);
  });

  /* ---------------- 6. 畸形输入 ---------------- */

  it.each([
    ['空串', ''],
    ['只有空白', '   '],
    ['不是 URL', 'not-a-url'],
    ['相对路径', '/ecourse/'],
    ['超长', `https://ecourse.shanghaitech.edu.cn/${'a'.repeat(2100)}`],
  ])('拒绝畸形输入：%s', (_label, url) => {
    const result = checkCampusTargetUrl(url);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('MALFORMED');
    expect(statusForRejection(result.reason!)).toBe(422);
  });

  it.each([[null], [undefined], [42], [{}], [['https://ecourse.shanghaitech.edu.cn/']]])(
    '非字符串输入（%s）一律拒绝，不抛异常',
    (input) => {
      expect(checkCampusTargetUrl(input).allowed).toBe(false);
    },
  );

  /* ---------------- 7. 占位标记必须机器可见 ---------------- */

  it('白名单被机器可见地标注为占位（§11.18-B 第 2 条 / U11 未关闭）', () => {
    expect(CAMPUS_TARGET_ALLOWLIST_IS_PLACEHOLDER).toBe(true);
    expect(CAMPUS_TARGET_ALLOWLIST_NOTE).toContain('占位');
    expect(CAMPUS_TARGET_ALLOWLIST_NOTE).toContain('U11');
    expect(CAMPUS_TARGET_ALLOWLIST_NOTE).toContain('origin');
  });

  /* ---------------- 8. 与能力清单的一致性 ---------------- */

  it('能力清单给出的每个 WebView targetUrl 都在白名单里（否则 UI 就是死链）', () => {
    const webviewTargets = TECHPIE_CAPABILITIES.filter((item) => item.access === 'webview').map(
      (item) => item.targetUrl,
    );
    expect(webviewTargets.length).toBeGreaterThan(0);
    for (const target of webviewTargets) {
      expect(target).toBeTruthy();
      expect(isAllowedCampusTargetUrl(target)).toBe(true);
    }
    // 反向：`CAMPUS_WEB_ENTRY_TARGETS` 里的每一个也必须通过
    for (const target of Object.values(CAMPUS_WEB_ENTRY_TARGETS)) {
      expect(isAllowedCampusTargetUrl(target)).toBe(true);
    }
  });
});
