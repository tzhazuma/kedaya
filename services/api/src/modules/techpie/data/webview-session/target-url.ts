/**
 * 校园系统目标地址白名单（契约 §11.18-B，**端口规则已由 §11.21-A 修正**）
 *
 * 本文件属于 `webview-session/` —— 契约 §11.4 **I3** 的唯一出口所在目录。
 * 它是**纯函数**：零 IO、零框架，因此可以被穷举单测（见 `target-url.spec.ts`）。
 *
 * ## ⚠️ §11.21-A 修正了什么（这是本文件最重要的一段）
 *
 * §11.18-B 第 3 条原写"**禁止非 443 端口**"。**那条规则是错的**：
 * 它与规格 §8.4 的示例地址 `https://ecourse.shanghaitech.edu.cn:8080/` 直接冲突，
 * 而真实校园系统**确实可能跑在非 443 端口上**（校内自建服务很常见）。
 * 更糟的是它**既漏又误**：它放行了 `https://evil.com`（只要端口是 443），
 * 却挡掉了合法的 `https://ecourse.shanghaitech.edu.cn:8080`。
 *
 * **真正的风险不是"端口是多少"，而是"这个 origin 是不是我们批准的那个"。**
 *
 * 修正后的规则（**取代** §11.18-B 第 3 条）：
 * 1. 白名单条目是**完整 origin**（`scheme://host[:port]`）；
 * 2. 校验必须是**精确 origin 匹配**（scheme + host + port 三者全等），
 *    **不是** host 匹配后再看端口；
 * 3. 仍然**禁止**：`http`、IP 字面量、`@` userinfo
 *    （`https://shanghaitech.edu.cn@evil.com` 是经典绕过）、
 *    通配子域（`*.shanghaitech.edu.cn` —— 会放行被攻陷的子域）；
 * 4. 校验在**服务端**做 —— 客户端传入的 `targetUrl` 一律不可信
 *    （三端各自的客户端白名单只是**纵深防御**）。
 *
 * ## 另外两条仍然有效的要求（§11.18-B 第 1、2 条）
 *
 * · **fail-closed** —— 不在名单里一律拒绝，不做后缀通配；
 * · 名单内容标注为**占位**（与 `CAMPUS_ORIGIN`、`CAMPUS_LOCATIONS` 同一处理），
 *   在代码常量 + 响应字段里**机器可见**（`CAMPUS_TARGET_ALLOWLIST_IS_PLACEHOLDER`
 *   与 `GET /techpie/capabilities` 的 `allowlistPlaceholder`）。
 */

/**
 * 校园系统 origin 白名单 —— ⚠️ **内容是占位**，待信息办/技术调研确认后替换
 * （契约未决问题 **U11**：需列举 `*.shanghaitech.edu.cn` 下的实际域名与端口）。
 *
 * 条目形态是**完整 origin**（`scheme://host[:port]`，端口为 443 时省略）。
 * `https://ecourse.shanghaitech.edu.cn:8080` 是 §11.21-A 明确点名的例子 ——
 * 它在新规则下**可以**在白名单里，这正是"按 origin 精确匹配"比"一刀切禁非 443"
 * 更强的地方（后者会挡掉它，同时放行 `https://evil.com`）。
 */
export const CAMPUS_TARGET_ALLOWLIST: readonly string[] = [
  'https://ecourse.shanghaitech.edu.cn',
  // §11.21-A 的例子：非 443 端口**可以**是合法 origin
  'https://ecourse.shanghaitech.edu.cn:8080',
  'https://egate.shanghaitech.edu.cn',
  'https://ecard.shanghaitech.edu.cn',
  'https://elrc.shanghaitech.edu.cn',
  'https://oa.shanghaitech.edu.cn',
  'https://acm.shanghaitech.edu.cn',
  'https://student.shanghaitech.edu.cn',
];

/** 白名单是否为占位内容（§11.18-B 第 2 条：必须机器可见） */
export const CAMPUS_TARGET_ALLOWLIST_IS_PLACEHOLDER = true;

export const CAMPUS_TARGET_ALLOWLIST_NOTE =
  '白名单内容为**占位**：真实域名/端口列表待信息办/技术调研确认（规格 U11）。' +
  '校验 fail-closed —— 不在名单里一律拒绝，且**不**允许通配 *.shanghaitech.edu.cn。' +
  '按**完整 origin 精确匹配**（§11.21-A：非 443 端口本身不是风险，未批准的 origin 才是）。';

/** IPv4 字面量（`127.0.0.1` / `10.0.0.1` 都拒绝） */
const IPV4_LITERAL = /^(?:\d{1,3})(?:\.\d{1,3}){3}$/;

/** `URL` 能接受的 scheme 之外的额外禁令：只认 https（大小写不敏感，`URL` 已归一化） */
const ALLOWED_PROTOCOL = 'https:';

export type CampusTargetRejection =
  | 'MALFORMED'
  | 'NOT_HTTPS'
  | 'HAS_USERINFO'
  | 'IP_LITERAL'
  | 'NOT_ALLOWLISTED';

export interface CampusTargetCheck {
  allowed: boolean;
  /** 机器可读的拒绝原因（`null` = 通过） */
  reason: CampusTargetRejection | null;
  /** 归一化后的 host（通过时非空；**不含**端口） */
  host: string | null;
  /** 归一化后的**完整 origin**（通过时非空；`scheme://host[:port]`） */
  origin: string | null;
}

const REJECT = (reason: CampusTargetRejection): CampusTargetCheck => ({
  allowed: false,
  reason,
  host: null,
  origin: null,
});

/**
 * 校验一个校园系统目标 URL（**fail-closed + 精确 origin 匹配**）。
 *
 * 检查顺序即优先级：先报最明确的错（协议 → userinfo → IP → origin 白名单），
 * 这样客户端拿到的 `details.reason` 能直接映射到一句可读的提示。
 *
 * ⚠️ 与旧实现的区别：**不再有 `NON_DEFAULT_PORT` 这一条**。
 * 端口参与 **origin 精确匹配**，而不是被单独禁止（§11.21-A）。
 */
export function checkCampusTargetUrl(raw: unknown): CampusTargetCheck {
  if (typeof raw !== 'string') return REJECT('MALFORMED');
  const trimmed = raw.trim();
  // 长度上限：避免把超长字符串喂给 URL 解析器（也避免日志里出现巨串）
  if (trimmed.length === 0 || trimmed.length > 2048) return REJECT('MALFORMED');

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return REJECT('MALFORMED');
  }

  if (url.protocol !== ALLOWED_PROTOCOL) return REJECT('NOT_HTTPS');

  // `https://shanghaitech.edu.cn@evil.com` → username 非空、hostname 是 evil.com。
  // **必须**在 host 判定之前拒绝：否则某些客户端会把 userinfo 当成 host 展示。
  if (url.username !== '' || url.password !== '') return REJECT('HAS_USERINFO');

  const host = url.hostname.toLowerCase();
  if (host.length === 0) return REJECT('MALFORMED');
  // IPv6 在 `hostname` 里带方括号
  if (host.startsWith('[') || host.includes(':') || IPV4_LITERAL.test(host)) return REJECT('IP_LITERAL');

  // `URL.origin` 已把默认端口归一化掉（`https://h:443` → `https://h`），
  // 因此这里比较的是**规范的完整 origin**：scheme + host + port 三者全等。
  const origin = url.origin.toLowerCase();

  // 精确匹配 —— **不做**后缀通配，**不**按 host 匹配后再看端口
  if (!CAMPUS_TARGET_ALLOWLIST.includes(origin)) return REJECT('NOT_ALLOWLISTED');

  return { allowed: true, reason: null, host, origin };
}

/** 便捷判定（测试与守卫用） */
export function isAllowedCampusTargetUrl(raw: unknown): boolean {
  return checkCampusTargetUrl(raw).allowed;
}

/**
 * 拒绝原因 → 契约错误码映射（规格 §8.4 的校验表）。
 *
 * | 原因 | HTTP | `code` | 理由 |
 * | --- | --- | --- | --- |
 * | `MALFORMED` / `NOT_HTTPS` | 422 | `VALIDATION_FAILED` | 这是**格式**问题，不是安全问题 |
 * | 其余 | 403 | `FORBIDDEN` | 这是**安全**拒绝，fail-closed |
 *
 * 两者都带 `details.reason = 'TARGET_URL_NOT_ALLOWED'`（规格 §8.4 登记的形状），
 * 另外给一个更细的 `details.check` 便于客户端给出可读提示。
 */
export function statusForRejection(reason: CampusTargetRejection): 403 | 422 {
  return reason === 'MALFORMED' || reason === 'NOT_HTTPS' ? 422 : 403;
}
