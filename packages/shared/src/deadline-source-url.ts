/**
 * 课程 DDL · 回源链接安全化与只读抓取白名单（三端共用）
 *
 * ## 出处（合并声明）
 *
 * 移植自 **AgenticCampus**（`sagiridsg/AgenticCampus`）的两处逻辑：
 * `implementations/real/ingest.ts` 的 `stripSessionUrl`，以及
 * `browser-extension/read-policy.js` 的 `canVisit`（只读路由白名单）。
 * 来源项目：AgenticCampus（TS / Fastify / Capacitor 的校园工作台）。
 * 合并授权：项目负责人唐志昊确认三个参赛项目已同意合并。
 *
 * 上游把这两件事写死在采集链路里；这里抽成**纯函数**，因为它们是两条独立的安全
 * 不变量，值得单独测、也值得在采集端之外复用（比如服务端落库前清洗 `sourceUrl`）：
 *
 * 1. **不留会话参数**。平台回源链接经常带 `?sid=…&token=…`。把它写进我们的数据库
 *    等于把登录态存了一份 —— 而且会跟着日志、错误上报、备份一路扩散。
 * 2. **只读白名单**。采集器只该打开「看」的页面，永远不碰「改」的页面
 *    （提交作业、删帖、退出登录、成绩册管理）。按 URL 形状判断，而不是
 *    「读到什么算什么」—— 这是上游最有价值的一条设计。
 *
 * ## 与上游的差异（都是收紧或显式化，不是放宽）
 *
 * 1. **不抛异常**：上游 `stripSessionUrl` 对不安全 URL 抛 `ApiError(422)`；
 *    这里返回 `null`。采集一条脏链接不该让整批入库失败。
 * 2. **主机白名单可注入**：上游把三个平台的域名写死在扩展里。这里默认给同一份
 *    域名表，但策略可以替换（测试、校内镜像、未来接入别的学校）。
 * 3. **不逐条白名单化 BB 的查询参数**。上游对 Blackboard 的 `myGrades` /
 *    `streamViewer` / `uploadAssignment` 做了逐参数白名单 —— 那份表非常精确，
 *    但**太紧**：门户改一次参数名就会把正常课程页全部挡掉，用户看到「采不到」。
 *    我们改为「危险动作词黑名单 + 允许的路径形状」，并把「是否进一步收紧」
 *    留到采集器落地、有实测路径之后再定（见文件末尾 TODO）。
 *
 * ## 边界
 *
 * - 纯函数，无网络、无凭据，不判断「用户有没有权限」—— 那是会话的事；
 * - 白名单是**必要不充分**条件：通过了不代表该抓，只代表「不是明显危险的动作页」；
 * - 资产文件（pdf/zip/图片）默认拒绝：采集器要的是页面结构，不是附件字节。
 */

/* ------------------------------------------------------------------ *
 * 类型
 * ------------------------------------------------------------------ */

/** 有只读策略的平台 */
export const READ_ONLY_PLATFORMS = Object.freeze([
  'blackboard',
  'gradescope',
  'piazza',
  'ecourse',
] as const);

export type ReadOnlyPlatform = (typeof READ_ONLY_PLATFORMS)[number];

/** 拒绝原因（`allowed: true` 时为 `null`） */
export const READ_ONLY_DENY_REASONS = Object.freeze([
  'invalid-url',
  'unsafe-protocol',
  'credentials-in-url',
  'host-not-allowed',
  'port-not-allowed',
  'asset',
  'dangerous-path',
  'action-parameter',
  'path-not-allowed',
] as const);

export type ReadOnlyDenyReason = (typeof READ_ONLY_DENY_REASONS)[number];

/** 判定结果。`reason` 是给人/日志看的枚举，不要拿去做 UI 文案（文案在调用方） */
export interface ReadOnlyDecision {
  readonly allowed: boolean;
  readonly reason: ReadOnlyDenyReason | null;
}

/** 一个平台的只读策略 */
export interface ReadOnlyPolicy {
  /** 允许的主机名（小写，精确匹配） */
  readonly hosts: readonly string[];
  /** 额外允许的端口（除 443 外）。Blackboard 用 8443 */
  readonly extraPorts?: readonly string[];
  /** 允许的路径形状（任一命中即可） */
  readonly paths: readonly RegExp[];
  /** 额外拒绝的路径形状（优先于 paths） */
  readonly deniedPaths?: readonly RegExp[];
}

/* ------------------------------------------------------------------ *
 * 会话参数清洗
 * ------------------------------------------------------------------ */

/**
 * 会被当成「登录态」的参数名/片段。
 *
 * 刻意宽：`code`（OAuth 回调）、`ticket`（CAS）、`sid`（会话）、`auth`、`secret`
 * 全都算。误删一个普通参数顶多让回源链接少个筛选条件；漏删一个就是凭据泄漏。
 */
const SESSION_FRAGMENT_RE = /sid|session|token|auth|password|ticket|secret|code/i;

/**
 * 清掉链接里的会话参数。
 *
 * - 只接受 `http:` / `https:`；带用户名或密码的 URL 视为不安全，返回 `null`；
 * - 删除查询串里名字命中 `SESSION_FRAGMENT_RE` 的参数；
 * - 锚点（hash）里命中同一规则的整段清空（BB 的 `#grade-123` 这种标识**保留**，
 *   它用于对账，不含会话）；
 * - `searchParams.sort()` 让同样的链接得到同样的字符串 —— 否则判重会漏。
 *
 * @returns 绝对 URL；不安全或非法返回 `null`
 */
export function sanitizeSourceUrl(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username.length > 0 || url.password.length > 0) return null;

  for (const key of [...url.searchParams.keys()]) {
    if (SESSION_FRAGMENT_RE.test(key)) url.searchParams.delete(key);
  }
  url.searchParams.sort();

  if (SESSION_FRAGMENT_RE.test(url.hash)) url.hash = '';

  return url.toString();
}

/* ------------------------------------------------------------------ *
 * 只读策略
 * ------------------------------------------------------------------ */

/** 出现在路径或查询串里就拒绝的动作词 */
const DANGEROUS_TOKEN_RE =
  /logout|signout|delete|remove|create|submit|submissions|grading|gradebook|roster|manage|personalinfo|myemailtool|edit|addmodule|enroll|unenroll|regrade|register|settings|password|reset|purchase|payment/i;

/** 带这些名字的查询参数一出现就拒绝：它们表达的是「动作」而不是「查看」 */
const ACTION_PARAMETER_RE = /^(?:action|method|command|cmd|operation|task)$/i;

/** 资源文件：采集器要的是页面结构，不是附件字节 */
const ASSET_EXTENSION_RE = /\.(?:png|jpe?g|gif|svg|css|js|mp4|mp3|zip|pptx?|docx?|pdf)$/i;

/**
 * 默认策略。
 *
 * 域名与路径来自上游对三个平台的**只读视图**观察；`ecourse` 是我们自己加的
 * （e云平台），路径给得宽一些，且没有实测样本 —— 落地前必须复核。
 */
export const READ_ONLY_POLICIES: Readonly<Record<ReadOnlyPlatform, ReadOnlyPolicy>> = Object.freeze({
  blackboard: {
    hosts: ['elearning.shanghaitech.edu.cn'],
    extraPorts: ['8443'],
    paths: [
      /^\/webapps\/portal\/execute\/tabs\/tabAction$/,
      /^\/webapps\/blackboard\/execute\/(?:launcher|courseMain|announcement|displayLearningUnit)$/,
      /^\/webapps\/blackboard\/execute\/modulepage\/view$/,
      /^\/webapps\/blackboard\/content\/(?:listContent|contentWrapper|courseMain)\.jsp$/,
      /^\/webapps\/bb-mygrades-BBLEARN\/myGrades$/,
      /^\/webapps\/streamViewer\/streamViewer$/,
      /^\/webapps\/assignment\/uploadAssignment(?:\.jsp)?$/,
      /^\/ultra\/courses\/[^/]+\/outline$/,
    ],
  },
  gradescope: {
    hosts: ['www.gradescope.com', 'gradescope.com'],
    paths: [/^\/courses\/\d+(?:\/(?:assignments\/\d+)?)?$/, /^\/account\/?$/],
    // 课程成员管理页不是学生该采集的视图
    deniedPaths: [/\/(?:new|students|users|staff)\/?$/],
  },
  piazza: {
    hosts: ['piazza.com', 'www.piazza.com'],
    paths: [/^\/(?:class|class_profile|resources)(?:\/|$)/],
    // `get_resource` 是直接下载资源，不是页面
    deniedPaths: [/^\/class_profile\/get_resource\//],
  },
  ecourse: {
    hosts: ['ecourse.shanghaitech.edu.cn'],
    paths: [/^\/(?:course|learn|portal)(?:\/|$)/],
  },
});

/**
 * 判断一个地址是否属于「只看不改」的页面。
 *
 * 判定顺序（每一层都写死在测试里）：
 *
 * 1. 能解析成绝对 URL；
 * 2. https（**不接受** http：校内平台都支持 https，明文采集等于把课程内容裸奔在链路上）；
 * 3. 无用户名/密码；
 * 4. 主机在白名单，端口只能是 443 或策略里的额外端口；
 * 5. 不是资产文件；
 * 6. 查询参数里没有 `action` / `cmd` 这类「动作」参数；
 * 7. 路径/查询串里没有危险动作词；
 * 8. 路径命中允许形状，且不命中显式拒绝形状。
 *
 * @param value    待判定的地址（可以是相对链接？不 —— 必须是绝对地址，由调用方补全）
 * @param platform 平台；省略时用「任意平台」的组合策略
 */
export function isReadOnlySourceUrl(
  value: string | null | undefined,
  platform?: ReadOnlyPlatform,
): ReadOnlyDecision {
  const deny = (reason: ReadOnlyDenyReason): ReadOnlyDecision => ({ allowed: false, reason });

  if (typeof value !== 'string' || value.trim().length === 0) return deny('invalid-url');

  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return deny('invalid-url');
  }

  if (url.protocol !== 'https:') return deny('unsafe-protocol');
  if (url.username.length > 0 || url.password.length > 0) return deny('credentials-in-url');

  const policies =
    platform === undefined
      ? READ_ONLY_PLATFORMS.map((name) => READ_ONLY_POLICIES[name])
      : [READ_ONLY_POLICIES[platform]];

  const policy = policies.find((candidate) => candidate.hosts.includes(url.hostname.toLowerCase()));
  if (policy === undefined) return deny('host-not-allowed');

  const port = url.port;
  const allowedPorts = ['', '443', ...(policy.extraPorts ?? [])];
  if (!allowedPorts.includes(port)) return deny('port-not-allowed');

  if (ASSET_EXTENSION_RE.test(url.pathname)) return deny('asset');

  // 先看「参数表达的是动作」——它的原因比「路径里有危险词」更精确
  for (const [key, parameterValue] of url.searchParams) {
    if (ACTION_PARAMETER_RE.test(key)) return deny('action-parameter');
    // BB 的「重置视图」是写操作，不是查看
    if (/^mode$/i.test(key) && parameterValue === 'reset') return deny('action-parameter');
  }

  const pathAndQuery = `${url.pathname}?${url.searchParams.toString()}`;
  if (DANGEROUS_TOKEN_RE.test(pathAndQuery)) return deny('dangerous-path');

  if ((policy.deniedPaths ?? []).some((pattern) => pattern.test(url.pathname))) {
    return deny('path-not-allowed');
  }
  if (!policy.paths.some((pattern) => pattern.test(url.pathname))) return deny('path-not-allowed');

  return { allowed: true, reason: null };
}

/* ------------------------------------------------------------------ *
 * TODO（采集器落地那一轮再定）
 * ------------------------------------------------------------------ *
 *
 * - Blackboard 的逐参数白名单：上游对 `myGrades` / `streamViewer` / `uploadAssignment`
 *   做了精确的键值约束（例如 `content_id` 必须形如 `_1_2`）。等有真实抓包样本再补，
 *   现在写死会把正常页面挡掉。
 * - `ecourse` 的路径形状没有实测样本，授权范围也未确认，落地前必须复核。
 * - 策略里 `hosts` 是**精确匹配**；如果要支持校内镜像（`elearning2.…`），
 *   应由调用方注入策略，而不是在这里加通配符 —— 通配符会让白名单失去意义。
 */
