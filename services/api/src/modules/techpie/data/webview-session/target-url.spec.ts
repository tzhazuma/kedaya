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
 *
 * 这组测试是**安全回归**，不是功能测试 —— 每一条都对应一个真实的绕过手法。
 */
describe('webview-session · targetUrl 白名单（契约 §11.18-B，fail-closed）', () => {
  it('白名单内的 https 地址通过（精确匹配）', () => {
    const result = checkCampusTargetUrl('https://ecourse.shanghaitech.edu.cn/');
    expect(result).toEqual({ allowed: true, reason: null, host: 'ecourse.shanghaitech.edu.cn' });
  });

  it('路径与查询串不影响判定（只按 host 白名单）', () => {
    expect(isAllowedCampusTargetUrl('https://ecard.shanghaitech.edu.cn/card/balance?x=1')).toBe(true);
    expect(isAllowedCampusTargetUrl('https://oa.shanghaitech.edu.cn/activity')).toBe(true);
  });

  it('大小写不敏感（host 归一化）', () => {
    expect(isAllowedCampusTargetUrl('https://ECOURSE.SHANGHAITECH.EDU.CN/')).toBe(true);
  });

  /* ---------------- 1. fail-closed：不在名单里一律拒绝 ---------------- */

  it.each([
    ['完全无关的域名', 'https://evil.com/'],
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

  it('白名单常量本身**不含**通配符（否则等于没有白名单）', () => {
    for (const entry of CAMPUS_TARGET_ALLOWLIST) {
      expect(entry).not.toContain('*');
      expect(entry).not.toMatch(/^\./);
      // 每条都必须是具体域名，不是 `shanghaitech.edu.cn` 这样的根域
      expect(entry).not.toBe('shanghaitech.edu.cn');
      expect(entry.endsWith('.shanghaitech.edu.cn')).toBe(true);
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

  /* ---------------- 4. 非 443 端口 ---------------- */

  it.each([
    ['非默认端口', 'https://ecourse.shanghaitech.edu.cn:8443/'],
    ['规格 §8.4 示例里的 :8080（**必须**被拒绝 —— §11.18-B 优先于示例）', 'https://ecourse.shanghaitech.edu.cn:8080/'],
    ['显式 443 之外的常见端口', 'https://ecard.shanghaitech.edu.cn:80/'],
  ])('拒绝非 443 端口：%s', (_label, url) => {
    const result = checkCampusTargetUrl(url);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('NON_DEFAULT_PORT');
    expect(statusForRejection(result.reason!)).toBe(403);
  });

  it('显式写 443 仍然通过（URL 会把它归一化成空端口）', () => {
    expect(isAllowedCampusTargetUrl('https://ecourse.shanghaitech.edu.cn:443/')).toBe(true);
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
  });

  /* ---------------- 8. 与能力清单的一致性 ---------------- */

  it('能力清单给出的每个 WebView targetUrl 都在白名单里（否则 UI 就是死链）', () => {
    const webviewTargets = TECHPIE_CAPABILITIES.filter((item) => item.access === 'webview').map(
      (item) => item.targetUrl,
    );
    expect(webviewTargets.length).toBeGreaterThan(0);
    for (const target of webviewTargets) {
      expect(target).not.toBeNull();
      expect(isAllowedCampusTargetUrl(target)).toBe(true);
    }
    // 反向：`CAMPUS_WEB_ENTRY_TARGETS` 里的每一个也必须通过
    for (const target of Object.values(CAMPUS_WEB_ENTRY_TARGETS)) {
      expect(isAllowedCampusTargetUrl(target)).toBe(true);
    }
  });
});
