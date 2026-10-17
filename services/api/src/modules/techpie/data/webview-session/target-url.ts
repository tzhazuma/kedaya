/**
 * 校园系统目标地址白名单（契约 §11.18-B）
 *
 * 本文件属于 `webview-session/` —— 契约 §11.4 **I3** 的唯一出口所在目录。
 * 它是**纯函数**：零 IO、零框架，因此可以被穷举单测（见 `target-url.spec.ts`）。
 *
 * ## 裁决 §11.18-B 的四条硬要求（逐条落地）
 *
 * 1. **fail-closed** —— 不在名单里一律拒绝；**不允许**通配整个 `shanghaitech.edu.cn`
 *    （那等于没有白名单，还会放行任意子域，包括已被攻陷的子域）。这里是**精确匹配**。
 * 2. 名单内容标注为**占位**（与 `CAMPUS_ORIGIN`、`CAMPUS_LOCATIONS` 同一处理），
 *    在代码常量 + 响应字段里**机器可见**（`CAMPUS_TARGET_ALLOWLIST_IS_PLACEHOLDER`
 *    与 `GET /techpie/capabilities` 的 `allowlistPlaceholder`）。
 * 3. **只允许 `https`**；禁止 `http`、禁止 IP 字面量、禁止非 443 端口、
 *    禁止 `@` 形式的 userinfo（`https://shanghaitech.edu.cn@evil.com` 是经典绕过）。
 * 4. 校验必须在**服务端**做 —— 客户端传入的 `targetUrl` 一律不可信。
 *    三端各自的客户端白名单只是**纵深防御**，不是权威来源。
 */

/**
 * 校园系统域名白名单 —— ⚠️ **内容是占位**，待信息办/技术调研确认后替换
 * （契约未决问题 **U11**：需列举 `*.shanghaitech.edu.cn` 下的实际域名）。
 *
 * 下面这些域名来自规格 §8.4 / §11 与三端客户端已登记的入口，**不是**经确认的清单。
 */
export const CAMPUS_TARGET_ALLOWLIST: readonly string[] = [
  'ecourse.shanghaitech.edu.cn',
  'egate.shanghaitech.edu.cn',
  'ecard.shanghaitech.edu.cn',
  'elrc.shanghaitech.edu.cn',
  'oa.shanghaitech.edu.cn',
  'acm.shanghaitech.edu.cn',
  'student.shanghaitech.edu.cn',
];

/** 白名单是否为占位内容（§11.18-B 第 2 条：必须机器可见） */
export const CAMPUS_TARGET_ALLOWLIST_IS_PLACEHOLDER = true;

export const CAMPUS_TARGET_ALLOWLIST_NOTE =
  '白名单内容为**占位**：真实域名列表待信息办/技术调研确认（规格 U11）。' +
  '校验 fail-closed —— 不在名单里一律拒绝，且**不**允许通配 *.shanghaitech.edu.cn。';

/** IPv4 字面量（`127.0.0.1` / `10.0.0.1` 都拒绝） */
const IPV4_LITERAL = /^(?:\d{1,3})(?:\.\d{1,3}){3}$/;

/** `URL` 能接受的 scheme 之外的额外禁令：只认 https（大小写不敏感，`URL` 已归一化） */
const ALLOWED_PROTOCOL = 'https:';

export type CampusTargetRejection =
  | 'MALFORMED'
  | 'NOT_HTTPS'
  | 'HAS_USERINFO'
  | 'NON_DEFAULT_PORT'
  | 'IP_LITERAL'
  | 'NOT_ALLOWLISTED';

export interface CampusTargetCheck {
  allowed: boolean;
  /** 机器可读的拒绝原因（`null` = 通过） */
  reason: CampusTargetRejection | null;
  /** 归一化后的 host（通过时非空） */
  host: string | null;
}

const REJECT = (reason: CampusTargetRejection): CampusTargetCheck => ({ allowed: false, reason, host: null });

/**
 * 校验一个校园系统目标 URL（**fail-closed**）。
 *
 * 检查顺序即优先级：先报最明确的错（协议 → userinfo → 端口 → IP → 白名单），
 * 这样客户端拿到的 `details.reason` 能直接映射到一句可读的提示。
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

  // `URL` 对默认端口返回 `''`，所以非空即"非 443"
  if (url.port !== '') return REJECT('NON_DEFAULT_PORT');

  const host = url.hostname.toLowerCase();
  if (host.length === 0) return REJECT('MALFORMED');
  // IPv6 在 `hostname` 里带方括号
  if (host.startsWith('[') || host.includes(':') || IPV4_LITERAL.test(host)) return REJECT('IP_LITERAL');

  // 精确匹配 —— **不做**后缀通配
  if (!CAMPUS_TARGET_ALLOWLIST.includes(host)) return REJECT('NOT_ALLOWLISTED');

  return { allowed: true, reason: null, host };
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
